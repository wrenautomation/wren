/**
 * One dictation, from the press to the last words in the box: the mic's frames go to the ears,
 * their words come back with the spoken commands applied, and each stage is timed. Isomorphic:
 * the mic and the box are the caller's.
 */
import type { EarStream, Ears, Frame } from "../types.js";
import { applyCommands } from "./commands.js";

/** The stages a dictation is timed by, as the run ledger keeps them. */
export const DICTATION_STAGES = {
  mic: "Mic open",
  first: "First words",
  final: "Final words",
} as const;
export type DictationStage = keyof typeof DICTATION_STAGES;

export interface DictationRun {
  /** Press to the mic's first frame. */
  micMs: number | null;
  /** Press to the first words shown, partial or final. */
  firstMs: number | null;
  /** Release to the last words in the box; null when nothing was heard. */
  finalMs: number | null;
  words: number;
  /** How much audio the mic gave. */
  audioMs: number;
}

export interface DictationEvents {
  /** Words that may still change, commands applied. */
  partial(text: string): void;
  /** Words to put in, commands applied. */
  final(text: string): void;
}

export interface DictationSession {
  /** A slice of the mic's audio (the first one marks the mic open). */
  push(frame: Frame): void;
  /** Released: hear the rest, then the timings. */
  stop(): Promise<DictationRun>;
  /** Dropped: nothing more goes in. */
  cancel(): void;
}

const words = (s: string) => s.split(/\s+/).filter((w) => /\w/.test(w)).length;

export function startDictation(o: {
  ears: Ears;
  on: DictationEvents;
  now?: () => number;
}): DictationSession {
  const now = o.now ?? (() => performance.now());
  const pressed = now();
  let micAt: number | null = null;
  let firstAt: number | null = null;
  let releasedAt: number | null = null;
  let lastFinalAt: number | null = null;
  let count = 0;
  let audio = 0;
  let over = false;
  const shown = () => {
    if (firstAt === null) firstAt = now();
  };
  const ear: EarStream = o.ears.open((h) => {
    if (over) return;
    if (h.kind === "partial") {
      shown();
      o.on.partial(applyCommands(h.text));
    } else if (h.kind === "final") {
      shown();
      lastFinalAt = now();
      const text = applyCommands(h.text);
      count += words(text);
      o.on.final(text);
    }
  });
  return {
    push(frame) {
      if (over || releasedAt !== null) return;
      if (micAt === null) micAt = now();
      if (frame.rate) audio += ((frame.data.byteLength / 2) * 1000) / frame.rate;
      ear.push(frame);
    },
    async stop() {
      if (releasedAt === null) releasedAt = now();
      if (ear.finish) await ear.finish();
      else ear.close();
      over = true;
      const released = releasedAt;
      return {
        micMs: micAt === null ? null : Math.round(micAt - pressed),
        firstMs: firstAt === null ? null : Math.round(firstAt - pressed),
        finalMs: lastFinalAt === null ? null : Math.max(0, Math.round(lastFinalAt - released)),
        words: count,
        audioMs: Math.round(audio),
      };
    },
    cancel() {
      over = true;
      ear.close();
    },
  };
}
