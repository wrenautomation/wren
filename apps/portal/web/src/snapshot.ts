/**
 * What the portal last showed, kept on the device, so the next load paints it at once and
 * refreshes behind it (the way a phone app opens on its last screen). Read only for the login
 * that wrote it; a sign-out or a refused sign-in wipes it. Pure, so it tests without a browser.
 */

export const SNAPSHOT_KEY = "wren.portal.snapshot";
/** At most this many characters of answers, newest kept first. */
export const SNAPSHOT_MAX_CHARS = 1_500_000;
/** Older than this, the snapshot is dropped: a week away is a fresh start. */
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 3600_000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
interface Kept {
  who: string;
  at: number;
  entries: [string, unknown][];
}

/** The answers `who` last saw here, oldest first; empty when they're someone else's or stale. */
export function readSnapshot(store: Store, who: string | null, now: number): [string, unknown][] {
  if (!who) return [];
  try {
    const s = JSON.parse(store.getItem(SNAPSHOT_KEY) ?? "null") as Kept | null;
    if (!s || s.who !== who || !Array.isArray(s.entries) || now - s.at > SNAPSHOT_MAX_AGE_MS)
      return [];
    return s.entries;
  } catch {
    return [];
  }
}

/** Keep `entries` (oldest first) for `who`, the newest that fit under `max` characters. */
export function writeSnapshot(
  store: Store,
  who: string,
  now: number,
  entries: readonly [string, unknown][],
  max = SNAPSHOT_MAX_CHARS,
): void {
  const fit: [string, unknown][] = [];
  let size = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as [string, unknown];
    let n: number;
    try {
      n = JSON.stringify(e).length;
    } catch {
      continue; // Not plain data: never kept.
    }
    if (size + n > max) continue;
    size += n;
    fit.unshift(e);
  }
  try {
    store.setItem(SNAPSHOT_KEY, JSON.stringify({ who, at: now, entries: fit } satisfies Kept));
  } catch {
    // Full or blocked storage: the next load just asks the server.
  }
}

export function dropSnapshot(store: Store): void {
  try {
    store.removeItem(SNAPSHOT_KEY);
  } catch {
    // Blocked storage held nothing.
  }
}
