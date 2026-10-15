/**
 * Unsaved typing in a long editor (a workflow's graph, a document, a page's copy), kept on this
 * device until the server holds it: a reload, a crash or a closed tab gives it back
 * (designs/2026-10-14-saving-and-ui-audit.md). Each copy names the base it was typed over, so
 * a restored copy saves against that base and a save made elsewhere meanwhile shows as a
 * conflict, never a silent overwrite. The shared save engine (`packages/ui/src/save/`) takes
 * this over once it lands: same key and shape.
 */
import { useCallback, useRef } from "react";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface Unsaved<T> {
  /** The version it was typed over, as the editor sends it back (`expect`). */
  base: string;
  value: T;
  at: number;
}

const PREFIX = "wren.unsaved:";
/** A week: older typing is stale whatever it was typed over. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

function local(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Keep `value` typed over `base`, now. */
export function keepUnsaved<T>(
  key: string,
  base: string,
  value: T,
  store: Store | null = local(),
  now = Date.now(),
): void {
  try {
    store?.setItem(PREFIX + key, JSON.stringify({ base, value, at: now } satisfies Unsaved<T>));
  } catch {
    // Storage full or blocked: the editor still saves when asked.
  }
}

/** What was kept for `key`, or null; a copy past a week is dropped. */
export function unsavedOf<T>(
  key: string,
  store: Store | null = local(),
  now = Date.now(),
): Unsaved<T> | null {
  try {
    const raw = store?.getItem(PREFIX + key);
    if (!raw) return null;
    const k = JSON.parse(raw) as Partial<Unsaved<T>>;
    if (typeof k.base === "string" && "value" in k && now - Number(k.at ?? 0) < KEEP_MS)
      return { base: k.base, value: k.value as T, at: Number(k.at) };
    store?.removeItem(PREFIX + key);
    return null;
  } catch {
    return null;
  }
}

/** The server holds it (or he threw it away): nothing to give back. */
export function dropUnsaved(key: string, store: Store | null = local()): void {
  try {
    store?.removeItem(PREFIX + key);
  } catch {
    // Blocked storage: nothing was kept.
  }
}

/** A fresh id for one press of an action: sent again on a retry, the server runs it once. */
export const newRequestId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

/**
 * One run at a time, held in a ref so two presses in the same frame (a double click, Enter on a
 * busy button) can't both start: the second answers undefined and does nothing.
 */
export function useOnce(): <T>(fn: () => Promise<T>) => Promise<T | undefined> {
  const flying = useRef(false);
  return useCallback(async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (flying.current) return undefined;
    flying.current = true;
    try {
      return await fn();
    } finally {
      flying.current = false;
    }
  }, []);
}
