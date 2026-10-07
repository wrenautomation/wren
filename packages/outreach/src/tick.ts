/**
 * The send tick, in steps a journal can bracket: every database move is one
 * step (`run`), every platform call sits between two of them. On Restate the
 * steps are `ctx.run` and the platform calls are journaled service calls to
 * the Mac's desk, so a crash anywhere replays to the same outcome. In tests
 * `run` is a plain call.
 *
 * Per account at most one send a tick, inside the window, under the account's
 * standing for the day (policy.ts). Intent before act: the row is `sending`
 * in its own step before the platform is called; a `sending` row older than
 * ten minutes becomes `unknown` and nothing ever resends. Messaging a
 * stranger twice is worse than missing one.
 *
 * LinkedIn: a sequence step goes only once the invite is accepted. When the
 * step is due the tick reads the relationship: connected = send (and mark the
 * contact connected), pending = ask again tomorrow, past `connectWaitDays` =
 * `unreachable`. An accepted invite's send queues step 1. A sent step is listed
 * in `stepped`: the sender hands it to the spine, whose wire waits `afterDays`
 * and queues the next (`touch`). After the last, the contact is `finished`.
 * The live gate off holds every sequence and follow-up row; a manual row is William's own yes and
 * goes, from an active or a warming account (its rung's caps still apply).
 * A 429 from the worker (its caps) holds the row an hour; any other 4xx fails
 * it and ends the contact as `unreachable`; anything else leaves `unknown`.
 */
import { SiteCallError } from "@wren/core/content";
import type { OutreachChannel, Relationship, Sent } from "@wren/core/outreach";
import type { Queryable } from "@wren/db";
import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { healthOf } from "./accounts.js";
import { contactsById, fieldsFor, setContactState } from "./contacts.js";
import { FLEET_ZONE, fleetDay, inWindow, type ReachPolicy, standingOf } from "./policy.js";
import { ReachRefusal } from "./refusal.js";
import {
  type ReachAccount,
  type ReachContact,
  type ReachMessage,
  reachAccounts,
  reachContacts,
  reachMessages,
} from "./schema.js";
import { dmSeed, type ReachSequence, render, stepKey, subjectKey } from "./sequences.js";
import { liveDms } from "./store.js";
import { keepTouch, touchFromMessage } from "./touches.js";

/** A `sending` row older than this lost its platform call to a crash. */
export const STALE_SENDING_MS = 10 * 60 * 1000;
const DAY_MS = 86_400_000;
const HOLD_MS = 60 * 60 * 1000;
const SCAN = 100;

export interface TickOptions {
  channelFor: (a: ReachAccount) => OutreachChannel | null;
  policy: ReachPolicy;
  sequences: ReadonlyMap<string, ReachSequence>;
  sender: string;
  live: boolean;
  /**
   * A client's live flags by message kind (`connect` = invites): when given, a row of a kind it
   * says no to holds as `gated`, a typed one too. Wren's own run has none.
   */
  sends?: (kind: ReachMessage["kind"]) => boolean;
  now: Date;
  runId?: string | null;
}

export interface TickStats {
  sent: number;
  connected: number;
  /** Due rows held: `window`, `gated` (live off), `warming` (a sequence row on a warming account), `cap`, `frozen`, `pending` (invite not accepted), `retry`. */
  held: Record<string, number>;
  failed: number;
  reconciled: number;
  finished: number;
  unreachable: number;
  /** Sequence steps sent, each leaving its cadence node on the spine. */
  stepped: Array<{ contactId: number; sequence: string; step: number }>;
}

/** One due row the plan picked, with what it needs. Dates travel as ISO through a journal. */
export interface Candidate {
  row: ReachMessage;
  contact: ReachContact;
  account: ReachAccount;
  /** LinkedIn step: ask the relationship first. */
  checkRelationship: boolean;
}

export const emptyStats = (): TickStats => ({
  sent: 0,
  connected: 0,
  held: {},
  failed: 0,
  reconciled: 0,
  finished: 0,
  unreachable: 0,
  stepped: [],
});

const hold = (stats: TickStats, why: string) => {
  stats.held[why] = (stats.held[why] ?? 0) + 1;
};

/** `sending` rows past STALE become `unknown`: the call's fate is lost, never resent. */
export async function reconcile(db: Queryable, now: Date): Promise<number> {
  const rows = await db
    .update(reachMessages)
    .set({ state: "unknown", stateReason: "the platform call's outcome was lost" })
    .where(
      and(
        eq(reachMessages.state, "sending"),
        lt(reachMessages.createdAt, new Date(now.getTime() - STALE_SENDING_MS)),
      ),
    )
    .returning({ id: reachMessages.id });
  return rows.length;
}

/** Today's sends from each account, by kind (fleet day). */
async function sentToday(
  db: Queryable,
  accountIds: readonly string[],
  now: Date,
): Promise<Map<string, { connects: number; messages: number }>> {
  const day = fleetDay(now);
  const rows = await db
    .select({
      accountId: reachMessages.accountId,
      kind: reachMessages.kind,
      n: sql<number>`count(*)::int`,
    })
    .from(reachMessages)
    .where(
      and(
        inArray(reachMessages.accountId, [...accountIds]),
        inArray(reachMessages.state, ["sent", "sending", "unknown"]),
        eq(reachMessages.direction, "out"),
        gte(reachMessages.createdAt, new Date(now.getTime() - 2 * DAY_MS)),
        sql`to_char(coalesce(${reachMessages.sentAt}, ${reachMessages.createdAt}) at time zone ${FLEET_ZONE}, 'YYYY-MM-DD') = ${day}`,
      ),
    )
    .groupBy(reachMessages.accountId, reachMessages.kind);
  const out = new Map<string, { connects: number; messages: number }>();
  for (const r of rows) {
    if (!r.accountId) continue;
    const cur = out.get(r.accountId) ?? { connects: 0, messages: 0 };
    if (r.kind === "connect") cur.connects += r.n;
    else cur.messages += r.n;
    out.set(r.accountId, cur);
  }
  return out;
}

/** Invites with a note this account sent this fleet month. */
async function notesThisMonth(db: Queryable, accountId: string, now: Date): Promise<number> {
  const month = fleetDay(now).slice(0, 7);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reachMessages)
    .where(
      and(
        eq(reachMessages.accountId, accountId),
        eq(reachMessages.kind, "connect"),
        inArray(reachMessages.state, ["sent", "sending", "unknown"]),
        sql`${reachMessages.body} <> ''`,
        gte(reachMessages.createdAt, new Date(now.getTime() - 32 * DAY_MS)),
        sql`to_char(coalesce(${reachMessages.sentAt}, ${reachMessages.createdAt}) at time zone ${FLEET_ZONE}, 'YYYY-MM') = ${month}`,
      ),
    );
  return r?.n ?? 0;
}

/**
 * Step 1 (database only): reconcile, then pick at most one due row per active
 * account that may go now. Rows for a contact no longer enrolled are skipped
 * here.
 */
export async function planTick(
  db: Queryable,
  o: Omit<TickOptions, "channelFor">,
): Promise<{ stats: TickStats; candidates: Candidate[] }> {
  const stats = emptyStats();
  const candidates: Candidate[] = [];
  stats.reconciled = await reconcile(db, o.now);
  const accounts = await db
    .select()
    .from(reachAccounts)
    .where(inArray(reachAccounts.state, ["active", "warming"]));
  if (accounts.length === 0) return { stats, candidates };
  const byAccount = new Map(accounts.map((a) => [a.id, a]));
  const scanned: ReachMessage[] = await db
    .select()
    .from(reachMessages)
    .where(
      and(
        eq(reachMessages.state, "queued"),
        eq(reachMessages.direction, "out"),
        inArray(reachMessages.accountId, [...byAccount.keys()]),
        or(isNull(reachMessages.dueAt), lte(reachMessages.dueAt, o.now)),
      ),
    )
    .orderBy(asc(reachMessages.dueAt), asc(reachMessages.id))
    .limit(SCAN);
  if (scanned.length === 0) return { stats, candidates };
  if (!inWindow(o.now, o.policy)) {
    for (const _ of scanned) hold(stats, "window");
    return { stats, candidates };
  }
  const due = scanned.filter((r) => {
    if (o.sends && !o.sends(r.kind)) {
      hold(stats, "gated");
      return false;
    }
    if (r.kind === "manual") return true;
    if (o.live && byAccount.get(r.accountId ?? "")?.state === "active") return true;
    hold(stats, o.live ? "warming" : "gated");
    return false;
  });
  if (due.length === 0) return { stats, candidates };
  const today = await sentToday(db, [...byAccount.keys()], o.now);
  const contacts = await contactsById(
    db,
    due.map((r) => r.contactId),
  );
  const taken = new Set<string>();
  for (const row of due) {
    const account = row.accountId ? byAccount.get(row.accountId) : undefined;
    const contact = contacts.get(row.contactId);
    if (!account || !contact) continue;
    // Sequence rows ride the enrollment; a manual reply goes to anyone who has not asked us to
    // stop; a follow-up to anyone who has not stopped us or answered since it was queued.
    const allowed =
      row.kind === "manual"
        ? !["opted_out", "blocked", "unreachable"].includes(contact.state)
        : row.kind === "follow_up"
          ? !["opted_out", "blocked", "unreachable", "replied"].includes(contact.state)
          : ["enrolled", "connected"].includes(contact.state);
    if (!allowed) {
      await db
        .update(reachMessages)
        .set({ state: "skipped", stateReason: `contact is ${contact.state}` })
        .where(eq(reachMessages.id, row.id));
      continue;
    }
    if (taken.has(account.id)) {
      hold(stats, "gap");
      continue;
    }
    const standing = standingOf(
      { platform: account.platform, startedOn: account.startedOn, health: healthOf(account) },
      o.policy,
      o.now,
    );
    if (standing.frozen) {
      hold(stats, "frozen");
      continue;
    }
    const spent = today.get(account.id) ?? { connects: 0, messages: 0 };
    const left =
      row.kind === "connect"
        ? standing.caps.connects - spent.connects
        : standing.caps.messages - spent.messages;
    if (left <= 0) {
      hold(stats, "cap");
      continue;
    }
    if (
      row.kind === "connect" &&
      row.body &&
      (await notesThisMonth(db, account.id, o.now)) >= o.policy.linkedin.notesPerMonth
    ) {
      // The month's notes are spent: the invite goes bare rather than failing.
      await db.update(reachMessages).set({ body: "" }).where(eq(reachMessages.id, row.id));
      row.body = "";
    }
    const seq = contact.sequence ? o.sequences.get(contact.sequence) : undefined;
    taken.add(account.id);
    candidates.push({
      row,
      contact,
      account,
      checkRelationship: row.kind !== "connect" && Boolean(seq?.connectFirst),
    });
  }
  return { stats, candidates };
}

/** Step 2 (LinkedIn): what the relationship read means for this row. */
export async function applyRelationship(
  db: Queryable,
  c: Candidate,
  rel: Relationship,
  o: Pick<TickOptions, "sequences" | "now">,
  stats: TickStats,
): Promise<"send" | "wait"> {
  const seq = c.contact.sequence ? o.sequences.get(c.contact.sequence) : undefined;
  if (rel === "connected") {
    if (c.contact.state !== "connected") {
      await db
        .update(reachContacts)
        .set({ state: "connected", connectedAt: o.now })
        .where(eq(reachContacts.id, c.contact.id));
      stats.connected++;
    }
    return "send";
  }
  const waitDays = seq?.connectWaitDays ?? 21;
  const invitedAt = new Date(c.contact.enrolledAt ?? c.contact.createdAt);
  if (o.now.getTime() - invitedAt.getTime() > waitDays * DAY_MS) {
    await db
      .update(reachMessages)
      .set({ state: "skipped", stateReason: `invite not accepted in ${waitDays} days` })
      .where(eq(reachMessages.id, c.row.id));
    await setContactState(db, c.contact.id, "unreachable", {
      reason: `invite ${rel} after ${waitDays} days`,
      now: o.now,
    });
    stats.unreachable++;
  } else {
    await db
      .update(reachMessages)
      .set({ dueAt: new Date(o.now.getTime() + DAY_MS), stateReason: `invite ${rel}` })
      .where(eq(reachMessages.id, c.row.id));
    hold(stats, "pending");
  }
  return "wait";
}

/** Step 3: intent. */
export async function markSending(db: Queryable, rowId: number): Promise<void> {
  await db
    .update(reachMessages)
    .set({ state: "sending", stateReason: null })
    .where(eq(reachMessages.id, rowId));
}

/** Queue step `step`, due `dueAt`; an emptied step finishes the contact instead. False if it ended. */
async function queueStep(
  db: Queryable,
  o: Pick<TickOptions, "sender" | "now"> & { runId?: string | null },
  seq: ReachSequence,
  contact: ReachContact,
  step: number,
  dueAt: Date,
): Promise<boolean> {
  const next = seq.steps.find((s) => s.step === step);
  const keys = next ? [stepKey(seq, step), ...(next.subject ? [subjectKey(seq, step)] : [])] : [];
  const bodies = await liveDms(db, keys);
  const body = bodies.get(stepKey(seq, step));
  if (!next || !body) {
    // Emptied since enroll: the contact ends here rather than waiting on a blank.
    await setContactState(db, contact.id, "finished", {
      reason: next ? `${stepKey(seq, step)} is empty` : `${seq.name} has no step ${step}`,
      now: o.now,
    });
    return false;
  }
  const fields = fieldsFor(contact, o.sender);
  const seed = dmSeed(contact.id);
  const subject = bodies.get(subjectKey(seq, step));
  const text = render(body, fields, seed);
  await db.insert(reachMessages).values({
    contactId: contact.id,
    accountId: contact.accountId,
    direction: "out",
    kind: "sequence",
    step,
    template: stepKey(seq, step),
    templateVersion: text.provenance.version,
    provenance: text.provenance,
    subject: next.subject ? (subject ? render(subject, fields, seed).body : "") : null,
    body: text.body,
    state: "queued",
    dueAt,
    runId: o.runId ?? null,
  });
  return true;
}

/**
 * Queue step `step` of a contact's sequence, due now: the spine's `reach.touch`, once its wait
 * is over. A contact who replied answers "replied"; any other end, or an emptied step, sends
 * nothing. Queueing a step twice is a no-op.
 */
export async function touch(
  db: Queryable,
  contactId: number,
  step: number,
  o: Pick<TickOptions, "sequences" | "sender" | "now">,
): Promise<"queued" | "replied" | "ended"> {
  const [contact] = await db.select().from(reachContacts).where(eq(reachContacts.id, contactId));
  if (contact?.state === "replied") return "replied";
  if (contact?.state !== "enrolled" && contact?.state !== "connected") return "ended";
  const seq = contact.sequence ? o.sequences.get(contact.sequence) : undefined;
  if (!seq) {
    await setContactState(db, contact.id, "finished", { reason: "no sequence", now: o.now });
    return "ended";
  }
  const [queued] = await db
    .select({ id: reachMessages.id })
    .from(reachMessages)
    .where(
      and(
        eq(reachMessages.contactId, contactId),
        eq(reachMessages.kind, "sequence"),
        eq(reachMessages.step, step),
      ),
    );
  if (queued) return "queued";
  return (await queueStep(db, o, seq, contact, step, o.now)) ? "queued" : "ended";
}

/** Step 4a: the platform took it. The next step is queued, or the contact finished. */
export async function recordSent(
  db: Queryable,
  c: Candidate,
  sent: Sent,
  o: Pick<TickOptions, "sequences" | "sender" | "now" | "runId">,
  stats: TickStats,
): Promise<void> {
  await db
    .update(reachMessages)
    .set({ state: "sent", sentAt: o.now, ref: sent.ref })
    .where(eq(reachMessages.id, c.row.id));
  await keepTouch(`rm:${c.row.id}`, () => touchFromMessage(db, c.row.id));
  stats.sent++;
  const seq = c.contact.sequence ? o.sequences.get(c.contact.sequence) : undefined;
  if (!seq) return;
  if (c.row.kind === "connect") {
    // Invite only: the contact waits enrolled; the invites sweep finds the accept.
    if (seq.steps.length === 0) return;
    const first = seq.steps[0]?.step ?? 1;
    if (!(await queueStep(db, o, seq, c.contact, first, o.now))) stats.finished++;
  } else if (c.row.kind === "sequence" && c.row.step) {
    const step = c.row.step;
    stats.stepped.push({ contactId: c.contact.id, sequence: seq.name, step });
    if (seq.steps.some((s) => s.step > step)) return;
    await setContactState(db, c.contact.id, "finished", { now: o.now });
    stats.finished++;
  }
}

/** Step 4b: the platform did not take it, or we do not know. */
export async function recordFailure(
  db: Queryable,
  c: Candidate,
  err: unknown,
  now: Date,
  stats: TickStats,
): Promise<void> {
  const text = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  if (err instanceof SiteCallError && err.status === 429) {
    await db
      .update(reachMessages)
      .set({ state: "queued", dueAt: new Date(now.getTime() + HOLD_MS), stateReason: text })
      .where(eq(reachMessages.id, c.row.id));
    hold(stats, "retry");
    return;
  }
  if (err instanceof SiteCallError && err.status >= 400 && err.status < 500) {
    await db
      .update(reachMessages)
      .set({ state: "failed", stateReason: text })
      .where(eq(reachMessages.id, c.row.id));
    await setContactState(db, c.contact.id, "unreachable", { reason: text, now });
    stats.failed++;
    stats.unreachable++;
    return;
  }
  await db
    .update(reachMessages)
    .set({ state: "unknown", stateReason: text })
    .where(eq(reachMessages.id, c.row.id));
  stats.failed++;
}

/** A journal step: on Restate `ctx.run`, in tests a plain call. */
export type Journal = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

/** The whole tick over a journal: the loop object and the tests both run this. */
export async function tick(
  db: Queryable,
  o: TickOptions,
  run: Journal = (_n, fn) => fn(),
): Promise<TickStats> {
  const { stats, candidates } = await run("plan", () => planTick(db, o));
  const stepStats = async (name: string, body: (s: TickStats) => Promise<unknown>) => {
    const s = await run(name, async () => {
      const s = emptyStats();
      await body(s);
      return s;
    });
    merge(stats, s);
    return s;
  };
  for (const c of candidates) {
    const channel = o.channelFor(c.account);
    if (!channel || (c.checkRelationship && !channel.relationship)) {
      hold(stats, "no-channel");
      continue;
    }
    if (c.checkRelationship) {
      const rel = await (channel.relationship as NonNullable<typeof channel.relationship>)(
        c.contact.handle,
      );
      const verdict = await run(`relationship ${c.row.id}`, async () => {
        const s = emptyStats();
        const v = await applyRelationship(db, c, rel, o, s);
        return { v, s };
      });
      merge(stats, verdict.s);
      if (verdict.v !== "send") continue;
    }
    await run(`sending ${c.row.id}`, () => markSending(db, c.row.id));
    let sent: Sent;
    try {
      sent =
        c.row.kind === "connect"
          ? await (channel.connect as NonNullable<typeof channel.connect>)(
              c.contact.handle,
              c.row.body || null,
            )
          : await channel.message(c.contact.handle, c.row.body, c.row.subject);
    } catch (err) {
      await stepStats(`failed ${c.row.id}`, (s) => recordFailure(db, c, err, o.now, s));
      continue;
    }
    await stepStats(`sent ${c.row.id}`, (s) => recordSent(db, c, sent, o, s));
  }
  return stats;
}

function merge(into: TickStats, from: TickStats) {
  into.sent += from.sent;
  into.connected += from.connected;
  into.failed += from.failed;
  into.finished += from.finished;
  into.unreachable += from.unreachable;
  into.stepped.push(...from.stepped);
  for (const [k, v] of Object.entries(from.held)) into.held[k] = (into.held[k] ?? 0) + v;
}

/** A message typed by the operator on a thread, out on the next tick from the contact's account. */
export async function queueManual(
  db: Queryable,
  req: { contact: ReachContact; body: string; subject?: string | null; now: Date },
): Promise<ReachMessage> {
  if (!req.contact.accountId)
    throw new ReachRefusal("the contact has no account yet: enroll first");
  const [row] = await db
    .insert(reachMessages)
    .values({
      contactId: req.contact.id,
      accountId: req.contact.accountId,
      direction: "out",
      kind: "manual",
      subject: req.subject ?? null,
      body: req.body.trim(),
      state: "queued",
      dueAt: req.now,
    })
    .returning();
  return row as ReachMessage;
}
