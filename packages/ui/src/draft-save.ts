/**
 * How a draft box saves, apart from how it draws: the engine's options for one draft, and the
 * live words a preview beside the box reads without the page drawing again on each key.
 */
import type { Call } from "./action.js";
import type { DraftTurnLine } from "./draft.js";
import { SAVE_DELAY_MS, type SaverOptions } from "./save/engine.js";

export const trimmed = (a: string, b: string) => a.trim() === b.trim();

interface DraftSaving {
  /** The save handler; null: the box reads only. */
  handler: string | null;
  id: string | number;
  key: string;
  server: string;
  at?: number | undefined;
  call: Call;
  /** Read the record again: only on a conflict, to show theirs. */
  changed: (ids: (string | number)[]) => void;
  /** Write-through: the server holds `text` now, at `version` when its answer names one. */
  wrote?: ((text: string, version: string | null) => void) | undefined;
  /** The save's own line in the draft's thread ("Edited by"), when its answer carries one. */
  turned?: ((turn: DraftTurnLine) => void) | undefined;
}

/**
 * A record action's own answer. A call per record (the portal's) answers `{ done, skipped,
 * answer }`, the handler's answer inside; any other call answers it as is.
 */
export const answerIn = (out: unknown): unknown => {
  const o = out as { done?: unknown; answer?: unknown } | null;
  return o && typeof o === "object" && Array.isArray(o.done) && "answer" in o ? o.answer : out;
};

/** The thread line a save answers with (`DraftAsk.set`'s `turn`), if any. */
export const turnOf = (out: unknown): DraftTurnLine | null => {
  const t = (answerIn(out) as { turn?: unknown } | null)?.turn;
  return t && typeof t === "object" && typeof (t as DraftTurnLine).id === "string"
    ? (t as DraftTurnLine)
    : null;
};

/** The record's version a save answers with (a post's words hashed), if any. */
const versionOfAnswer = (out: unknown): string | null => {
  const v = (answerIn(out) as { version?: unknown } | null)?.version;
  return typeof v === "string" && v ? v : null;
};

/** The read's turns, then the ones saves added since that the read doesn't hold yet. */
export const withTurns = (read: readonly DraftTurnLine[], mine: readonly DraftTurnLine[]) => {
  const seen = new Set(read.map((t) => t.id));
  const more = mine.filter((t) => !seen.has(t.id));
  return more.length ? [...read, ...more] : read;
};

/**
 * One draft's save: trimmed words, `expect` the text it started from, a request id per try. A
 * save never reads the record again; `wrote` shows it instead.
 */
export function draftSaving(o: DraftSaving): SaverOptions<string> {
  const { handler } = o;
  // The last save's version: one save is out at a time, and `onSaved` follows it.
  let version: string | null = null;
  return {
    key: handler ? o.key : null,
    server: o.server,
    at: o.at,
    same: trimmed,
    delay: handler ? SAVE_DELAY_MS : null,
    save: async (text, ctx) => {
      if (!handler) return;
      const words = text.trim();
      const from = String(ctx.expect ?? "");
      const out = await o.call(handler, {
        ids: [o.id],
        text: words,
        expect: from.trim() ? from : null,
        requestId: ctx.request,
      });
      const turn = turnOf(out);
      if (turn) o.turned?.(turn);
      version = versionOfAnswer(out);
      return { value: words };
    },
    onSaved: (text) => o.wrote?.(text, version),
    // Claude or someone wrote meanwhile: read theirs so both show.
    onConflict: () => o.changed([]),
  };
}

/** The words as typed, for one reader beside the box (`useDraftText`). */
export interface LiveText {
  get: () => string | null;
  set: (text: string | null) => void;
  subscribe: (fn: () => void) => () => void;
}

export function liveText(): LiveText {
  let now: string | null = null;
  const seen = new Set<() => void>();
  return {
    get: () => now,
    set: (text) => {
      if (text === now) return;
      now = text;
      for (const f of [...seen]) f();
    },
    subscribe: (fn) => {
      seen.add(fn);
      return () => void seen.delete(fn);
    },
  };
}
