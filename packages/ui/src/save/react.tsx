/**
 * The save engine in React, kept thin: `useSaved` holds one `Saver` per key and draws its
 * state; `SaveStatus` is the one status line; `SaveConflict` asks Keep mine or Use theirs.
 * A form's typing until it is sent: `useEditForm` (`../edit-form.tsx`).
 */
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { Button, ScrollText } from "../controls.js";
import { type Conflict, Saver, type SaverOptions, type SaveState, type Status } from "./engine.js";
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
        <ScrollText label="Their version" quiet>
          {show ? show(theirs) : String(theirs)}
        </ScrollText>
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
