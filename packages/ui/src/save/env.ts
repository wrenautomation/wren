import { EDITS } from "../data/edits.js";

/**
 * What the save engine touches outside itself, in one place so a test hands in fakes: the
 * device's storage, the browser's locks, the page's events, ids and the clock.
 */

/** The bit of `Storage` the journal uses. */
export type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The bit of `navigator.locks` the engine uses: one holder per name, across tabs. */
export interface Locks {
  request<R>(name: string, run: () => Promise<R>): Promise<R>;
}

/** Page moments that make a save go now. */
export type PageEvent = "hidden" | "pagehide" | "online";

export interface SaveEnv {
  /** Where unsaved values wait; null when blocked (a private window). */
  storage: Store | null;
  /** Web Locks, or null: saves then queue in this tab only. */
  locks: Locks | null;
  /** Calls `fn` on each page event until the returned function is called. */
  listen(fn: (e: PageEvent) => void): () => void;
  /** A fresh request id. */
  id(): string;
  now(): number;
}

function webLocks(): Locks | null {
  const l = (globalThis.navigator as { locks?: LockManager } | undefined)?.locks;
  if (!l?.request) return null;
  return {
    request: <R>(name: string, run: () => Promise<R>) => l.request(name, run) as Promise<R>,
  };
}

function listenPage(fn: (e: PageEvent) => void): () => void {
  if (typeof addEventListener !== "function" || typeof document === "undefined") return () => {};
  const away = () => {
    if (document.visibilityState === "hidden") fn("hidden");
  };
  const gone = () => fn("pagehide");
  const back = () => fn("online");
  document.addEventListener("visibilitychange", away);
  addEventListener("pagehide", gone);
  addEventListener("online", back);
  return () => {
    document.removeEventListener("visibilitychange", away);
    removeEventListener("pagehide", gone);
    removeEventListener("online", back);
  };
}

let counter = 0;
/** A random id; a counter where the browser has no `crypto.randomUUID`. */
export function newId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    counter += 1;
    return `r${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** The browser's, read when asked. */
export function browserEnv(): SaveEnv {
  return {
    // The one edits store, under the client shown now (`../data/edits.ts`).
    storage: EDITS.view(),
    locks: webLocks(),
    listen: listenPage,
    id: newId,
    now: () => Date.now(),
  };
}
