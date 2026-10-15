/**
 * The save engine in React, kept thin: `useSaved` holds one `Saver` per key and draws its
 * state; `SaveStatus` is the one status line; `SaveConflict` asks Keep mine or Use theirs;
 * `useKeptForm` keeps a dialog's typing until it is sent.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../controls.js";
import { type Conflict, Saver, type SaverOptions, type SaveState, type Status } from "./engine.js";
import { browserEnv } from "./env.js";
import { readForm, writeForm } from "./journal.js";

export interface Saved<T> extends SaveState<T> {
  /** His change: journaled now, saved after a pause. */
  set: (value: T) => void;
  /** Save now (blur, ⌘S, before Approve): true once the server holds it. */
  flush: () => Promise<boolean>;
  keepMine: () => Promise<boolean>;
  takeTheirs: () => void;
  retry: () => Promise<boolean>;
}

/**
 * One value a person types into, saved through the engine. `server` (with `version` and the
 * read's tick `at`) is the page's newest read; the input draws `value` and calls `set`.
 * `save`, `onSaved` and `onConflict` are read live, so they may close over this render.
 */
export function useSaved<T>(o: SaverOptions<T>): Saved<T> {
  const ref = useRef<Saver<T> | null>(null);
  if (!ref.current || ref.current.key !== o.key) ref.current = new Saver(o);
  const saver = ref.current;
  saver.update({
    save: o.save,
    onSaved: o.onSaved,
    onConflict: o.onConflict,
    conflictOf: o.conflictOf,
  });
  useEffect(() => {
    saver.open();
    return () => saver.close();
  }, [saver]);
  useEffect(() => {
    saver.read(o.server, { version: o.version, at: o.at });
  }, [saver, o.server, o.version, o.at]);
  const state = useSyncExternalStore(saver.subscribe, saver.snapshot, saver.snapshot);
  return useMemo(
    () => ({
      ...state,
      set: (v: T) => saver.set(v),
      flush: () => saver.flush(),
      keepMine: () => saver.keepMine(),
      takeTheirs: () => saver.takeTheirs(),
      retry: () => saver.retry(),
    }),
    [state, saver],
  );
}

/** The status in words; null when there is nothing to say (clean, or typing before a pause). */
export function statusWords(status: Status, error: string | null): string | null {
  switch (status) {
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "waiting":
      return "Saved on this device";
    case "conflict":
      return "Changed elsewhere";
    case "failed":
      return `Not saved: ${error ?? "the server refused it"}`;
    default:
      return null;
  }
}

/** The one status line: the same words and place everywhere. `idle` shows when there's nothing to say. */
export function SaveStatus({
  state,
  onRetry,
  idle,
}: {
  state: Pick<SaveState<unknown>, "status" | "error">;
  onRetry?: (() => void) | undefined;
  idle?: ReactNode;
}) {
  const words = statusWords(state.status, state.error);
  const bad = state.status === "failed" || state.status === "conflict";
  return (
    <span
      aria-live="polite"
      className={
        bad
          ? "inline-flex items-baseline gap-2 text-[12px] text-(--ui-bad)"
          : words
            ? "text-[12px] text-(--ui-ink-2)"
            : "text-[12px] text-(--ui-ink-3) max-sm:hidden"
      }
    >
      {words ?? idle ?? null}
      {state.status === "failed" && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="font-medium text-(--ui-ink) underline underline-offset-2"
        >
          Retry
        </button>
      ) : null}
    </span>
  );
}

/** Someone changed it while he typed: their version, and his choice. */
export function SaveConflict<T>({
  conflict,
  show,
  onKeepMine,
  onTakeTheirs,
}: {
  conflict: Conflict<T>;
  /** Their value as it reads; its text when left out. */
  show?: ((theirs: T) => ReactNode) | undefined;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
}) {
  const theirs = conflict.theirs;
  return (
    <div
      role="alert"
      className="grid gap-2 rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-wash) p-3 text-[13px]"
    >
      <p className="text-(--ui-ink)">Someone changed this while you typed.</p>
      {theirs === null ? (
        <p className="text-(--ui-ink-3)">Getting their version…</p>
      ) : (
        <div className="grid gap-1">
          <span className="text-[12px] text-(--ui-ink-2)">Their version</span>
          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-(--ui-ink-2)">
            {show ? show(theirs) : String(theirs)}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button tone="primary" size="dense" disabled={theirs === null} onClick={onKeepMine}>
          Keep mine
        </Button>
        <Button tone="quiet" size="dense" disabled={theirs === null} onClick={onTakeTheirs}>
          Use theirs
        </Button>
      </div>
    </div>
  );
}

export interface KeptFormState {
  /** Where the values are kept; null keeps nothing. */
  key: string | null;
  values: Record<string, string>;
  /** The values came back from before (a closed dialog, a reload). */
  restored: boolean;
  set: (field: string, text: string) => void;
  /** Sent: forget them. */
  clear: () => void;
}

/**
 * A dialog's typing, kept on the device under `key` until it is sent, so closing the dialog or
 * reloading gives it back. `base` is what the form started from: the values come back only
 * over the same. A null key keeps nothing.
 */
export function useKeptForm(key: string | null, base = ""): KeptFormState {
  const env = useMemo(() => browserEnv(), []);
  const load = (k: string | null) => {
    const got = k ? readForm(env.storage, k, base, env.now()) : null;
    return { key: k, base, values: got ?? {}, restored: !!got };
  };
  const [s, setS] = useState(() => load(key));
  let now = s;
  if (s.key !== key || s.base !== base) {
    now = load(key);
    setS(now);
  }
  const live = useRef(now);
  live.current = now;
  return {
    key: now.key,
    values: now.values,
    restored: now.restored,
    set: (field, text) => {
      const cur = live.current;
      const values = { ...cur.values, [field]: text };
      if (cur.key) writeForm(env.storage, cur.key, values, cur.base, env.now());
      const next = { ...cur, values };
      live.current = next;
      setS(next);
    },
    clear: () => {
      const cur = live.current;
      if (cur.key) writeForm(env.storage, cur.key, null, cur.base, env.now());
      const next = { ...cur, values: {}, restored: false };
      live.current = next;
      setS(next);
    },
  };
}

/** Forget what's kept under `key` (it was sent after its dialog closed). */
export function forgetForm(key: string | null) {
  if (key) writeForm(browserEnv().storage, key, null, "", Date.now());
}
