/**
 * Broadcasts (designs/2026-10-14-customerio-audit.md, B6): one send to a segment, by email or
 * text, now or at a time, optionally at that time in each person's own zone. The one writer of
 * `broadcasts` and `broadcast_recipients` (`./broadcasts-schema.ts`).
 *
 * The life of one: saved as a draft, asked (To approve), approved, then on its time `start`
 * reads the segment once into recipients, each due at its own time. `sendRecipient` sends one:
 * consent, suppressions and the frequency cap gate it (`mayMarket`); a capped person is held
 * until the cap lifts and tried again then. An email goes from here, through the workspace's mailer
 * (`MailOf`: Wren's portal@, a client's own connected mailbox); a text is queued on
 * `sms_messages` (kind `broadcast`) for the texts sender, which keeps quiet hours. The
 * `Broadcast` object (`./broadcast-run.ts`) drives it. Results are the sent log's (B2).
 */
import type { Queryable } from "@wren/db";
import { atomic } from "@wren/db/isolation";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  type BroadcastChannel,
  type BroadcastState,
  broadcastRecipients,
  broadcasts,
  type RecipientState,
} from "./broadcasts-schema.js";
import { addressOf, marketingRoomAt, mayMarket, recordMarketingSend } from "./marketing.js";
import { readMessageSettings, slugOf, tagLinks } from "./message-settings.js";
import { PortalRefusal } from "./refusal.js";
import { topics } from "./schema.js";
import { segmentById, segmentMembers } from "./segments.js";
import type { SegmentUse } from "./segments-schema.js";
import { AuthoringError, checkSource, MissingFactError, renderKind } from "./slots/index.js";
import { canonicalZone, wallClock, zonedInstant } from "./time.js";

export type Broadcast = typeof broadcasts.$inferSelect;
export type Recipient = typeof broadcastRecipients.$inferSelect;

/** The merge fields a broadcast's words may use, each from the person's profile. */
export const BROADCAST_FIELDS = ["first_name", "name"] as const;
/** A text's longest: three parts. */
export const TEXT_MOST = 459;
/** Where a person's own zone comes from when local time is on: a trait by one of these keys. */
const ZONE_TRAITS = ["timezone", "time_zone", "zone"];
/** The earliest any zone reaches a wall clock: UTC+14 (Kiritimati). */
const EARLIEST_OFFSET_MS = 14 * 3_600_000;
/** Emails a run sends before it pauses, and the pause: a trickle, never a burst. */
export const EMAIL_BATCH = 20;
export const EMAIL_PAUSE_MS = 30_000;
/** Texts a run queues before the next run: the texts sender paces them itself. */
export const TEXT_BATCH = 200;
/** Under Gmail's 2,000 a day for portal@, with room for its other mail (`ISSUE_DAILY`). */
export const EMAIL_DAILY = 1500;
/** Under a free Gmail's 500 a day, with room for the person's own mail. */
export const PERSONAL_DAILY = 400;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Texts never go to a contact in these states. */
const TEXTS_ENDED = new Set(["opted_out", "unreachable", "stopped"]);

const OPEN: readonly BroadcastState[] = ["draft", "waiting", "scheduled", "declined"];
const WAITS: readonly RecipientState[] = ["due", "held", "sending"];

type Row = Record<string, unknown>;
const rows = async (db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as Row[];

// ---------------------------------------------------------------------------------------------
// Words and times

/**
 * The words, checked: every merge field one the profile can fill, a text says STOP and fits in
 * three parts, an email has a subject. Refused with what to fix.
 */
export function checkWords(
  channel: BroadcastChannel,
  subject: string | null,
  body: string,
): { subject: string | null; body: string } {
  const text = body.replace(/\r\n/g, "\n");
  try {
    const got = checkSource(channel === "email" ? "post" : "sms", "broadcast", text, {
      fields: BROADCAST_FIELDS,
      ...(channel === "sms" ? { mustSayStop: true, maxLength: TEXT_MOST } : {}),
    });
    if (!got) throw new PortalRefusal("write what it says", 422);
    if (channel === "email") {
      const s = (subject ?? "").trim();
      if (!s) throw new PortalRefusal("an email needs a subject", 422);
      if (s.length > 200) throw new PortalRefusal("a subject is at most 200 characters", 422);
      checkSource("post", "subject", s, { fields: BROADCAST_FIELDS });
      return { subject: s, body: got.source };
    }
    return { subject: null, body: got.source };
  } catch (err) {
    if (err instanceof AuthoringError)
      throw new PortalRefusal(err.message.replace(/^(broadcast|subject)( is)?:? ?/, ""), 422);
    throw err;
  }
}

/** The facts one person's copy is filled from. */
export function factsOf(name: string | null): Record<string, string | null> {
  const word = name?.trim().split(/\s+/)[0] ?? "";
  const first = /^[A-Za-z][A-Za-z'-]{1,}$/.test(word)
    ? `${word[0]?.toUpperCase()}${word.slice(1)}`
    : null;
  return { first_name: first, name: name?.trim() || null };
}

/** One person's subject and words; null with why when a field has no value and no fallback. */
export function renderFor(
  b: Pick<Broadcast, "id" | "channel" | "subject" | "body">,
  facts: Record<string, string | null>,
  seed: string,
): { subject: string | null; body: string } | { missing: string } {
  const kind = b.channel === "email" ? "post" : "sms";
  try {
    const body = renderKind(
      kind,
      checkSource(kind, "broadcast", b.body)?.template ?? fail(),
      facts,
      `b${b.id}:${seed}`,
    );
    const subject = b.subject
      ? renderKind(
          "post",
          checkSource("post", "subject", b.subject)?.template ?? fail(),
          facts,
          `b${b.id}:${seed}`,
        ).body
      : null;
    return { subject, body: body.body };
  } catch (err) {
    if (err instanceof MissingFactError) return { missing: err.message };
    throw err;
  }
}
const fail = (): never => {
  throw new PortalRefusal("the words are empty", 422);
};

/**
 * When one person gets it: its time, or with local time, its wall clock in their zone (theirs
 * unknown: the broadcast's). Never before `now`.
 */
export function dueFor(
  b: Pick<Broadcast, "sendAt" | "local" | "zone">,
  zone: string | null,
  now: Date,
): Date {
  if (!b.sendAt) return now;
  let at = b.sendAt;
  if (b.local) {
    const w = wallClock(b.zone, b.sendAt);
    const z = (zone && canonicalZone(zone)) || b.zone;
    at = zonedInstant(z, w.year, w.month, w.day, w.hour, w.minute);
  }
  return at > now ? at : now;
}

/** When it starts: its time, or with local time the moment the first zone on earth reaches it. */
export function startOf(b: Pick<Broadcast, "sendAt" | "local" | "zone">, now: Date): Date {
  if (!b.sendAt) return now;
  if (!b.local) return b.sendAt;
  const w = wallClock(b.zone, b.sendAt);
  return new Date(Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - EARLIEST_OFFSET_MS);
}

// ---------------------------------------------------------------------------------------------
// Writing one

export interface BroadcastInput {
  id?: number | null;
  name?: string;
  channel?: BroadcastChannel;
  segmentId?: number;
  /** The consent topic: its name or id. */
  topic?: string | number;
  subject?: string | null;
  body?: string;
  /** ISO; null or left out: as soon as it's approved. */
  sendAt?: string | null;
  local?: boolean;
  zone?: string;
  /** Straight to To approve. */
  ask?: boolean;
}

export async function broadcastById(db: Queryable, id: number): Promise<Broadcast | null> {
  const [b] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
  return b ?? null;
}

async function mustHave(db: Queryable, id: number): Promise<Broadcast> {
  const b = Number.isSafeInteger(id) ? await broadcastById(db, id) : null;
  if (!b) throw new PortalRefusal("no such broadcast", 404);
  return b;
}

async function topicOf(db: Queryable, topic: string | number | undefined) {
  if (topic === undefined || topic === "") throw new PortalRefusal("pick a topic", 422);
  const n = Number(topic);
  const [t] = await db
    .select()
    .from(topics)
    .where(Number.isSafeInteger(n) && n > 0 ? eq(topics.id, n) : eq(topics.name, String(topic)));
  if (!t) throw new PortalRefusal(`no topic ${String(topic)}`, 422);
  return t;
}

/**
 * A broadcast made or changed. Its words, segment, topic and time are checked here. A change to
 * one already approved puts it back in To approve: the yes was for other words.
 */
export async function saveBroadcast(
  db: Queryable,
  input: BroadcastInput,
  by: string,
  now: Date,
): Promise<Broadcast> {
  const was = input.id ? await mustHave(db, Number(input.id)) : null;
  if (was && !OPEN.includes(was.state))
    throw new PortalRefusal(
      was.state === "canceled" ? "restore it first" : "it already went: make a new one",
      409,
    );
  const channel = input.channel ?? was?.channel;
  if (channel !== "email" && channel !== "sms") throw new PortalRefusal("email or text?", 422);
  const name = (input.name ?? was?.name ?? "").trim();
  if (!name) throw new PortalRefusal("name it", 422);
  if (name.length > 120) throw new PortalRefusal("a name is at most 120 characters", 422);
  const segmentId = Number(input.segmentId ?? was?.segmentId);
  const seg = Number.isSafeInteger(segmentId) ? await segmentById(db, segmentId) : null;
  if (!seg) throw new PortalRefusal("pick a segment", 422);
  if (seg.state !== "active") throw new PortalRefusal(`${seg.name} is archived`, 422);
  const topic = await topicOf(db, input.topic ?? was?.topicId);
  if (topic.channel !== channel)
    throw new PortalRefusal(
      `${topic.publicName} is a ${topic.channel === "sms" ? "texts" : "email"} topic`,
      422,
    );
  const words = checkWords(
    channel,
    input.subject !== undefined ? input.subject : (was?.subject ?? null),
    input.body ?? was?.body ?? "",
  );
  const zone = canonicalZone(input.zone ?? was?.zone ?? "America/New_York");
  if (!zone) throw new PortalRefusal(`no time zone ${input.zone}`, 422);
  const raw = input.sendAt !== undefined ? input.sendAt : (was?.sendAt?.toISOString() ?? null);
  const sendAt = raw ? new Date(raw) : null;
  if (sendAt && Number.isNaN(sendAt.getTime()))
    throw new PortalRefusal("that time doesn't read", 422);
  const local = sendAt ? (input.local ?? was?.local ?? false) : false;
  if (sendAt && startOf({ sendAt, local, zone }, now) <= now && !was)
    throw new PortalRefusal("pick a time ahead, or send it as soon as it's approved", 422);
  const asked = input.ask || was?.state === "waiting" || was?.state === "scheduled";
  const values = {
    name,
    channel,
    segmentId: seg.id,
    topicId: topic.id,
    subject: words.subject,
    body: words.body,
    sendAt,
    local,
    zone,
    updatedAt: now,
    ...(asked
      ? {
          state: "waiting" as const,
          askedBy: by,
          askedAt: now,
          decidedBy: null,
          decidedAt: null,
          note: null,
        }
      : {}),
  };
  if (was) {
    const [b] = await db
      .update(broadcasts)
      .set(values)
      .where(and(eq(broadcasts.id, was.id), inArray(broadcasts.state, [...OPEN])))
      .returning();
    if (!b) throw new PortalRefusal("it changed meanwhile: open it again", 409);
    return b;
  }
  const [b] = await db
    .insert(broadcasts)
    .values({ ...values, state: asked ? "waiting" : "draft", by, createdAt: now })
    .returning();
  if (!b) throw new Error("broadcast not saved");
  return b;
}

/** A draft or a declined one, into To approve. */
export async function askBroadcast(db: Queryable, id: number, by: string, now: Date) {
  const b = await mustHave(db, id);
  if (b.state === "waiting") return b;
  if (b.state !== "draft" && b.state !== "declined")
    throw new PortalRefusal("only a draft goes to To approve", 409);
  return (
    (
      await db
        .update(broadcasts)
        .set({
          state: "waiting",
          askedBy: by,
          askedAt: now,
          decidedBy: null,
          decidedAt: null,
          note: null,
          updatedAt: now,
        })
        .where(and(eq(broadcasts.id, id), inArray(broadcasts.state, ["draft", "declined"])))
        .returning()
    )[0] ?? b
  );
}

/**
 * The approver's word on a waiting broadcast. A yes schedules it and says when it starts (the
 * `Broadcast` object is told then); a no sends it back as declined with why.
 */
export async function decideBroadcast(
  db: Queryable,
  id: number,
  yes: boolean,
  by: string,
  now: Date,
  note: string | null = null,
): Promise<{ broadcast: Broadcast; startAt: Date | null }> {
  const b = await mustHave(db, id);
  if (b.state !== "waiting")
    throw new PortalRefusal(
      b.state === "scheduled" ? "already approved" : "it isn't waiting on a yes",
      409,
    );
  if (yes) {
    const seg = await segmentById(db, b.segmentId);
    if (seg?.state !== "active") throw new PortalRefusal("its segment is archived", 409);
  }
  const [got] = await db
    .update(broadcasts)
    .set({
      state: yes ? "scheduled" : "declined",
      decidedBy: by,
      decidedAt: now,
      note: yes ? null : note?.trim() || null,
      updatedAt: now,
    })
    .where(and(eq(broadcasts.id, id), eq(broadcasts.state, "waiting")))
    .returning();
  if (!got) throw new PortalRefusal("it changed meanwhile: open it again", 409);
  return { broadcast: got, startAt: yes ? startOf(got, now) : null };
}

/** Stopped: nobody else gets it. Anyone still due is skipped; what went, went. */
export async function cancelBroadcast(db: Queryable, id: number, by: string, now: Date) {
  const b = await mustHave(db, id);
  if (b.state === "canceled") return b;
  if (b.state === "sent") throw new PortalRefusal("it already went", 409);
  return atomic(db, async (tx) => {
    const [got] = await tx
      .update(broadcasts)
      .set({ state: "canceled", note: `Canceled by ${by}`, updatedAt: now })
      .where(and(eq(broadcasts.id, id), eq(broadcasts.state, b.state)))
      .returning();
    if (!got) throw new PortalRefusal("it changed meanwhile: open it again", 409);
    await tx
      .update(broadcastRecipients)
      .set({ state: "skipped", why: "Canceled before it went" })
      .where(
        and(
          eq(broadcastRecipients.broadcastId, id),
          inArray(broadcastRecipients.state, ["due", "held"]),
        ),
      );
    return got;
  });
}

/**
 * Cancel undone. One that never started goes back to a draft, to be asked again; one that was
 * sending picks up where it stopped (it had its yes), and says when.
 */
export async function restoreBroadcast(
  db: Queryable,
  id: number,
  now: Date,
): Promise<{ broadcast: Broadcast; startAt: Date | null }> {
  const b = await mustHave(db, id);
  if (b.state !== "canceled") throw new PortalRefusal("it isn't canceled", 409);
  return atomic(db, async (tx) => {
    const started = b.startedAt !== null;
    const [got] = await tx
      .update(broadcasts)
      .set({
        state: started ? "sending" : "draft",
        note: null,
        updatedAt: now,
        ...(started ? {} : { decidedBy: null, decidedAt: null }),
      })
      .where(and(eq(broadcasts.id, id), eq(broadcasts.state, "canceled")))
      .returning();
    if (!got) throw new PortalRefusal("it changed meanwhile: open it again", 409);
    if (!started) return { broadcast: got, startAt: null };
    await tx
      .update(broadcastRecipients)
      .set({ state: "due", why: null })
      .where(
        and(
          eq(broadcastRecipients.broadcastId, id),
          eq(broadcastRecipients.state, "skipped"),
          eq(broadcastRecipients.why, "Canceled before it went"),
        ),
      );
    return { broadcast: got, startAt: now };
  });
}

/** The send test's mark: when, and to whom. */
export async function markTested(db: Queryable, id: number, to: string, now: Date) {
  await db.update(broadcasts).set({ testedTo: to, testedAt: now }).where(eq(broadcasts.id, id));
}

// ---------------------------------------------------------------------------------------------
// Sending

/** Each person's own zone, when local time needs it: a zone trait, else their texts thread's. */
async function zonesOf(db: Queryable, ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const got = await rows(
    db,
    sql`select p.id,
        (select t.value #>> '{}' from profile_traits t
          where t.profile_id = p.id and t.key in (${sql.join(
            ZONE_TRAITS.map((k) => sql`${k}`),
            sql`, `,
          )})
          order by t.at desc limit 1) own,
        (select coalesce(c.zone, co.timezone) from profile_keys k
          join sms_contacts c on c.e164 = k.value
          left join companies co on co.id = c.company_id
          where k.profile_id = p.id and k.kind = 'phone' and coalesce(c.zone, co.timezone) is not null
          order by c.id desc limit 1) texts
      from profiles p where p.id in (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})`,
  );
  const out = new Map<number, string>();
  for (const r of got) {
    const z = [r.own, r.texts]
      .map((v) => (typeof v === "string" ? canonicalZone(v) : null))
      .find(Boolean);
    if (z) out.set(Number(r.id), z);
  }
  return out;
}

/** Among a person's addresses, the one that said yes to the topic, else their first. */
async function pickAddresses(
  db: Queryable,
  channel: BroadcastChannel,
  topicId: number,
  people: { profileId: number; addresses: string[] }[],
): Promise<Map<number, string | null>> {
  const all = [...new Set(people.flatMap((p) => p.addresses))];
  const yes = new Set<string>();
  if (all.length) {
    const got = await rows(
      db,
      sql`select address from consents where channel = ${channel} and topic_id = ${topicId}
        and state = 'confirmed' and address in (${sql.join(
          all.map((a) => sql`${a}`),
          sql`, `,
        )})`,
    );
    for (const r of got) yes.add(String(r.address));
  }
  return new Map(
    people.map((p) => [p.profileId, p.addresses.find((a) => yes.has(a)) ?? p.addresses[0] ?? null]),
  );
}

/**
 * On its time: the segment read once into recipients, each due at its own time, and the
 * broadcast `sending`. Only a scheduled one starts; a second call does nothing.
 */
export async function startBroadcast(db: Queryable, id: number, now: Date): Promise<number> {
  const b = await mustHave(db, id);
  if (b.state !== "scheduled") return 0;
  let after = 0;
  let n = 0;
  for (;;) {
    const page = await segmentMembers(db, b.segmentId, { after, limit: 1000, now });
    if (!page.length) break;
    after = page[page.length - 1]?.profileId ?? after;
    const people = page.map((m) => ({
      profileId: m.profileId,
      addresses: b.channel === "email" ? m.emails : m.phones,
    }));
    const address = await pickAddresses(db, b.channel, b.topicId, people);
    const zones = b.local
      ? await zonesOf(
          db,
          page.map((m) => m.profileId),
        )
      : new Map();
    const values = page.map((m) => {
      const to = address.get(m.profileId) ?? null;
      const zone = zones.get(m.profileId) ?? null;
      return {
        broadcastId: b.id,
        profileId: m.profileId,
        address: to,
        zone: b.local ? (zone ?? b.zone) : null,
        state: (to ? "due" : "skipped") as RecipientState,
        why: to ? null : b.channel === "email" ? "No email address" : "No phone number",
        dueAt: dueFor(b, zone, now),
        createdAt: now,
      };
    });
    const made = await db
      .insert(broadcastRecipients)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: broadcastRecipients.id });
    n += made.length;
    if (page.length < 1000) break;
  }
  await db
    .update(broadcasts)
    .set({ state: "sending", startedAt: now, updatedAt: now })
    .where(and(eq(broadcasts.id, id), eq(broadcasts.state, "scheduled")));
  return n;
}

/** The recipients due now, soonest first: the next run's work. */
export async function dueRecipients(
  db: Queryable,
  id: number,
  now: Date,
  limit: number,
): Promise<number[]> {
  const got = await db
    .select({ id: broadcastRecipients.id })
    .from(broadcastRecipients)
    .where(
      and(
        eq(broadcastRecipients.broadcastId, id),
        inArray(broadcastRecipients.state, ["due", "held", "sending"]),
        sql`${broadcastRecipients.dueAt} <= ${now.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(broadcastRecipients.dueAt), asc(broadcastRecipients.id))
    .limit(limit);
  return got.map((r) => r.id);
}

/** Emails broadcasts sent in the last day, in this workspace: what the daily ceiling counts. */
export async function emailsToday(db: Queryable, now: Date): Promise<number> {
  const [r] = await rows(
    db,
    sql`select count(*)::int n from broadcast_recipients r join broadcasts b on b.id = r.broadcast_id
      where b.channel = 'email' and r.state = 'sent'
        and r.sent_at > ${new Date(now.getTime() - DAY_MS).toISOString()}::timestamptz`,
  );
  return Number(r?.n ?? 0);
}

/** How an email broadcast leaves: the mailer, and what every marketing email carries. */
export interface BroadcastMail {
  send(m: {
    to: string;
    subject: string;
    text: string;
    headers: [string, string][];
  }): Promise<void>;
  /** The footer and one-click unsubscribe for this address and topic. */
  envelope(
    address: string,
    topic: { name: string; publicName: string },
  ): { footer: string; headers: [string, string][] };
  /** A test goes to this domain only, so it never reaches a subscriber. */
  domain: string;
  /** The most broadcast emails it sends in a rolling day. */
  daily: number;
}

/** Why a workspace's email can't send yet, in words for its owner. */
export interface MailUnset {
  unset: string;
}

/** A workspace's mailer: Wren's (`client` null) or a client's own, or why there is none yet. */
export type MailOf = (client: string | null, db: Queryable) => Promise<BroadcastMail | MailUnset>;

export const isUnset = (m: BroadcastMail | MailUnset): m is MailUnset => "unset" in m;

/** What one person's turn came to. */
export type Outcome =
  | { state: "sent" | "queued" }
  | { state: "held"; until: string; why: string }
  | { state: "skipped" | "failed"; why: string }
  | { state: "gone" };

const VERDICT_WORDS: Record<string, string> = {
  suppressed: "On the do-not-contact list",
  "no consent": "Never said yes to this topic",
  pending: "Asked, never confirmed",
  withdrawn: "Took back their yes",
  paused: "Paused their messages",
};

async function settle(db: Queryable, id: number, set: Partial<Recipient>) {
  await db.update(broadcastRecipients).set(set).where(eq(broadcastRecipients.id, id));
}

/**
 * One person's turn: gated, then sent (email) or queued (text). A capped person is held until
 * the cap lifts. An email found mid-send (its step cut off) is failed, never sent twice.
 */
export async function sendRecipient(
  db: Queryable,
  recipientId: number,
  deps: { mail: BroadcastMail | MailUnset; now: Date },
): Promise<Outcome> {
  const { now } = deps;
  const [r] = await db
    .select()
    .from(broadcastRecipients)
    .where(eq(broadcastRecipients.id, recipientId));
  if (!r) return { state: "gone" };
  const b = await mustHave(db, r.broadcastId);
  if (b.state !== "sending") return { state: "gone" };
  if (r.state === "sending") {
    const why = "May not have sent: its step was cut off mid-send, so it isn't sent again";
    await settle(db, r.id, { state: "failed", why });
    return { state: "failed", why };
  }
  if (r.state !== "due" && r.state !== "held") return { state: "gone" };
  const skip = async (why: string): Promise<Outcome> => {
    await settle(db, r.id, { state: "skipped", why });
    return { state: "skipped", why };
  };
  if (!r.address) return skip(b.channel === "email" ? "No email address" : "No phone number");
  const [topic] = await db.select().from(topics).where(eq(topics.id, b.topicId));
  if (!topic) return skip("Its topic is gone");
  let address: string;
  try {
    address = addressOf(b.channel, r.address);
  } catch {
    return skip("Their address doesn't read");
  }
  const v = await mayMarket(db, { channel: b.channel, address, topic: topic.name, now });
  if (!v.send) {
    if (v.why !== "capped") return skip(VERDICT_WORDS[v.why] ?? v.why);
    const until =
      (await marketingRoomAt(db, { channel: b.channel, address, now })) ??
      new Date(now.getTime() + HOUR_MS);
    const why = "Held by the frequency cap. They are at their limit for now.";
    await settle(db, r.id, { state: "held", dueAt: until, why });
    return { state: "held", until: until.toISOString(), why };
  }
  const [p] = await rows(db, sql`select name from profiles where id = ${r.profileId}`);
  const copy = renderFor(b, factsOf((p?.name as string | null) ?? null), String(r.profileId));
  if ("missing" in copy) return skip(`Nothing to fill in: ${copy.missing}`);
  const slug = slugOf(b.name).slice(0, 40) || "broadcast";
  const tag = (await readMessageSettings(db)).utmLinks;

  if (b.channel === "sms") {
    const contacts = await rows(
      db,
      sql`select id, number_id, state from sms_contacts where e164 = ${address}
        order by id desc`,
    );
    if (contacts.some((c) => TEXTS_ENDED.has(String(c.state))))
      return skip("Their texts ended (STOP or unreachable)");
    const c = contacts.find((x) => x.number_id);
    if (!c) return skip("No texts thread with them yet");
    await atomic(db, async (tx) => {
      await tx.execute(sql`insert into sms_messages
          (contact_id, direction, kind, ref, number_id, to_e164, body, state, due_at, created_at)
        values (${Number(c.id)}, 'out', 'broadcast', ${`${slug}/${b.id}`}, ${String(c.number_id)}::uuid,
          ${address}, ${copy.body}, 'queued', ${now.toISOString()}::timestamptz,
          ${now.toISOString()}::timestamptz)
        on conflict do nothing`);
      await tx
        .update(broadcastRecipients)
        .set({ state: "queued", why: null, sentAt: now })
        .where(eq(broadcastRecipients.id, r.id));
      // The person's record and the 4-in-31-days count; the texts sender counts the cap.
      await recordMarketingSend(tx, {
        consentId: v.consent.id,
        by: "broadcast",
        evidence: { broadcast: b.id },
        campaign: slug,
        now,
        capped: false,
      });
    });
    return { state: "queued" };
  }

  if (isUnset(deps.mail)) return { state: "failed", why: await failed(db, r.id, deps.mail.unset) };
  const claimed = await db
    .update(broadcastRecipients)
    .set({ state: "sending" })
    .where(
      and(eq(broadcastRecipients.id, r.id), inArray(broadcastRecipients.state, ["due", "held"])),
    )
    .returning({ id: broadcastRecipients.id });
  if (!claimed.length) return { state: "gone" };
  const env = deps.mail.envelope(address, { name: topic.name, publicName: topic.publicName });
  const text = tag
    ? tagLinks(copy.body, { source: "wren", medium: "email", campaign: slug })
    : copy.body;
  try {
    await deps.mail.send({
      to: address,
      subject: copy.subject ?? b.name,
      text: `${text}${env.footer}`,
      headers: env.headers,
    });
  } catch (err) {
    const why = `Didn't send: ${String((err as Error).message ?? err).slice(0, 300)}`;
    return { state: "failed", why: await failed(db, r.id, why) };
  }
  await atomic(db, async (tx) => {
    await settle(tx, r.id, { state: "sent", why: null, sentAt: now });
    await recordMarketingSend(tx, {
      consentId: v.consent.id,
      by: "broadcast",
      evidence: { broadcast: b.id },
      campaign: slug,
      now,
    });
  });
  return { state: "sent" };
}

async function failed(db: Queryable, id: number, why: string): Promise<string> {
  await settle(db, id, { state: "failed", why });
  return why;
}

/**
 * After a run: when the next one is due (the soonest person still waiting), or null when nobody
 * is, and then the broadcast is `sent`.
 */
export async function nextOrFinish(db: Queryable, id: number, now: Date): Promise<Date | null> {
  const [r] = await rows(
    db,
    sql`select min(due_at) at from broadcast_recipients
      where broadcast_id = ${id} and state in (${sql.join(
        WAITS.map((s) => sql`${s}`),
        sql`, `,
      )})`,
  );
  if (r?.at) return new Date(r.at as string);
  await db
    .update(broadcasts)
    .set({ state: "sent", finishedAt: now, updatedAt: now })
    .where(and(eq(broadcasts.id, id), eq(broadcasts.state, "sending")));
  return null;
}

// ---------------------------------------------------------------------------------------------
// Reading

/** What the editor shows before a save: the words for a sample person, and who it would reach. */
export async function previewBroadcast(
  db: Queryable,
  input: BroadcastInput,
): Promise<{ subject: string | null; body: string; people: number; yes: number }> {
  const channel = input.channel === "sms" ? "sms" : "email";
  const words = checkWords(channel, input.subject ?? null, input.body ?? "");
  const copy = renderFor(
    { id: 0, channel, subject: words.subject, body: words.body },
    { first_name: "Sam", name: "Sam Rivera" },
    "preview",
  );
  if ("missing" in copy) throw new PortalRefusal(copy.missing, 422);
  const segmentId = Number(input.segmentId);
  if (!Number.isSafeInteger(segmentId) || segmentId < 1) return { ...copy, people: 0, yes: 0 };
  const topic = input.topic ? await topicOf(db, input.topic) : null;
  const [n] = await rows(
    db,
    sql`select count(*)::int people,
        count(*) filter (where exists (
          select 1 from profile_keys k join consents c on c.address = k.value
          where k.profile_id = m.profile_id and k.kind = ${channel === "email" ? "email" : "phone"}
            and c.channel = ${channel} and c.topic_id = ${topic?.id ?? 0} and c.state = 'confirmed'))::int yes
      from segment_members m join profiles p on p.id = m.profile_id
      where m.segment_id = ${segmentId} and p.merged_into is null`,
  );
  return { ...copy, people: Number(n?.people ?? 0), yes: Number(n?.yes ?? 0) };
}

/** The editor's lists: active segments with their size, and the topics on each channel. */
export async function broadcastContext(db: Queryable) {
  const segs = await rows(
    db,
    sql`select id, name, size from segments where state = 'active' order by name`,
  );
  const tops = await db.select().from(topics).orderBy(asc(topics.publicName));
  return {
    segments: segs.map((s) => ({ id: Number(s.id), name: String(s.name), size: Number(s.size) })),
    topics: tops.map((t) => ({
      id: t.id,
      name: t.name,
      publicName: t.publicName,
      channel: t.channel,
    })),
    fields: [...BROADCAST_FIELDS],
    textMost: TEXT_MOST,
  };
}

/** The month's broadcasts for the calendar: by when each goes or went. A draft has no date yet. */
export async function broadcastMonth(db: Queryable, from: Date, to: Date) {
  const got = await rows(
    db,
    sql`select id, name, channel, state, "when" from broadcast_records
      where "when" >= ${from.toISOString()}::timestamptz and "when" < ${to.toISOString()}::timestamptz
        and state not in ('draft', 'declined', 'canceled')
      order by "when", id`,
  );
  return got.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    channel: String(r.channel) as BroadcastChannel,
    state: String(r.state) as BroadcastState,
    at: new Date(r.when as string).toISOString(),
  }));
}

/** To approve's rows: broadcasts waiting on a yes, with their segment's size. */
export async function waitingBroadcasts(db: Queryable) {
  const got = await rows(
    db,
    sql`select id, name, channel, segment, size, topic, subject, body, send_at, local, by, asked_at
      from broadcast_records where state = 'waiting' order by asked_at`,
  );
  return got.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    channel: String(r.channel) as BroadcastChannel,
    segment: String(r.segment),
    size: Number(r.size),
    topic: String(r.topic),
    subject: (r.subject as string | null) ?? null,
    body: String(r.body),
    sendAt: r.send_at ? new Date(r.send_at as string) : null,
    local: r.local === true,
    by: String(r.by),
    askedAt: new Date(r.asked_at as string),
  }));
}

/** One To approve line: "To Past buyers (120), as soon as it's approved". */
export function broadcastLine(w: Awaited<ReturnType<typeof waitingBroadcasts>>[number]): string {
  const when = w.sendAt
    ? `${w.sendAt.toISOString().slice(0, 16).replace("T", " ")} UTC${w.local ? ", each person's own time" : ""}`
    : "as soon as it's approved";
  return `${w.channel === "sms" ? "Text" : "Email"} to ${w.segment} (${w.size}), ${when}. Topic: ${w.topic}.`;
}

/** What uses each segment among broadcasts not yet done: for the segment's Used by. */
export async function broadcastUses(db: Queryable): Promise<Map<number, SegmentUse[]>> {
  const got = await rows(
    db,
    sql`select id, name, segment_id from broadcasts
      where state in ('draft', 'waiting', 'scheduled', 'sending') order by id`,
  );
  const out = new Map<number, SegmentUse[]>();
  for (const r of got) {
    const id = Number(r.segment_id);
    out.set(id, [
      ...(out.get(id) ?? []),
      { kind: "broadcast", id: String(r.id), name: String(r.name) },
    ]);
  }
  return out;
}

/** Per broadcast results on the sent log's ladder, each count a link to its rows. */
export interface BroadcastResults {
  ladder: { state: string; n: number; link: string }[];
  /** Never left, by why; each links to the recipients. */
  skipped: { why: string; n: number; link: string }[];
  held: number;
  failed: number;
}

export async function broadcastResults(db: Queryable, id: number): Promise<BroadcastResults> {
  const range = `${id}..${id}`;
  const ladder = await rows(
    db,
    sql`select state, count(*)::int n from sent_records where broadcast = ${id} group by state`,
  );
  const order = [
    "queued",
    "sent",
    "delivered",
    "bounced",
    "failed",
    "opened",
    "clicked",
    "replied",
  ];
  const skipped = await rows(
    db,
    sql`select coalesce(why, 'No reason kept') why, count(*)::int n from broadcast_recipients
      where broadcast_id = ${id} and state = 'skipped' group by 1 order by 2 desc`,
  );
  const [c] = await rows(
    db,
    sql`select count(*) filter (where state = 'held')::int held,
        count(*) filter (where state = 'failed')::int failed
      from broadcast_recipients where broadcast_id = ${id}`,
  );
  return {
    ladder: ladder
      .map((r) => ({
        state: String(r.state),
        n: Number(r.n),
        link: `/people/sent?broadcast=${range}&state=${String(r.state)}`,
      }))
      .sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state)),
    skipped: skipped.map((r) => ({
      why: String(r.why),
      n: Number(r.n),
      link: `/people/recipients?broadcastId=${range}&state=skipped`,
    })),
    held: Number(c?.held ?? 0),
    failed: Number(c?.failed ?? 0),
  };
}
