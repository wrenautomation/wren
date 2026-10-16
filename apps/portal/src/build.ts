/**
 * Which build of the app a tab runs (wa-ovo). The web build writes its id into each page
 * (`<meta name="wren-build">`) and into `build.json` beside them (web/vite.config.ts `buildId`);
 * the tab sends it on every call. A write from another build, or a send from a tab too old to
 * send one, is told to reload: its wire may not be what this Worker takes.
 *
 * Shared by the Worker and the web: no Worker-only imports here.
 */

/** The header a tab names its build in. */
export const BUILD_HEADER = "x-wren-build";
/** Where the deploy's own build id is, among its assets. */
export const BUILD_FILE = "/build.json";
/** The meta tag the web build writes into each page. */
export const BUILD_META = "wren-build";
/** What a refusal's `metadata.code` says for a tab on an old build. */
export const STALE_CODE = "stale";

export const STALE_SEND = "Wren was updated since this tab opened. Reload to send.";
export const STALE_WRITE = "Wren was updated since this tab opened. Reload and try again.";

/**
 * Whether a write from build `tab` is stale against the live build `live`. Unknown live build:
 * never. No build named: only for a send, as a tab from before build ids (a script or the phone's
 * Shortcut sends none, and sends nothing that reaches a person).
 */
export function isStale(live: string | null, tab: string | null, send: boolean): boolean {
  if (!live) return false;
  return tab ? tab !== live : send;
}
