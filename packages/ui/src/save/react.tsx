/**
 * The save engine in React, kept thin: `useSaved` holds one `Saver` per key and draws its
 * state; `SaveStatus` is the one status line; `SaveConflict` asks Keep mine or Use theirs;
 * `useKeptForm` keeps a dialog's typing until it is sent.
 */
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "../controls.js";
import { type Conflict, Saver, type SaverOptions, type SaveState, type Status } from "./engine.js";
import { browserEnv } from "./env.js";
import { readKept, writeForm } from "./journal.js";
import { SavePage } from "./page.js";

const PageBoxes = createContext<SavePage | null>(null);

/** The page `useSaved` boxes inside it join: `page.flush()` saves them all. */
export function SaveScope({ page, children }: { page: SavePage; children: ReactNode }) {
  return <PageBoxes.Provider value={page}>{children}</PageBoxes.Provider>;
}

/** A page for `SaveScope`, kept across renders. */
export function useSavePage(): SavePage {
  return useMemo(() => new SavePage(), []);
}

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
  const page = useContext(PageBoxes);
  useEffect(() => {
    saver.open();
    const off = page?.add(saver);
    return () => {
      off?.();
      saver.close();
    };
  }, [saver, page]);
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
  /** What the form starts from now. */
  base: string;
  values: Record<string, string>;
  /** The values came back from before (a closed dialog, a reload). */
  restored: boolean;
  /**
   * What the form starts from moved since the values were typed (`base`): both show until the
   * person picks (`keepMine`, `takeTheirs`). Never dropped silently.
   */
  conflict: { values: Record<string, string>; base: string } | null;
  set: (field: string, text: string) => void;
  /** Sent: forget them. */
  clear: () => void;
  keepMine: () => void;
  takeTheirs: () => void;
}

/**
 * A dialog's typing, kept in the edits store under `key` until it is sent, so closing the dialog,
 * another page or a reload gives it back. `base` is what the form started from: values typed over
 * another base come back as a conflict for the person to settle. A null key keeps nothing.
 */
export function useKeptForm(key: string | null, base = ""): KeptFormState {
  const env = useMemo(() => browserEnv(), []);
  const load = (k: string | null) => {
    const got = k ? readKept(env.storage, k, env.now()) : null;
    const over = got && got.base === base;
    return {
      key: k,
      base,
      values: over ? got.values : {},
      restored: !!over,
      conflict: got && !over ? got : null,
    };
  };
  const [s, setS] = useState(() => load(key));
  let now = s;
  if (s.key !== key || s.base !== base) {
    now = load(key);
    setS(now);
  }
  const live = useRef(now);
  live.current = now;
  const put = (next: typeof now) => {
    live.current = next;
    setS(next);
  };
  return {
    key: now.key,
    base: now.base,
    values: now.conflict ? now.conflict.values : now.values,
    restored: now.restored,
    conflict: now.conflict,
    set: (field, text) => {
      const cur = live.current;
      // Typing over a conflict keeps it: the words stay on their own base until picked.
      const on = cur.conflict ? cur.conflict.base : cur.base;
      const values = { ...(cur.conflict?.values ?? cur.values), [field]: text };
      if (cur.key) writeForm(env.storage, cur.key, values, on, env.now());
      put(cur.conflict ? { ...cur, conflict: { values, base: on } } : { ...cur, values });
    },
    clear: () => {
      const cur = live.current;
      if (cur.key) writeForm(env.storage, cur.key, null, cur.base, env.now());
      put({ ...cur, values: {}, restored: false, conflict: null });
    },
    keepMine: () => {
      const cur = live.current;
      if (!cur.conflict) return;
      if (cur.key) writeForm(env.storage, cur.key, cur.conflict.values, cur.base, env.now());
      put({ ...cur, values: cur.conflict.values, restored: true, conflict: null });
    },
    takeTheirs: () => {
      const cur = live.current;
      if (cur.key) writeForm(env.storage, cur.key, null, cur.base, env.now());
      put({ ...cur, values: {}, restored: false, conflict: null });
    },
  };
}

/** Forget what's kept under `key` (it was sent after its dialog closed). */
export function forgetForm(key: string | null) {
  if (key) writeForm(browserEnv().storage, key, null, "", Date.now());
}
