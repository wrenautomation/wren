/**
 * Unsaved words in a draft box, kept on this device until they save. A reload (a deploy, a
 * sign-in refresh, a crash) puts them back in the box, as long as the saved draft is still the
 * one he was editing; if it moved on meanwhile (Claude wrote, someone saved), they are dropped.
 */

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface Kept {
  base: string;
  text: string;
  at: number;
}

const PREFIX = "wren.draft:";
/** A week: older words are stale, whatever the draft says. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

function local(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Keep `text` typed over `base`; clean words (back to what was saved) drop the copy. */
export function keepDraft(
  key: string,
  base: string,
  text: string,
  store: Store | null = local(),
  now = Date.now(),
): void {
  try {
    if (text.trim() === base.trim()) store?.removeItem(PREFIX + key);
    else store?.setItem(PREFIX + key, JSON.stringify({ base, text, at: now } satisfies Kept));
  } catch {
    // Storage full or blocked: the box still saves as he types.
  }
}

/** The words kept for `key` over this `server` text, or null. A copy that no longer fits is dropped. */
export function keptDraft(
  key: string,
  server: string,
  store: Store | null = local(),
  now = Date.now(),
): string | null {
  try {
    const raw = store?.getItem(PREFIX + key);
    if (!raw) return null;
    const k = JSON.parse(raw) as Partial<Kept>;
    if (
      typeof k.text === "string" &&
      typeof k.base === "string" &&
      k.base.trim() === server.trim() &&
      k.text.trim() !== server.trim() &&
      now - Number(k.at ?? 0) < KEEP_MS
    )
      return k.text;
    store?.removeItem(PREFIX + key);
    return null;
  } catch {
    return null;
  }
}
