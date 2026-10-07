/**
 * How a call went, one vocabulary for every call (designs/2026-10-07-close-brief-outcome.md).
 * A dial is speed to lead's "Call now" (`speed_runs.call_outcome`); a meeting is a booked call
 * (`call_bookings.outcome`). Two lists by kind, one set of labels.
 */
import type { Tone } from "./records.js";

/** A dial the rep made: did they get through. */
export const DIAL_OUTCOMES = ["reached", "voicemail", "no_answer", "wrong_number"] as const;
export type DialOutcome = (typeof DIAL_OUTCOMES)[number];

/** A booked call, once it's over: what came of it. */
export const MEETING_OUTCOMES = ["won", "not_yet", "no_show", "not_fit"] as const;
export type MeetingOutcome = (typeof MEETING_OUTCOMES)[number];

export const CALL_OUTCOMES = [...DIAL_OUTCOMES, ...MEETING_OUTCOMES] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** Each outcome as a person says it, and its tone in a status column. */
export const CALL_OUTCOME_LABELS: Record<CallOutcome, { label: string; tone: Tone }> = {
  reached: { label: "Reached", tone: "good" },
  voicemail: { label: "Voicemail", tone: "neutral" },
  no_answer: { label: "No answer", tone: "neutral" },
  wrong_number: { label: "Wrong number", tone: "bad" },
  won: { label: "Won", tone: "good" },
  not_yet: { label: "Not yet", tone: "warn" },
  no_show: { label: "No-show", tone: "bad" },
  not_fit: { label: "Not a fit", tone: "neutral" },
};

/** The labels and tones of one kind, as a record's status field takes them. */
export const outcomeStatus = <T extends CallOutcome>(kind: readonly T[]) =>
  Object.fromEntries(kind.map((o) => [o, CALL_OUTCOME_LABELS[o]])) as Record<
    T,
    { label: string; tone: Tone }
  >;

/** A code or its label ("No answer") as one of `kind`; null when blank, undefined when unknown. */
export function outcomeIn<T extends CallOutcome>(
  kind: readonly T[],
  said: string | null | undefined,
): T | null | undefined {
  const s = said?.trim();
  if (!s) return null;
  return kind.find(
    (o) => o === s || CALL_OUTCOME_LABELS[o].label.toLowerCase() === s.toLowerCase(),
  );
}
