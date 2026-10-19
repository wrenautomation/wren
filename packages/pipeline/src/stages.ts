/**
 * The one guard on a journey: a move goes to a later stage. Pure; the move step runs it under
 * a row lock. Same as `payments/src/states.ts` `step()` in spirit, with a total order.
 */
import type { JourneyStatus } from "./schema.js";

export interface Moved {
  to: string;
  /** Stages passed over, in order. */
  skipped: string[];
}

/**
 * Where a journey goes when a cause points at `to`. Null when it stays: same or earlier stage,
 * an unknown stage, or a closed journey (`done` or `dropped`).
 */
export function nextStage(
  stages: readonly { key: string }[],
  from: string,
  to: string,
  status: JourneyStatus,
): Moved | null {
  if (status !== "open") return null;
  const a = stages.findIndex((s) => s.key === from);
  const b = stages.findIndex((s) => s.key === to);
  if (a < 0 || b <= a) return null;
  return { to, skipped: stages.slice(a + 1, b).map((s) => s.key) };
}
