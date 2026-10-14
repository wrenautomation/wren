/**
 * A tab older than the live build. Every push to main deploys the portal, and the deploy keeps
 * only the new build's files. A tab opened before it still runs the old app, so the first page
 * that loads a lazy piece (the Workflows canvas's graph, a chart, a note) asks for a file that is
 * gone, gets the app's HTML back and fails. The only cure is a fresh load: do it once, quietly.
 */

/** What each browser says when a module or its preload can't be fetched. */
const STALE = [
  /Failed to fetch dynamically imported module/i, // Chrome, Edge
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Expected a JavaScript(-or-Wasm)? module script/i, // a gone file answered with the app's HTML
  /Unable to preload CSS/i, // Vite's preload of a gone stylesheet
];

/** True when `error` is a lazy file the live build no longer has. */
export function isStaleChunk(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error ?? "");
  return STALE.some((re) => re.test(message));
}

const KEY = "wren:stale-reload";
/** A second failure this soon after a reload is a real missing file: show it, never loop. */
const AGAIN_MS = 30_000;

/**
 * Reload once for a stale tab. False when this tab reloaded for it in the last 30 seconds: then
 * the file is really missing and the page shows its problem instead.
 */
export function reloadOnce(
  store: Pick<Storage, "getItem" | "setItem"> | null = safeSession(),
  now = Date.now(),
  reload: () => void = () => window.location.reload(),
): boolean {
  const last = Number(store?.getItem(KEY) ?? 0);
  if (last && now - last < AGAIN_MS) return false;
  try {
    store?.setItem(KEY, String(now));
  } catch {
    // Storage blocked: the reload still goes; a loop is capped by the browser's own load.
  }
  reload();
  return true;
}

function safeSession(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
