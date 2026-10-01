/**
 * The send tick: due rows out, at most one per account per tick, inside the
 * window, under each account's standing for the day. Intent before act: a
 * row is marked `sending` in its own write before the platform is called, so
 * a crash leaves a `sending` row, which `reconcile` turns into `unknown` and
 * nothing ever resends. Messaging a stranger twice is worse than missing one.
 *
 * LinkedIn: a sequence step goes only once the invite is accepted. The step
 * is due a day after the invite; when due, the tick reads the relationship:
 * connected = send (and mark the contact connected), pending = ask again
 * tomorrow, and past `connectWaitDays` the contact is `unreachable`.
 *
 * After a step is sent the next is queued `afterDays` later; after the last,
 * the contact is `finished`. The live gate: `live` off holds every due row,
 * counted, nothing leaves. A 429 from the worker (its own caps) holds the row
 * for the retry it names; any other platform refusal fails the row and ends
 * the contact as `unreachable`.
 */
import { SiteCallError } from "@wren/core/content";
import type { OutreachChannel } from "@wren/core/outreach";
import type { Queryable } from "@wren/db";
import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { activeAccounts, healthOf } from "./accounts.js";
import { contactsById, fieldsFor, setContactState } from "./contacts.js";
import { fleetDay, inWindow, type ReachPolicy, standingOf } from "./policy.js";
import {
  type ReachAccount,
  type ReachContact,
  type ReachMessage,
  reachContacts,
  reachMessages,
} from "./schema.js";
import { type ReachSequence, render, stepKey, subjectKey } from "./sequences.js";
import { templateBodies } from "./store.js";

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
  now: Date;
  runId?: string | null;
}

export interface TickStats {
  sent: number;
  connected: number;
  /** Due rows held: `window`, `gated` (live off), `cap`, `frozen`, `pending` (invite not accepted), `retry`. */
  held: Record<string, number>;
  failed: number;
  reconciled: number;
  finished: number;
  unreachable: number;
}

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

/** Today's sends from each account, by kind. */
async function sentToday(
  db: Queryable,
  accountIds: readonly string[],
  now: Date,
): Promise<Map<string, { connects: number; messages: number }>> {
  const day = fleetDay(now);
  const from = new Date(`${day}T00:00:00-04:00`);
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
        gte(reachMessages.createdAt, new Date(from.getTime() - 6 * 60 * 60 * 1000)),
        sql`${reachMessages.sentAt} IS NULL OR ${reachMessages.sentAt} >= ${from}`,
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

const hold = (stats: TickStats, why: string) => {
  stats.held[why] = (stats.held[why] ?? 0) + 1;
};

async function defer(db: Queryable, row: ReachMessage, until: Date, why: string) {
  await db
    .update(reachMessages)
    .set({ dueAt: until, stateReason: why })
    .where(eq(reachMessages.id, row.id));
}

async function fail(db: Queryable, row: ReachMessage, why: string, now: Date, stats: TickStats) {
  await db
    .update(reachMessages)
    .set({ state: "failed", stateReason: why.slice(0, 500) })
    .where(eq(reachMessages.id, row.id));
  await setContactState(db, row.contactId, "unreachable", { reason: why.slice(0, 500), now });
  stats.failed++;
  stats.unreachable++;
}

async function queueNext(
  db: Queryable,
  o: TickOptions,
  seq: ReachSequence,
  contact: ReachContact,
  afterStep: number,
  stats: TickStats,
) {
  const next = seq.steps.find((s) => s.step === afterStep + 1);
  if (!next) {
    await setContactState(db, contact.id, "finished", { now: o.now });
    stats.finished++;
    return;
  }
  const keys = [stepKey(seq, next.step), ...(next.subject ? [subjectKey(seq, next.step)] : [])];
  const bodies = await templateBodies(db, keys);
  const body = bodies.get(stepKey(seq, next.step));
  if (!body) {
    // Emptied since enroll: the contact ends here rather than waiting on a blank.
    await setContactState(db, contact.id, "finished", { reason: `${stepKey(seq, next.step)} is empty`, now: o.now });
    stats.finished++;
    return;
  }
  const fields = fieldsFor(contact, o.sender);
  await db.insert(reachMessages).values({
    contactId: contact.id,
    accountId: contact.accountId,
    direction: "out",
    kind: "sequence",
    step: next.step,
    template: stepKey(seq, next.step),
    subject: next.subject ? render(bodies.get(subjectKey(seq, next.step)) ?? "", fields) : null,
    body: render(body, fields),
    state: "queued",
    dueAt: new Date(o.now.getTime() + next.afterDays * DAY_MS),
    runId: o.runId ?? null,
  });
}

export async function tick(db: Queryable, o: TickOptions): Promise<TickStats> {
  const stats: TickStats = {
    sent: 0,
    connected: 0,
    held: {},
    failed: 0,
    reconciled: 0,
    finished: 0,
    unreachable: 0,
  };
  stats.reconciled = await reconcile(db, o.now);
  const accounts = await activeAccounts(db);
  if (accounts.length === 0) return stats;
  const byAccount = new Map(accounts.map((a) => [a.id, a]));
  const due: ReachMessage[] = await db
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
  if (due.length === 0) return stats;
  if (!inWindow(o.now, o.policy)) {
    for (const _ of due) hold(stats, "window");
    return stats;
  }
  if (!o.live) {
    for (const _ of due) hold(stats, "gated");
    return stats;
  }
  const today = await sentToday(db, [...byAccount.keys()], o.now);
  const contacts = await contactsById(
    db,
    due.map((r) => r.contactId),
  );
  const usedThisTick = new Set<string>();

  for (const row of due) {
    const account = row.accountId ? byAccount.get(row.accountId) : undefined;
    const contact = contacts.get(row.contactId);
    if (!account || !contact) continue;
    if (usedThisTick.has(account.id)) {
      hold(stats, "gap");
      continue;
    }
    if (!["enrolled", "connected"].includes(contact.state)) {
      await db
        .update(reachMessages)
        .set({ state: "skipped", stateReason: `contact is ${contact.state}` })
        .where(eq(reachMessages.id, row.id));
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
    const isConnect = row.kind === "connect";
    const left = isConnect
      ? standing.caps.connects - spent.connects
      : standing.caps.messages - spent.messages;
    if (left <= 0) {
      hold(stats, "cap");
      continue;
    }
    const channel = o.channelFor(account);
    if (!channel) {
      hold(stats, "no-channel");
      continue;
    }
    const seq = contact.sequence ? o.sequences.get(contact.sequence) : undefined;

    // LinkedIn: a step goes only to a 1st-degree connection.
    if (!isConnect && seq?.connectFirst && channel.relationship) {
      const rel = await channel.relationship(contact.handle);
      if (rel !== "connected") {
        const invitedAt = contact.enrolledAt ?? contact.createdAt;
        if (o.now.getTime() - invitedAt.getTime() > seq.connectWaitDays * DAY_MS) {
          await db
            .update(reachMessages)
            .set({ state: "skipped", stateReason: `invite not accepted in ${seq.connectWaitDays} days` })
            .where(eq(reachMessages.id, row.id));
          await setContactState(db, contact.id, "unreachable", {
            reason: `invite ${rel} after ${seq.connectWaitDays} days`,
            now: o.now,
          });
          stats.unreachable++;
        } else {
          await defer(db, row, new Date(o.now.getTime() + DAY_MS), `invite ${rel}`);
          hold(stats, "pending");
        }
        continue;
      }
      if (contact.state !== "connected") {
        await db
          .update(reachContacts)
          .set({ state: "connected", connectedAt: o.now })
          .where(eq(reachContacts.id, contact.id));
        stats.connected++;
      }
    }

    // Intent first.
    await db
      .update(reachMessages)
      .set({ state: "sending", stateReason: null })
      .where(eq(reachMessages.id, row.id));
    usedThisTick.add(account.id);
    try {
      const sent = isConnect
        ? await (channel.connect as NonNullable<typeof channel.connect>)(contact.handle, row.body || null)
        : await channel.message(contact.handle, row.body, row.subject);
      await db
        .update(reachMessages)
        .set({ state: "sent", sentAt: o.now, ref: sent.ref })
        .where(eq(reachMessages.id, row.id));
      stats.sent++;
      if (isConnect) spent.connects++;
      else spent.messages++;
      today.set(account.id, spent);
      if (isConnect && seq) {
        // The first step waits for the acceptance; due a day out, then polled daily.
        const first = seq.steps[0];
        if (first) await queueNext(db, o, seq, contact, 0, stats);
      } else if (seq && row.step) {
        await queueNext(db, o, seq, contact, row.step, stats);
      }
    } catch (err) {
      if (err instanceof SiteCallError && err.status === 429) {
        await db
          .update(reachMessages)
          .set({ state: "queued", dueAt: new Date(o.now.getTime() + HOLD_MS), stateReason: err.message })
          .where(eq(reachMessages.id, row.id));
        hold(stats, "retry");
      } else if (err instanceof SiteCallError && err.status >= 400 && err.status < 500) {
        await fail(db, row, err.message, o.now, stats);
      } else {
        // Fate unknown: never resent.
        await db
          .update(reachMessages)
          .set({ state: "unknown", stateReason: (err instanceof Error ? err.message : String(err)).slice(0, 500) })
          .where(eq(reachMessages.id, row.id));
        stats.failed++;
      }
    }
  }
  return stats;
}

/** A message typed by the operator on a thread, out on the next tick from the contact's account. */
export async function queueManual(
  db: Queryable,
  req: { contact: ReachContact; body: string; subject?: string | null; now: Date },
): Promise<ReachMessage> {
  if (!req.contact.accountId) throw new Error("the contact has no account yet: enroll first");
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
