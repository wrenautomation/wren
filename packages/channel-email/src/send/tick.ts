/**
 * One send tick — kill switches, reconcile, the paced walk — as a function, so
 * the scheduler and any operator command cannot drift.
 */
import type { Calendar } from "@wren/core/calendar";
import type { Db } from "@wren/db";
import { evaluateKillSwitches } from "../inbox/health.js";
import type { SenderPause } from "../schema.js";
import { type SendStats, sendDue } from "./deliver.js";
import type { SendPolicy } from "./policy.js";
import type { Rng } from "./rng.js";
import type { Sender } from "./roster.js";
import type { Transport } from "./transport.js";

/** Who may send, who is measured, and what name each sends under. */
export interface Fleet {
  /** What may send: active roster addresses only. */
  readonly senders: readonly string[];
  /**
   * What the kill switches measure: EVERY roster address, suspended included.
   * Reputation is a property of the domain, and a suspended inbox's past sends
   * and bounces are still part of that domain's trailing numbers.
   */
  readonly domainFleet: readonly string[];
  /** The display name each inbox sends under; none means the bare address. */
  readonly fromNames: Readonly<Record<string, string | null>>;
  /** The rich form of each inbox's sign-off; the plain form is already in the body. */
  readonly signatureHtml: Readonly<Record<string, string>>;
  /** Each niche's page on the site ("/recruiting/lead-reactivation"), filled into the sign-off's `{page}` slot. */
  readonly pages: Readonly<Record<string, string>>;
}

/** The roster's two lists (all, active) as a Fleet. */
export function rosterFleet(
  rosterAll: readonly Sender[],
  active: readonly Sender[],
  pages: Readonly<Record<string, string>> = {},
): Fleet {
  const signatureHtml: Record<string, string> = {};
  for (const s of active) if (s.signature) signatureHtml[s.address] = s.signature.html;
  return {
    senders: active.map((s) => s.address),
    domainFleet: rosterAll.map((s) => s.address),
    fromNames: Object.fromEntries(active.map((s) => [s.address, s.displayName])),
    signatureHtml,
    pages: { ...pages },
  };
}

/** The kill-switch hook: pauses a domain whose trailing bounces crossed the line. */
export type KillSwitches = (
  db: Db,
  opts: { policy: SendPolicy; now: Date; senders: readonly string[]; runId: string | null },
) => Promise<SenderPause[]>;

/** Off, for tests that seed bounce history and want the walk alone. */
export const noKillSwitches: KillSwitches = async () => [];

export interface TickOptions {
  policy: SendPolicy;
  transport: Transport;
  now: Date;
  runId: string | null;
  fleet: Fleet;
  /** The pixel host, from settings: one global setting, not a roster fact. */
  pixelBaseUrl?: string | null;
  /** Where `{call.times}` finds open times. */
  calendar?: Calendar | null;
  limit?: number | null;
  reconcileFirst?: boolean;
  rng?: Rng;
  killSwitches?: KillSwitches;
}

export interface TickResult {
  stats: SendStats;
  newPauses: SenderPause[];
}

/**
 * Kill switches — a domain over the line is paused so the walk below reads it
 * — then one paced walk of the outbox (reconcile first).
 */
export async function sendTick(db: Db, opts: TickOptions): Promise<TickResult> {
  const killSwitches = opts.killSwitches ?? evaluateKillSwitches;
  const newPauses = await killSwitches(db, {
    policy: opts.policy,
    now: opts.now,
    senders: opts.fleet.domainFleet,
    runId: opts.runId,
  });
  const stats = await sendDue(db, {
    transport: opts.transport,
    policy: opts.policy,
    now: opts.now,
    ...(opts.rng ? { rng: opts.rng } : {}),
    limit: opts.limit ?? null,
    runId: opts.runId,
    fromNames: opts.fleet.fromNames,
    signatureHtml: opts.fleet.signatureHtml,
    pages: opts.fleet.pages,
    pixelBaseUrl: opts.pixelBaseUrl ?? null,
    calendar: opts.calendar ?? null,
    senders: opts.fleet.senders,
    reconcileFirst: opts.reconcileFirst ?? true,
  });
  return { stats, newPauses };
}
