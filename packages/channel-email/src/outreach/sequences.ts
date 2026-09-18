/**
 * Follow-up cadence as data.
 *
 * A sequence is a named list of steps — send this template N business days after the
 * opener, provided no stop condition has fired. An arm — one offer, one hook, the unit an
 * A/B is read over — is a directory of templates: `pilot/opener` belongs to the pilot arm,
 * a root-level `followup` is shared by every arm. A sequence's arm is where its opener lives.
 */
import { pyReprStr } from "./pyrepr.js";

/** The arm a template belongs to (`pilot/opener` → "pilot") or null for a shared template. */
export function armOf(templateName: string): string | null {
  const slash = templateName.indexOf("/");
  return slash === -1 ? null : templateName.slice(0, slash);
}

/** One email in the cadence: which template, how many business days after the opener. */
export interface SequenceStep {
  readonly template: string;
  readonly day: number;
}

export interface Sequence {
  readonly name: string;
  readonly steps: readonly SequenceStep[];
  /** The directory the opener lives in, or null when the opener is shared. */
  readonly arm: string | null;
}

export function sequenceStep(templateName: string, day: number): SequenceStep {
  if (!templateName) throw new Error("a SequenceStep needs a template name");
  if (day < 0) throw new Error("a SequenceStep day cannot be negative");
  return { template: templateName, day };
}

export function sequence(name: string, steps: readonly SequenceStep[]): Sequence {
  if (!name) throw new Error("a Sequence needs a name");
  const first = steps[0];
  if (first === undefined) throw new Error(`sequence ${pyReprStr(name)} has no steps`);
  if (first.day !== 0) throw new Error(`sequence ${pyReprStr(name)} must open on day 0`);
  for (let i = 1; i < steps.length; i++) {
    if ((steps[i] as SequenceStep).day <= (steps[i - 1] as SequenceStep).day) {
      throw new Error(`sequence ${pyReprStr(name)}: each step must be later than the last`);
    }
  }
  const arm = armOf(first.template);
  const foreign = [
    ...new Set(
      steps.map((s) => armOf(s.template)).filter((a): a is string => a !== null && a !== arm),
    ),
  ].sort();
  if (foreign.length > 0) {
    // A thread must never argue with itself, and every message's arm attribution must be exact.
    const opens = arm !== null ? `in arm ${pyReprStr(arm)}` : "on a shared opener";
    throw new Error(
      `sequence ${pyReprStr(name)} opens ${opens} but sends from` +
        ` ${foreign.join(", ")} — every step is in the opener's arm or shared`,
    );
  }
  return { name, steps: [...steps], arm };
}

/** `pilot-days-0-3-7` for an arm-scoped opener, `3-emails-days-0-3-7` for a shared one. */
function defaultName(opener: string, days: readonly number[]): string {
  const spec = days.join("-");
  const arm = armOf(opener);
  return arm !== null ? `${arm}-days-${spec}` : `${days.length}-emails-days-${spec}`;
}

/** Opener, short follow-up, polite final follow-up. */
export function threeEmailSequence(
  opener: string,
  followup: string,
  finalFollowup: string,
  opts: { name?: string; days?: readonly [number, number, number] } = {},
): Sequence {
  const days = opts.days ?? [0, 3, 7];
  return sequence(opts.name ?? defaultName(opener, days), [
    sequenceStep(opener, days[0]),
    sequenceStep(followup, days[1]),
    sequenceStep(finalFollowup, days[2]),
  ]);
}

/** One nudge and out: the opener, a single follow-up, nothing after. */
export function twoEmailSequence(
  opener: string,
  followup: string,
  opts: { name?: string; days?: readonly [number, number] } = {},
): Sequence {
  const days = opts.days ?? [0, 5];
  return sequence(opts.name ?? defaultName(opener, days), [
    sequenceStep(opener, days[0]),
    sequenceStep(followup, days[1]),
  ]);
}
