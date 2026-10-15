/**
 * How a draft box saves, apart from how it draws: the engine's options for one draft, and the
 * live words a preview beside the box reads without the page drawing again on each key.
 */
import type { Call } from "./action.js";
import { SAVE_DELAY_MS, type SaverOptions } from "./save/engine.js";

export const trimmed = (a: string, b: string) => a.trim() === b.trim();

export interface DraftSaving {
  /** The save handler; null: the box reads only. */
  handler: string | null;
  id: string | number;
  key: string;
  server: string;
  at?: number | undefined;
  call: Call;
  /** Read the record again: only on a conflict, to show theirs. */
  changed: (ids: (string | number)[]) => void;
  /** Write-through: the server holds `text` now. */
  wrote?: ((text: string) => void) | undefined;
}

/**
 * One draft's save: trimmed words, `expect` the text it started from, a request id per try. A
 * save never reads the record again; `wrote` shows it instead.
 */
export function draftSaving(o: DraftSaving): SaverOptions<string> {
  const { handler } = o;
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
      await o.call(handler, {
        ids: [o.id],
        text: words,
        expect: from.trim() ? from : null,
        requestId: ctx.request,
      });
      return { value: words };
    },
    onSaved: (text) => o.wrote?.(text),
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
