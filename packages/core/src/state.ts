import { LEAD_STATUSES, type LeadStatus } from "./schema.js";

/**
 * Legal status transitions: illegal transitions throw, always.
 * Each entity gets a table mapping status -> allowed next statuses; `transition`
 * is the single enforcement point. Persistence code goes through it rather than
 * assigning status columns directly.
 */
export type TransitionTable<S extends string> = Readonly<Record<S, ReadonlySet<S>>>;

export class IllegalTransition extends Error {
  constructor(
    readonly machine: string,
    readonly current: string,
    readonly next: string,
  ) {
    super(`${machine}: illegal transition ${current} -> ${next}`);
    this.name = "IllegalTransition";
  }
}

export function transition<S extends string>(
  machine: string,
  table: TransitionTable<S>,
  current: S,
  next: S,
): S {
  if (!table[current].has(next)) throw new IllegalTransition(machine, current, next);
  return next;
}

/** States that can move to `target`, in declaration order of the status list. */
export function sourcesOf<S extends string>(
  table: TransitionTable<S>,
  states: readonly S[],
  target: S,
): S[] {
  return states.filter((s) => table[s].has(target));
}

const set = <S extends string>(...s: S[]): ReadonlySet<S> => new Set(s);

export const LEAD_TRANSITIONS: TransitionTable<LeadStatus> = {
  imported: set("verified", "suppressed", "undeliverable"),
  // Verified is a decaying fact: a re-check may re-confirm (self-loop) or find
  // the address dead; opting out stays possible. It never demotes to imported —
  // inconclusive evidence (risky/catch_all) leaves status alone.
  verified: set("verified", "undeliverable", "suppressed"),
  // Lifting a mistaken suppression re-enters the funnel at imported.
  suppressed: set("imported"),
  // Terminal in the ordinary flow. The one exit is reserved for explicit
  // correction/appeal flows, never an automatic selection.
  undeliverable: set("imported"),
};
export const transitionLead = (current: LeadStatus, next: LeadStatus) =>
  transition("lead", LEAD_TRANSITIONS, current, next);
export { LEAD_STATUSES };
