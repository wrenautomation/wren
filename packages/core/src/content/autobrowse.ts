/**
 * autobrowse's site APIs from here: one call shaped like the official API
 * (`call("linkedin", "POST", "/rest/posts", body)`). The worker answers
 * through the platform's API or its browser; this side never knows which,
 * except through `fetchedWith` on what comes back. This is the HTTP client
 * (a laptop against a local autobrowse); the worker uses `restateSites` in
 * `./restate.js`, which reaches the box through Restate without a port.
 */
import type { FetchLike } from "../doh.js";
import type { FetchedWith } from "./index.js";

export type SiteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface SiteClient {
  call<T = unknown>(
    site: string,
    method: SiteMethod,
    path: string,
    input?: Record<string, unknown>,
    /** Which of the site's logins answers (`linkedin@outreach-2`); absent = the site's default. */
    account?: string,
  ): Promise<T>;
  /** How the worker answers a route now; `api` or `browser` (`none` when it cannot yet). */
  via(site: string, method: SiteMethod, path: string): Promise<FetchedWith | "none">;
}

/**
 * Said on a write that failed after it may have reached the platform (a timeout, a 5xx, a
 * rerun after a crash): it may be live. A person checks before it is sent again.
 */
export const MAY_HAVE_POSTED = "may have gone through";

/**
 * autobrowse's words when a step's write went out on an earlier try and its answer was lost
 * (`flow.ts`): as unsure as `MAY_HAVE_POSTED`, though it comes as a 502.
 */
export const WENT_THROUGH = "already went through";

/**
 * How autobrowse starts a write's failure when its submit step never began: nothing left the
 * machine, so asking again is safe. Its other word is `MAY_HAVE_POSTED`.
 */
export const NOT_SENT = "not sent: ";

/** What autobrowse's words say about a failed write: it left, it did not, or they do not say (an older desk). */
export function sentState(message: string | null | undefined): "no" | "maybe" | null {
  if (!message) return null;
  if (message.includes(MAY_HAVE_POSTED) || message.includes(WENT_THROUGH)) return "maybe";
  if (message.includes(NOT_SENT)) return "no";
  return null;
}

/** The status autobrowse answers when a browser profile stayed busy past its wait. */
export const BROWSER_BUSY_STATUS = 503;

/**
 * The desk's browser profile was busy (an explore session held it) for as long as the call
 * waited: nothing was sent. The caller tries again on its next tick; never a failed post.
 */
export function browserBusy(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown } | null;
  const status = err instanceof SiteCallError ? err.status : (e?.code ?? e?.status);
  return (
    status === BROWSER_BUSY_STATUS &&
    saysBrowserBusy(err instanceof Error ? err.message : String(err))
  );
}

/** The words alone (a stored reason): `not sent: profile … is busy …`. */
export const saysBrowserBusy = (message: string | null | undefined): boolean =>
  sentState(message) === "no" && /\bnot sent: profile \S+ is busy\b/.test(message ?? "");

/** Put before an unsure failure's text once a person was told to check it. */
export const CHECKED = "checked: ";

/** A failure whose post may be live anyway: never sent again blind. */
export const mayHavePosted = (message: string | null | undefined): boolean =>
  !!message &&
  (message.includes(MAY_HAVE_POSTED) || message.includes(WENT_THROUGH)) &&
  !message.startsWith(CHECKED);

export class SiteCallError extends Error {
  readonly site: string;
  readonly status: number;
  /**
   * The answer of a journaled call: a retried invocation replays it rather than calling again,
   * so retrying the invocation cannot help (`restateSites` tries again itself first).
   */
  journaled = false;
  constructor(site: string, method: string, path: string, status: number, message: string) {
    super(`${site} ${method} ${path}: ${status} ${message}`);
    this.name = "SiteCallError";
    this.site = site;
    this.status = status;
  }
}

/** Longer than this, a 429's wait outlasts Restate's retries: a daily cap, not a burst. */
const LONG_WAIT_S = 15 * 60;

/**
 * How long a used daily cap holds (a 429 whose wait is hours, as `sites` or a terminal error
 * carrying its message says it), or null for anything else. A caller waits it out instead of
 * asking again and calling the refusal an error.
 */
export function capWaitMs(err: unknown): number | null {
  const message = err instanceof Error ? err.message : String(err);
  const is429 =
    err instanceof SiteCallError
      ? err.status === 429
      : (err as { code?: unknown } | null)?.code === 429 || /\b429\b/.test(message);
  if (!is429) return null;
  const m = /retry after (\d+)s/.exec(message);
  const wait = m ? Number(m[1]) : null;
  return wait !== null && wait > LONG_WAIT_S ? wait * 1000 : null;
}

/**
 * Routes a loop saw capped, each until its cap resets (epoch ms by the loop's own key): kept in
 * the loop's state, so no pass asks a used route again before the reset.
 */
export type CapHolds = Record<string, number>;

/** `key` still waits on a used cap at `now` (ms). */
export const capHeld = (holds: CapHolds, key: string, now: number): boolean =>
  (holds[key] ?? 0) > now;

/** A used cap holds `key` until it resets: true. Anything else changes nothing: false. */
export function holdCap(holds: CapHolds, key: string, err: unknown, now: number): boolean {
  const wait = capWaitMs(err);
  if (wait === null) return false;
  holds[key] = Math.max(holds[key] ?? 0, now + wait);
  return true;
}

/** The holds still running at `now`: what a loop keeps. */
export const liveHolds = (holds: CapHolds, now: number): CapHolds =>
  Object.fromEntries(Object.entries(holds).filter(([, until]) => until > now));

/** The part of autobrowse's site status this side reads. */
export interface SiteStatus {
  routes: Array<{ method: string; path: string; via: "api" | "browser" | "none" }>;
}

/** `/rest/socialActions/{urn}` matches `/rest/socialActions/urn:li:share:1`. */
export function matches(pattern: string, path: string): boolean {
  const p = pattern.split("/");
  const a = (path.split("?")[0] ?? "").split("/");
  const one = (seg: string, got: string) => {
    // `{urn}`, or a fixed prefix/suffix around it (`act_{adAccountId}`).
    const m = /^([^{}]*)\{[^{}]+\}([^{}]*)$/.exec(seg);
    if (!m) return seg === got;
    const [, before = "", after = ""] = m;
    return (
      got.startsWith(before) && got.endsWith(after) && got.length > before.length + after.length
    );
  };
  return p.length === a.length && p.every((seg, i) => one(seg, a[i] ?? ""));
}

/** A route's `via` from a status snapshot; `none` when the worker has no leg for it. */
export function viaOf(status: SiteStatus, method: string, path: string): FetchedWith | "none" {
  const row = status.routes.find((r) => r.method === method && matches(r.path, path));
  return row?.via ?? "none";
}

/**
 * The same client, pinned to one login: every call carries `account`, so an
 * adapter written for "the" LinkedIn works unchanged for any of them.
 */
export function asAccount(sites: SiteClient, account: string | null | undefined): SiteClient {
  if (!account) return sites;
  return {
    call: (site, method, path, input, a) => sites.call(site, method, path, input, a ?? account),
    via: (site, method, path) => sites.via(site, method, path),
  };
}

export function autobrowseSites(o: {
  url: string;
  token?: string | null;
  fetch?: FetchLike;
  /** Who in wren asked, sent as `x-caller` for autobrowse's per-caller usage. */
  caller?: string;
}): SiteClient {
  const doFetch: FetchLike = o.fetch ?? ((u, i) => fetch(u, i));
  const base = o.url.replace(/\/$/, "");
  const headers = (json: boolean) => ({
    ...(json ? { "content-type": "application/json" } : {}),
    ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
    ...(o.caller ? { "x-caller": o.caller } : {}),
  });
  const statusRows = new Map<string, Promise<SiteStatus>>();
  const status = (site: string) => {
    let p = statusRows.get(site);
    if (!p) {
      p = doFetch(`${base}/api/sites/${site}`, { method: "GET", headers: headers(false) }).then(
        async (res) => {
          if (!res.ok) throw new SiteCallError(site, "GET", "/", res.status, await res.text());
          return (await res.json()) as SiteStatus;
        },
      );
      statusRows.set(site, p);
      // A status is a snapshot: tokens get made, flows get recorded. Ask again next time.
      p.finally(() => setTimeout(() => statusRows.delete(site), 60_000).unref?.());
    }
    return p;
  };
  return {
    async call(site, method, path, input = {}, account) {
      const read = method === "GET" || method === "DELETE";
      let url = `${base}/api/sites/${site}${path}`;
      const q = new URLSearchParams();
      if (read)
        for (const [k, v] of Object.entries(input)) if (v !== undefined) q.set(k, String(v));
      // The server takes `account` off the query before the site sees it.
      if (account) q.set("account", account);
      if (q.size) url += `${path.includes("?") ? "&" : "?"}${q}`;
      const res = await doFetch(url, {
        method,
        headers: headers(!read),
        ...(read ? {} : { body: JSON.stringify(input) }),
      });
      const text = await res.text();
      const body = text ? (JSON.parse(text) as unknown) : null;
      if (!res.ok) {
        const message = (body as { error?: string } | null)?.error ?? res.statusText;
        throw new SiteCallError(site, method, path, res.status, message);
      }
      return body as never;
    },
    async via(site, method, path) {
      return viaOf(await status(site), method, path);
    },
  };
}
