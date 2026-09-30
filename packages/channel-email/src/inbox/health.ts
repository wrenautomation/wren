/**
 * Sender reputation: what the domain looks like lately, and the switches that
 * take it out of the rotation.
 *
 * **Why the grain is the domain, not the inbox.** A receiving server scores
 * the sending *domain* — SPF, DKIM and DMARC all authenticate it, and a spam
 * verdict earned by one inbox is spent by its neighbours the same afternoon.
 * So the switch pauses every inbox on the domain and the numbers are computed
 * over all of them together.
 *
 * **Why the window floors at the last lift.** The evidence that paused a
 * domain does not disappear when a human resumes it. Without a floor, the very
 * next evaluation would re-pause the domain on the evidence a human has
 * already weighed and dismissed. A floor at `max(lifted_at)` gives the same
 * guarantee as an immunity timer with no clock to expire: anything that
 * arrives *after* the lift counts immediately.
 *
 * **Why two bounces, not two hundred sends.** A rate alone is worse — one dead
 * address out of 10 is 10%, and pausing a domain for one typo'd address is how
 * an operator learns to ignore the switch. So both must hold: the rate
 * (`bouncePauseRate`) *and* a floor of `bouncePauseMinBounces` hard bounces.
 * Complaints have no floor: at this fleet's volume one complaint is already
 * Google's enforcement line.
 *
 * **Why a niche can be left out.** `policy.killSwitchOffFor` names campaigns
 * the switch ignores: their sends and bounces are not counted here, and
 * `deliver` lets them send past a kill-switch pause. Every other campaign on
 * the same domains is still guarded by its own numbers.
 *
 * Pausing is automatic; **resuming is a human**. Nothing in this module lifts
 * a pause on its own, and no timer does either — `resume` is called by the
 * operator and by nothing else.
 */
import type { Db, Queryable } from "@wren/db";
import { and, count, eq, gte, inArray, isNotNull, isNull, max, notInArray, sql } from "drizzle-orm";
import {
  type BounceClass,
  enrollments,
  messages,
  type SenderPause,
  senderPauses,
  type ThreadEventKind,
  threadEvents,
} from "../schema.js";
import type { SendPolicy } from "../send/policy.js";
import type { KillSwitches } from "../send/tick.js";
import { sendHealth } from "../views.js";

/** The sending domain of a roster address — the grain reputation lives at. */
export function domainOf(sender: string): string {
  const address = sender.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  return at >= 0 ? address.slice(at + 1) : address;
}

/**
 * Every sender currently out of the rotation, by address. Active means
 * `lifted_at IS NULL`, and the partial unique index makes that at most one
 * row per sender — so a map is a faithful shape, not a lossy one.
 */
export async function activePauses(db: Queryable): Promise<Map<string, SenderPause>> {
  const rows = await db.select().from(senderPauses).where(isNull(senderPauses.liftedAt));
  return new Map(rows.map((row) => [row.sender, row]));
}

/** One sending domain's trailing numbers — what a switch decides on. */
export interface DomainHealth {
  readonly domain: string;
  readonly senders: readonly string[];
  readonly windowStart: Date;
  readonly sent: number;
  readonly hardBounces: number;
  readonly softBounces: number;
  readonly complaints: number;
  readonly replies: number;
  readonly autoReplies: number;
  readonly unsubscribes: number;
  /** Hard bounces over sends; null when nothing was sent in the window — not 0, which would read as "clean". */
  readonly bounceRate: number | null;
  readonly paused: boolean;
  readonly lastLift: Date | null;
}

/**
 * The trailing-window numbers for every domain in `senders` (the roster the
 * caller cares about — this module never loads the roster itself).
 *
 * The window starts at `now - policy.healthWindowMs`, floored at the domain's
 * last lift. Niches in `policy.killSwitchOffFor` are left out of every count. Sends are counted from `messages.sent_at`; inbound evidence from
 * `thread_events.received_at`, both joined to `enrollments.sender`. The
 * `send_health` view attributes an event to the day of the send it answers —
 * right for a daily table, wrong here: a switch must fire on what arrived
 * inside the window.
 */
export async function domainHealth(
  db: Queryable,
  opts: { policy: SendPolicy; now: Date; senders: readonly string[] },
): Promise<DomainHealth[]> {
  const byDomain = new Map<string, string[]>();
  for (const sender of opts.senders) {
    const address = sender.trim().toLowerCase();
    const list = byDomain.get(domainOf(address)) ?? [];
    list.push(address);
    byDomain.set(domainOf(address), list);
  }
  if (!byDomain.size) return [];

  const paused = await activePauses(db);
  const floor = new Date(opts.now.getTime() - opts.policy.healthWindowMs);
  const off = [...opts.policy.killSwitchOffFor];
  const counted = off.length ? notInArray(enrollments.niche, off) : undefined;
  const health: DomainHealth[] = [];
  for (const domain of [...byDomain.keys()].sort()) {
    const addresses = byDomain.get(domain) ?? [];
    const [lift] = await db
      .select({ lastLift: max(senderPauses.liftedAt) })
      .from(senderPauses)
      .where(and(inArray(senderPauses.sender, addresses), isNotNull(senderPauses.liftedAt)));
    const lastLift = lift?.lastLift ?? null;
    const windowStart = lastLift !== null && lastLift > floor ? lastLift : floor;
    const [sentRow] = await db
      .select({ n: count() })
      .from(messages)
      .innerJoin(enrollments, eq(enrollments.id, messages.enrollmentId))
      .where(
        and(
          inArray(enrollments.sender, addresses),
          eq(messages.state, "sent"),
          gte(messages.sentAt, windowStart),
          counted,
        ),
      );
    const sent = sentRow?.n ?? 0;
    const grouped = await db
      .select({ kind: threadEvents.kind, bounceClass: threadEvents.bounceClass, n: count() })
      .from(threadEvents)
      .innerJoin(enrollments, eq(enrollments.id, threadEvents.enrollmentId))
      .where(
        and(
          inArray(enrollments.sender, addresses),
          gte(threadEvents.receivedAt, windowStart),
          counted,
        ),
      )
      .groupBy(threadEvents.kind, threadEvents.bounceClass);
    const total = (kind: ThreadEventKind, bounceClass?: BounceClass): number =>
      grouped
        .filter(
          (g) => g.kind === kind && (bounceClass === undefined || g.bounceClass === bounceClass),
        )
        .reduce((sum, g) => sum + g.n, 0);
    const hard = total("bounce", "hard");
    health.push({
      domain,
      senders: addresses,
      windowStart,
      sent,
      hardBounces: hard,
      softBounces: total("bounce", "soft"),
      complaints: total("complaint"),
      replies: total("reply"),
      autoReplies: total("auto_reply"),
      unsubscribes: total("unsubscribe"),
      bounceRate: sent ? hard / sent : null,
      paused: addresses.some((address) => paused.has(address)),
      lastLift,
    });
  }
  return health;
}

/**
 * Pause every inbox on any domain whose trailing numbers have gone bad.
 *
 * Two switches, either of which is enough: the hard-bounce rate at or above
 * `policy.bouncePauseRate` *with* at least `policy.bouncePauseMinBounces` hard
 * bounces, or a single complaint. Idempotent: a domain already paused writes
 * nothing at all, so the start-of-tick call is free.
 */
export async function evaluateKillSwitches(
  db: Queryable,
  opts: { policy: SendPolicy; now: Date; senders: readonly string[]; runId?: string | null },
): Promise<SenderPause[]> {
  const written: SenderPause[] = [];
  const paused = await activePauses(db);
  for (const health of await domainHealth(db, opts)) {
    const reason = tripReason(health, opts.policy);
    if (reason === null) continue;
    const unpaused = health.senders.filter((address) => !paused.has(address));
    if (!unpaused.length) continue; // already out of the rotation; the pause stands as written
    const detail = {
      sent: health.sent,
      hard_bounces: health.hardBounces,
      complaints: health.complaints,
      bounce_rate: health.bounceRate,
      window_start: health.windowStart.toISOString(),
      run_id: opts.runId ?? null,
    };
    const rows = await db
      .insert(senderPauses)
      .values(
        unpaused.map((address) => ({
          sender: address,
          domain: health.domain,
          reason,
          source: "kill_switch" as const,
          pausedAt: opts.now,
          detail,
        })),
      )
      .returning();
    written.push(...rows);
  }
  return written;
}

/** `evaluateKillSwitches` in the shape `sendTick` takes. */
export const killSwitches: KillSwitches = (db: Db, opts) => evaluateKillSwitches(db, opts);

/** The reason this domain's numbers trip a switch, or null — the read-only half of `evaluateKillSwitches`. */
export function wouldTrip(health: DomainHealth, policy: SendPolicy): string | null {
  return tripReason(health, policy);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** One line naming the numbers, so a pause explains itself in a listing without anyone opening the detail JSON. */
function tripReason(health: DomainHealth, policy: SendPolicy): string | null {
  const window = windowLabel(policy);
  const reasons: string[] = [];
  if (
    health.hardBounces >= policy.bouncePauseMinBounces &&
    health.bounceRate !== null &&
    health.bounceRate >= policy.bouncePauseRate
  ) {
    reasons.push(
      `hard bounces ${health.hardBounces}/${health.sent} = ${percent(health.bounceRate)} >= ${percent(policy.bouncePauseRate)} over ${window}`,
    );
  }
  if (health.complaints >= 1) {
    const plural = health.complaints === 1 ? "" : "s";
    reasons.push(`${health.complaints} complaint${plural} in ${window}`);
  }
  return reasons.join("; ") || null;
}

function windowLabel(policy: SendPolicy): string {
  const days = policy.healthWindowMs / 86_400_000;
  return `${Number.isInteger(days) ? days : Number(days.toPrecision(6))} d`;
}

/**
 * Take an inbox — or a whole domain — out of the rotation by hand. `target`
 * is an address or a bare domain (no "@"), matched against the roster the
 * caller passed in: a typo must be a loud error, not a pause of nothing that
 * reads as success. Senders already paused are left alone.
 */
export async function pause(
  db: Queryable,
  opts: { target: string; reason: string; by: string; now: Date; senders: readonly string[] },
): Promise<SenderPause[]> {
  const matched = resolveTarget(opts.target, opts.senders);
  if (!matched.length) {
    throw new Error(
      `no roster sender matches '${opts.target}' — pass a sender address or a bare sending domain`,
    );
  }
  const paused = await activePauses(db);
  const fresh = matched.filter((address) => !paused.has(address));
  if (!fresh.length) return [];
  return db
    .insert(senderPauses)
    .values(
      fresh.map((address) => ({
        sender: address,
        domain: domainOf(address),
        reason: opts.reason,
        source: "operator" as const,
        pausedAt: opts.now,
        detail: { by: opts.by },
      })),
    )
    .returning();
}

/**
 * Lift every active pause on an address or a domain — the one act that puts
 * an inbox back in the rotation. A kill-switch pause is written by the machine
 * and lifted only here, by a person who has read the bounces. Returns the rows
 * it lifted — empty when nothing was paused, which is not an error.
 */
export async function resume(
  db: Queryable,
  opts: { target: string; by: string; now: Date; senders: readonly string[] },
): Promise<SenderPause[]> {
  const known = [...opts.senders, ...(await activePauses(db)).keys()];
  const matched = resolveTarget(opts.target, known);
  if (!matched.length) return [];
  return db
    .update(senderPauses)
    .set({ liftedAt: opts.now, liftedBy: opts.by })
    .where(and(inArray(senderPauses.sender, matched), isNull(senderPauses.liftedAt)))
    .returning();
}

/** The addresses a target names: itself, or every inbox on a domain. */
function resolveTarget(target: string, senders: readonly string[]): string[] {
  const wanted = target.trim().toLowerCase();
  const addresses = new Set(senders.map((sender) => sender.trim().toLowerCase()));
  const picked = wanted.includes("@")
    ? [...addresses].filter((address) => address === wanted)
    : [...addresses].filter((address) => domainOf(address) === wanted);
  return picked.sort();
}

export type SenderDay = typeof sendHealth.$inferSelect;

/** The `send_health` view, newest day first. Read through the view: the view is the definition of the daily numbers. */
export async function senderDays(db: Queryable, opts: { since: string }): Promise<SenderDay[]> {
  return db
    .select()
    .from(sendHealth)
    .where(gte(sendHealth.day, opts.since))
    .orderBy(sql`${sendHealth.day} desc`, sendHealth.sender);
}
