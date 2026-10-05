/**
 * Opt-in marketing: the one writer of `consents` and `consent_events`, and `mayMarket`, the one
 * rule a marketing send passes (designs/2026-10-04-borrowed-ui.md, "Opt-in marketing").
 *
 * Cold outreach keeps its own gate (suppressions only). Marketing needs both: no suppression,
 * and a confirmed consent for this topic and channel with its proof. A suppression beats every
 * consent; "unsubscribe from everything" writes one, so it stops cold outreach too.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { atomic, type Queryable, serializable } from "@wren/db";
import { and, count, desc, eq, gt, inArray, max } from "drizzle-orm";
import {
  type Consent,
  type ConsentEventKind,
  type ConsentSource,
  consentEvents,
  consents,
  type Frequency,
  type MarketingChannel,
  suppressionEvents,
  topics,
} from "./schema.js";
import {
  activeSuppressionOf,
  addSuppression,
  type Evidence,
  liftSuppression,
  normalizeValue,
} from "./suppress.js";

const DAY = 86_400_000;
/** A signup not confirmed in this long can't be: it signs up again. */
export const PENDING_DAYS = 7;
/** The most marketing texts one number gets in `SMS_WINDOW_DAYS`, whatever the person picked. */
export const SMS_CAP = 4;
export const SMS_WINDOW_DAYS = 31;
/** How long an "unsubscribe from everything" can be undone from the page that did it. */
export const UNDO_HOURS = 24;
const FREQUENCY_DAYS: Record<Frequency, number> = { as_sent: 0, weekly: 7, monthly: 30 };

const kindOf = (channel: MarketingChannel) => (channel === "email" ? "email" : "phone");
/** An address the way every table keys it: lowercased email, E.164 phone. Throws on junk. */
export const addressOf = (channel: MarketingChannel, address: string) =>
  normalizeValue(kindOf(channel), address);

export type Verdict =
  | { send: true; consent: Consent }
  | {
      send: false;
      why: "suppressed" | "no consent" | "pending" | "withdrawn" | "paused" | "capped";
      consent?: Consent;
    };

/** The SMS topic a whole message names by its keyword ("join", " Join! "), or null. */
export async function topicByKeyword(db: Queryable, text: string) {
  const word = text
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, "")
    .trim();
  if (!/^[A-Z0-9]{2,32}$/.test(word)) return null;
  const [t] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.keyword, word), eq(topics.channel, "sms")));
  return t ?? null;
}

async function topicId(db: Queryable, name: string, channel: MarketingChannel): Promise<number> {
  const [t] = await db
    .select({ id: topics.id, channel: topics.channel })
    .from(topics)
    .where(eq(topics.name, name));
  if (!t) throw new Error(`no topic named ${JSON.stringify(name)}`);
  if (t.channel !== channel) throw new Error(`topic ${name} is ${t.channel}, not ${channel}`);
  return t.id;
}

async function consentOf(db: Queryable, channel: MarketingChannel, address: string, topic: number) {
  const [row] = await db
    .select()
    .from(consents)
    .where(
      and(
        eq(consents.channel, channel),
        eq(consents.address, address),
        eq(consents.topicId, topic),
      ),
    );
  return row ?? null;
}

async function log(
  db: Queryable,
  consentId: number,
  kind: ConsentEventKind,
  by: string,
  evidence: Evidence = null,
) {
  const [e] = await db
    .insert(consentEvents)
    .values({ consentId, kind, by, evidence })
    .returning({ id: consentEvents.id });
  return e?.id ?? 0;
}

/**
 * Whether one marketing message may go to `address` on `topic` now. Compose asks, and send asks
 * again. In order: no suppression (on email, none on its domain either), a confirmed consent,
 * not paused, and under the cap (the person's frequency; on SMS also 4 in 31 days).
 */
export async function mayMarket(
  db: Queryable,
  input: { channel: MarketingChannel; address: string; topic: string; now?: Date },
): Promise<Verdict> {
  const { channel } = input;
  const now = input.now ?? new Date();
  const address = addressOf(channel, input.address);
  if (await activeSuppressionOf(db, kindOf(channel), address)) {
    return { send: false, why: "suppressed" };
  }
  if (channel === "email") {
    const domain = address.slice(address.lastIndexOf("@") + 1);
    if (await activeSuppressionOf(db, "domain", domain)) return { send: false, why: "suppressed" };
  }
  const consent = await consentOf(db, channel, address, await topicId(db, input.topic, channel));
  if (!consent) return { send: false, why: "no consent" };
  if (consent.state !== "confirmed") return { send: false, why: consent.state, consent };
  if (consent.pausedUntil && consent.pausedUntil > now) {
    return { send: false, why: "paused", consent };
  }
  // The cap counts every marketing send to this address on this channel, any topic.
  const mine = and(eq(consents.channel, channel), eq(consents.address, address));
  const gap = FREQUENCY_DAYS[consent.frequency];
  if (gap > 0) {
    const [last] = await db
      .select({ at: max(consents.lastSentAt) })
      .from(consents)
      .where(mine);
    if (last?.at && now.getTime() - last.at.getTime() < gap * DAY) {
      return { send: false, why: "capped", consent };
    }
  }
  if (channel === "sms") {
    const [sent] = await db
      .select({ n: count() })
      .from(consentEvents)
      .innerJoin(consents, eq(consents.id, consentEvents.consentId))
      .where(
        and(
          mine,
          eq(consentEvents.kind, "sent"),
          gt(consentEvents.createdAt, new Date(now.getTime() - SMS_WINDOW_DAYS * DAY)),
        ),
      );
    if ((sent?.n ?? 0) >= SMS_CAP) return { send: false, why: "capped", consent };
  }
  return { send: true, consent };
}

/** A send happened: the cap counts it, and the subscriber's record shows it. */
export async function recordMarketingSend(
  db: Queryable,
  input: { consentId: number; by: string; evidence?: Evidence; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await atomic(db, async (tx) => {
    await tx.update(consents).set({ lastSentAt: now }).where(eq(consents.id, input.consentId));
    await tx.insert(consentEvents).values({
      consentId: input.consentId,
      kind: "sent",
      by: input.by,
      evidence: input.evidence ?? null,
      createdAt: now,
    });
  });
}

/**
 * Whether a confirm email may go to an address: not after a bounce, a complaint or a manual
 * block, nor to a suppressed domain. An opt-out may: its confirm click is what lifts it.
 */
export async function mayAskConsent(db: Queryable, channel: MarketingChannel, address: string) {
  const a = addressOf(channel, address);
  const own = await activeSuppressionOf(db, kindOf(channel), a);
  if (own && own.reason !== "opt_out") return false;
  if (channel !== "email") return true;
  return !(await activeSuppressionOf(db, "domain", a.slice(a.lastIndexOf("@") + 1)));
}

export interface SignUp {
  channel: MarketingChannel;
  address: string;
  topic: string;
  source: ConsentSource;
  /** The version of the words next to the box. */
  textVersion: string;
  /** Form URL, IP, user agent, the exact consent text. */
  evidence: Evidence;
  by: string;
  now?: Date;
}

/**
 * A signup that still needs its confirm click (email double opt-in). Already confirmed, or asked
 * within the last day: nothing changes and `confirm` is false, so no second confirm email goes out.
 */
export async function askConsent(
  db: Queryable,
  input: SignUp,
): Promise<{ consent: Consent; confirm: boolean }> {
  const now = input.now ?? new Date();
  const address = addressOf(input.channel, input.address);
  return serializable(db, async (tx) => {
    const topic = await topicId(tx, input.topic, input.channel);
    const had = await consentOf(tx, input.channel, address, topic);
    if (had?.state === "confirmed") return { consent: had, confirm: false };
    // A form posted again within a day sends no second confirm email: the form is public.
    if (had?.state === "pending" && had.pendingAt && now.getTime() - had.pendingAt.getTime() < DAY)
      return { consent: had, confirm: false };
    const fields = {
      state: "pending" as const,
      source: input.source,
      textVersion: input.textVersion,
      pendingAt: now,
    };
    const [row] = had
      ? await tx.update(consents).set(fields).where(eq(consents.id, had.id)).returning()
      : await tx
          .insert(consents)
          .values({ channel: input.channel, address, topicId: topic, ...fields })
          .returning();
    if (!row) throw new Error("consent write returned nothing");
    await log(tx, row.id, "pending", input.by, input.evidence);
    return { consent: row, confirm: true };
  });
}

/**
 * The confirm click on a pending signup. Null when there is none, or it is older than 7 days.
 * A double opt-in that started after the address's opt-out lifts that opt-out, with this consent
 * as the evidence. Nothing else lifts an opt-out.
 */
export async function confirmConsent(
  db: Queryable,
  input: {
    channel: MarketingChannel;
    address: string;
    topic: string;
    evidence: Evidence;
    by: string;
    now?: Date;
  },
): Promise<Consent | null> {
  const now = input.now ?? new Date();
  const address = addressOf(input.channel, input.address);
  return serializable(db, async (tx) => {
    const had = await consentOf(
      tx,
      input.channel,
      address,
      await topicId(tx, input.topic, input.channel),
    );
    if (had?.state === "confirmed") return had;
    if (had?.state !== "pending" || !had.pendingAt) return null;
    if (now.getTime() - had.pendingAt.getTime() > PENDING_DAYS * DAY) return null;
    const [row] = await tx
      .update(consents)
      .set({ state: "confirmed", confirmedAt: now })
      .where(eq(consents.id, had.id))
      .returning();
    if (!row) return null;
    const event = await log(tx, row.id, "confirmed", input.by, input.evidence);
    await liftOlderOptOut(tx, input.channel, address, had.pendingAt, {
      consent: row.id,
      event,
      doubleOptIn: true,
    });
    return row;
  });
}

/** Lift the address's opt-out when its newest event is an opt-out older than `signedUpAt`. */
async function liftOlderOptOut(
  db: Queryable,
  channel: MarketingChannel,
  address: string,
  signedUpAt: Date,
  evidence: Evidence,
) {
  const kind = kindOf(channel);
  const active = await activeSuppressionOf(db, kind, address);
  if (!active) return;
  const [last] = await db
    .select({ reason: suppressionEvents.reason, at: suppressionEvents.createdAt })
    .from(suppressionEvents)
    .where(eq(suppressionEvents.suppressionId, active.id))
    .orderBy(desc(suppressionEvents.id))
    .limit(1);
  // A bounce or a complaint is not the person's to undo; only their own opt-out is.
  if (last?.reason === "opt_out" && last.at < signedUpAt) {
    await liftSuppression(db, { kind, value: address, evidence });
  }
}

/**
 * A consent given and proven in one step: a Meta lead form's checked box, an SMS keyword.
 * It never lifts an opt-out (only a double opt-in does), so a suppressed address stays unsendable.
 */
export async function giveConsent(db: Queryable, input: SignUp): Promise<Consent> {
  const now = input.now ?? new Date();
  const address = addressOf(input.channel, input.address);
  return serializable(db, async (tx) => {
    const topic = await topicId(tx, input.topic, input.channel);
    const had = await consentOf(tx, input.channel, address, topic);
    if (had?.state === "confirmed") return had;
    const fields = {
      state: "confirmed" as const,
      source: input.source,
      textVersion: input.textVersion,
      confirmedAt: now,
    };
    const [row] = had
      ? await tx.update(consents).set(fields).where(eq(consents.id, had.id)).returning()
      : await tx
          .insert(consents)
          .values({ channel: input.channel, address, topicId: topic, ...fields })
          .returning();
    if (!row) throw new Error("consent write returned nothing");
    await log(tx, row.id, "confirmed", input.by, input.evidence);
    return row;
  });
}

/** Off one topic. Null when there was nothing to withdraw. */
export async function withdrawConsent(
  db: Queryable,
  input: {
    channel: MarketingChannel;
    address: string;
    topic: string;
    evidence?: Evidence;
    by: string;
    now?: Date;
  },
): Promise<Consent | null> {
  const now = input.now ?? new Date();
  const address = addressOf(input.channel, input.address);
  return atomic(db, async (tx) => {
    const had = await consentOf(
      tx,
      input.channel,
      address,
      await topicId(tx, input.topic, input.channel),
    );
    if (!had || had.state === "withdrawn") return null;
    const [row] = await tx
      .update(consents)
      .set({ state: "withdrawn", withdrawnAt: now })
      .where(eq(consents.id, had.id))
      .returning();
    if (!row) return null;
    await log(tx, row.id, "withdrawn", input.by, input.evidence ?? null);
    return row;
  });
}

/** Every consent of one address on one channel: the preference center's settings apply to all. */
async function settle(
  db: Queryable,
  channel: MarketingChannel,
  address: string,
  set: { frequency: Frequency } | { pausedUntil: Date | null },
  kind: ConsentEventKind,
  by: string,
): Promise<number> {
  return atomic(db, async (tx) => {
    const rows = await tx
      .update(consents)
      .set(set)
      .where(and(eq(consents.channel, channel), eq(consents.address, address)))
      .returning({ id: consents.id });
    const evidence =
      "frequency" in set ? set : { pausedUntil: set.pausedUntil?.toISOString() ?? null };
    for (const r of rows) await log(tx, r.id, kind, by, evidence);
    return rows.length;
  });
}

/** How often this channel may market to the person. Returns the consents it changed. */
export function setFrequency(
  db: Queryable,
  input: { channel: MarketingChannel; address: string; frequency: Frequency; by: string },
): Promise<number> {
  const address = addressOf(input.channel, input.address);
  return settle(db, input.channel, address, { frequency: input.frequency }, "frequency", input.by);
}

/** Pause the channel for 30 or 90 days; `days: null` ends a pause. */
export function pauseMarketing(
  db: Queryable,
  input: {
    channel: MarketingChannel;
    address: string;
    days: 30 | 90 | null;
    by: string;
    now?: Date;
  },
): Promise<number> {
  const now = input.now ?? new Date();
  const address = addressOf(input.channel, input.address);
  const pausedUntil = input.days ? new Date(now.getTime() + input.days * DAY) : null;
  return settle(db, input.channel, address, { pausedUntil }, "paused", input.by);
}

/**
 * "Unsubscribe from everything": an opt-out suppression, so nothing reaches this address again,
 * cold outreach included. Consents stay as they were, and the suppression beats them. Returns the
 * suppression event's id, which is what an Undo names.
 */
export async function unsubscribeEverything(
  db: Queryable,
  input: { channel: MarketingChannel; address: string; evidence: Evidence },
): Promise<number> {
  const kind = kindOf(input.channel);
  return atomic(db, async (tx) => {
    const { row } = await addSuppression(tx, {
      kind,
      value: input.address,
      reason: "opt_out",
      evidence: { ...input.evidence, via: "preference center" },
    });
    const [e] = await tx
      .select({ id: suppressionEvents.id })
      .from(suppressionEvents)
      .where(eq(suppressionEvents.suppressionId, row.id))
      .orderBy(desc(suppressionEvents.id))
      .limit(1);
    return e?.id ?? 0;
  });
}

/**
 * Undo on the page that just unsubscribed. It lifts only that opt-out, only while it is still the
 * address's newest suppression event, and only within a day: the person's own click, undone by
 * them. True when it lifted.
 */
export async function undoUnsubscribeEverything(
  db: Queryable,
  input: { channel: MarketingChannel; address: string; event: number; now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const kind = kindOf(input.channel);
  const address = addressOf(input.channel, input.address);
  return serializable(db, async (tx) => {
    const active = await activeSuppressionOf(tx, kind, address);
    if (!active) return false;
    const [last] = await tx
      .select()
      .from(suppressionEvents)
      .where(eq(suppressionEvents.suppressionId, active.id))
      .orderBy(desc(suppressionEvents.id))
      .limit(1);
    if (!last || last.id !== input.event || last.reason !== "opt_out") return false;
    if (now.getTime() - last.createdAt.getTime() > UNDO_HOURS * 3_600_000) return false;
    await liftSuppression(tx, { kind, value: address, evidence: { undo: input.event }, now });
    return true;
  });
}

/** What the preference center shows: every public topic on the address's channels, and its state. */
export async function preferencesOf(db: Queryable, channel: MarketingChannel, address: string) {
  const a = addressOf(channel, address);
  const [list, mine, suppressed] = await Promise.all([
    db
      .select()
      .from(topics)
      .where(and(eq(topics.public, true), eq(topics.channel, channel))),
    db
      .select()
      .from(consents)
      .where(and(eq(consents.channel, channel), eq(consents.address, a))),
    activeSuppressionOf(db, kindOf(channel), a),
  ]);
  const by = new Map(mine.map((c) => [c.topicId, c]));
  const first = mine[0];
  return {
    address: a,
    everything: !!suppressed,
    frequency: first?.frequency ?? ("as_sent" as Frequency),
    pausedUntil: first?.pausedUntil ?? null,
    topics: list.map((t) => ({
      name: t.name,
      publicName: t.publicName,
      line: t.line,
      cadence: t.cadence,
      on: by.get(t.id)?.state === "confirmed",
    })),
  };
}

/** Consent ids → their events, oldest first, for a subscriber's activity. */
export function consentHistory(db: Queryable, ids: number[]) {
  return db
    .select()
    .from(consentEvents)
    .where(inArray(consentEvents.consentId, ids))
    .orderBy(consentEvents.createdAt, consentEvents.id);
}

// ---- Links: the preference center needs no login, so its address is signed.

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (key: string, body: string) =>
  createHmac("sha256", key).update(body).digest().subarray(0, 18);

/** Who a link is for: an address on a channel, and the topic a confirm or unsubscribe names. */
export interface LinkFor {
  channel: MarketingChannel;
  address: string;
  topic?: string | undefined;
}

/** The key preference links are signed with, from the secret the lander and Wren share. */
export const linkKey = (shared: string) =>
  createHmac("sha256", shared).update("wren prefs v1").digest("hex");

/** The lander's proof that a signup passed its bot check: only the lander holds `shared`. */
export const signupSig = (shared: string, topic: string, address: string) =>
  createHmac("sha256", shared)
    .update(`signup:${topic}:${address.trim().toLowerCase()}`)
    .digest("hex");

/** `<payload>.<mac>`, both base64url: the address in it is the subscriber's own. */
export function signLink(key: string, to: LinkFor): string {
  const body = b64(JSON.stringify([to.channel, to.address, to.topic ?? null]));
  return `${body}.${b64(mac(key, body))}`;
}

/** The link's subscriber, or null when it was not signed with `key` or does not parse. */
export function readLink(key: string, token: string): LinkFor | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = mac(key, body);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const [channel, address, topic] = JSON.parse(Buffer.from(body, "base64url").toString());
    if (channel !== "email" && channel !== "sms") return null;
    if (typeof address !== "string") return null;
    return { channel, address, ...(typeof topic === "string" ? { topic } : {}) };
  } catch {
    return null;
  }
}

/**
 * What every marketing email carries: one-click unsubscribe headers (RFC 8058) for its topic, and
 * a footer with the preference center and the postal address the law asks for.
 */
export function marketingEnvelope(o: {
  key: string;
  /** The lander: "https://wrenautomation.com". */
  site: string;
  address: string;
  topic: string;
  /** The sender's postal address. A marketing mail without one is refused. */
  postal: string;
  /** Why they get it: "You signed up at wrenautomation.com." */
  why: string;
}): { headers: [string, string][]; footer: string } {
  if (!o.postal.trim()) throw new Error("a marketing email needs a postal address");
  const prefs = `${o.site}/prefs/${signLink(o.key, { channel: "email", address: o.address })}`;
  const off = `${o.site}/prefs/${signLink(o.key, { channel: "email", address: o.address, topic: o.topic })}?off=1`;
  return {
    headers: [
      ["List-Unsubscribe", `<${off}>`],
      ["List-Unsubscribe-Post", "List-Unsubscribe=One-Click"],
    ],
    footer: `\n\n--\n${o.why}\nChange what you get or unsubscribe: ${prefs}\n${o.postal.trim()}`,
  };
}
