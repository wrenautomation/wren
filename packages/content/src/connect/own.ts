/**
 * Wren's own channels on Account → Social, for the team only: each platform Wren posts to, its
 * handle, how it posts (from config), its token's lapse and last renewal (TokenRenewal's `runs`
 * rows), its last post and last failure (`content_drafts`, `draft_events`), and a Check that runs
 * autobrowse's site check through the same `sites`/`desk` service the channels use: `status` for
 * the site's probe, then that one who-am-I read, then `renew {dry}` for the lapse date.
 *
 * Nothing here reads a token or an env value: config arrives as booleans and modes, and every
 * line from autobrowse or a platform is scrubbed of anything that looks like a key.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Platform } from "@wren/core/content";
import { RENEWAL_COMMAND } from "@wren/core/content/renewal";
import type { SitesHost } from "@wren/core/content/restate";
import { looksLikeKey } from "@wren/core/key-refs";
import { draftEvents, runs } from "@wren/core/schema";
import type { Queryable } from "@wren/db";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { PLATFORM_SPECS } from "../platforms.js";
import { contentDrafts, socialDays } from "../schema.js";

/** The settings that decide how each channel posts, as the worker reads them (no values). */
export interface OwnSwitches {
  /** `WREN_CONTENT_CHANNELS`, in its order. */
  channels: readonly Platform[];
  /** `WREN_MEDIA_BUCKET` and `WREN_META_PAGE_ID` both set: Instagram posts by the Graph API. */
  instagramGraph: boolean;
  /** Every `WREN_REDDIT_*` set: Reddit posts by its API with Wren's own token. */
  redditApi: boolean;
  /** `WREN_AUTOBROWSE_INSTANCE_ID` set: `sites` on the AWS box; else `desk` on the Mac. */
  box: boolean;
}

/** The settings `contentFor` reads, by their `Settings` names; only whether each is set leaves. */
export interface OwnSettings {
  contentChannels: readonly Platform[];
  mediaBucket?: string | undefined;
  metaPageId?: string | undefined;
  redditClientId?: string | undefined;
  redditClientSecret?: string | undefined;
  redditRefreshToken?: string | undefined;
  redditUsername?: string | undefined;
  autobrowseInstanceId?: string | undefined;
}

/** The switches from settings, as `contentFor` and `redditFrom` in the worker decide them. */
export function ownSwitchesOf(s: OwnSettings): OwnSwitches {
  return {
    channels: [...s.contentChannels],
    instagramGraph: Boolean(s.mediaBucket && s.metaPageId),
    redditApi: Boolean(
      s.redditClientId && s.redditClientSecret && s.redditRefreshToken && s.redditUsername,
    ),
    box: Boolean(s.autobrowseInstanceId),
  };
}

/** Where a channel's calls go: autobrowse on the box, on the Mac, or wren straight to the API. */
export type OwnWhere = "box" | "desk" | "wren";

/** One channel as config wires it. */
export interface OwnChannel {
  platform: Platform;
  label: string;
  /** The autobrowse site its calls name; null when wren calls the API itself. */
  site: string | null;
  where: OwnWhere;
  /** The autobrowse login it runs as (`linkedin@wren`); null = the site's own. */
  account: string | null;
  /** api: the platform's API; browser: a page in a signed-in browser; either: autobrowse picks per call. */
  via: "api" | "browser" | "either";
  /** How it posts, in a few words. */
  how: string;
  /** The settings that decide it, by name. */
  switches: readonly string[];
  /** Posts with no token: a browser page only. */
  tokenless: boolean;
}

const WHERE: Record<OwnWhere, string> = {
  box: "on the AWS box",
  desk: "on the Mac",
  wren: "from Wren",
};

/** Each channel as `contentFor` in the worker wires it (apps/worker/src/services.ts). */
export function ownChannels(s: OwnSwitches): OwnChannel[] {
  const host: OwnWhere = s.box ? "box" : "desk";
  const hostSwitch = "WREN_AUTOBROWSE_INSTANCE_ID";
  return s.channels.map((platform): OwnChannel => {
    const label = PLATFORM_SPECS[platform]?.name ?? platform;
    const base = { platform, label, account: null, tokenless: false };
    const sites = (site: string, extra: Partial<OwnChannel> = {}): OwnChannel => ({
      ...base,
      site,
      where: host,
      via: "either",
      how: `Autobrowse ${WHERE[host]}, by API or browser per call`,
      switches: ["WREN_CONTENT_CHANNELS", hostSwitch],
      ...extra,
    });
    switch (platform) {
      case "linkedin":
        return sites("linkedin", { account: "linkedin@wren" });
      case "reddit":
        return s.redditApi
          ? {
              ...base,
              site: null,
              where: "wren",
              via: "api",
              how: "Reddit's API, with Wren's own token",
              switches: ["WREN_REDDIT_CLIENT_ID", "WREN_REDDIT_REFRESH_TOKEN"],
            }
          : {
              ...base,
              site: "reddit",
              where: "desk",
              via: "browser",
              how: "The browser on the Mac",
              switches: ["WREN_REDDIT_CLIENT_ID", "WREN_REDDIT_REFRESH_TOKEN"],
              tokenless: true,
            };
      case "instagram":
        return s.instagramGraph
          ? sites("meta", {
              via: "api",
              how: `Meta's Graph API, through autobrowse ${WHERE[host]}`,
              switches: ["WREN_META_PAGE_ID", "WREN_MEDIA_BUCKET"],
            })
          : sites("instagram", {
              via: "browser",
              how: `Instagram's composer in the browser ${WHERE[host]}`,
              switches: ["WREN_META_PAGE_ID", "WREN_MEDIA_BUCKET"],
              tokenless: true,
            });
      case "facebook":
        return sites("meta", {
          via: "api",
          how: `Meta's Graph API, through autobrowse ${WHERE[host]}`,
          switches: ["WREN_META_PAGE_ID"],
        });
      case "tiktok":
        return sites("tiktok", {
          via: "api",
          how: `TikTok's posting API, through autobrowse ${WHERE[host]}`,
        });
      default:
        return sites(platform);
    }
  });
}

// ---- Words a person can read ----

/** Any word that looks like a key, gone. */
export function scrub(text: string): string {
  return text
    .split(/(\s+)/)
    .map((w) => (looksLikeKey(w.replace(/^["'(<[]+|["'),.;:>\]]+$/g, "")) ? "[hidden]" : w))
    .join("");
}

const CODE_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/^401$/, "Sign-in refused (401). The token may have lapsed."],
  [/^403$/, "The platform refused it (403)."],
  [/^404$/, "The platform said not found (404)."],
  [/^(408|504)$/, "No answer in time."],
  [/^422$/, "The platform refused what was sent (422)."],
  [/^429$/, "Too many calls for now (429)."],
  [/^5\d\d$/, "The platform had a problem"],
];

/**
 * A failure in plain words: what kind of refusal first, then the platform's own reason, short.
 * `linkedin POST /rest/posts: 429 Too Many Requests` → `Too many calls for now (429). Too Many Requests`.
 */
export function plainFailure(text: string | null | undefined): string {
  const raw = scrub((text ?? "").replace(/\s+/g, " ").trim());
  if (!raw) return "It failed with no reason given.";
  // `site METHOD /path: ` from SiteCallError; a leading `Error: ` from a ledger row.
  const body = raw
    .replace(/^(\w*Error: )+/, "")
    .replace(/^\S+ (GET|POST|PUT|PATCH|DELETE) \S+: /, "")
    .trim();
  const m = /^(\d{3})\b[:\s-]*(.*)$/.exec(body);
  const short = (s: string) => (s.length > 1600 ? `${s.slice(0, 1599).trimEnd()}…` : s);
  if (m) {
    const [, code = "", rest = ""] = m;
    const lead = CODE_WORDS.find(([re]) => re.test(code))?.[1];
    const said = lead?.endsWith("problem") ? `${lead} (${code}).` : (lead ?? `Refused (${code}).`);
    return rest ? `${said} ${short(rest)}` : said;
  }
  if (/timed? ?out|timeout/i.test(body)) return `No answer in time. ${short(body)}`;
  return short(body);
}

const NAME_KEYS = ["username", "screen_name", "customUrl", "display_name", "name", "title"];

/**
 * The account's handle in an answer from the platform (a who-am-I read, a follower count's raw
 * answer): its username first, else its name. Looks two levels down (`data`, `items[0].snippet`).
 */
export function handleOf(raw: unknown, depth = 0): string | null {
  if (!raw || typeof raw !== "object" || depth > 3) return null;
  if (Array.isArray(raw)) return handleOf(raw[0], depth + 1);
  const o = raw as Record<string, unknown>;
  for (const k of NAME_KEYS) {
    const v = o[k];
    if (typeof v === "string" && v.trim() && v.length <= 80 && !looksLikeKey(v)) return v.trim();
  }
  for (const k of ["data", "user", "items", "snippet", "me"]) {
    const h = handleOf(o[k], depth + 1);
    if (h) return h;
  }
  return null;
}

/** The handle in a post's link: x.com/<h>/status, tiktok.com/@<h>, reddit.com/user/<h>. */
export function handleFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const parts = u.pathname.split("/").filter(Boolean);
  const host = u.hostname.replace(/^www\./, "");
  if (/^(x|twitter)\.com$/.test(host) && parts[1] === "status" && parts[0] !== "i")
    return parts[0] ?? null;
  const at = parts.find((p) => p.startsWith("@"));
  if (at && /tiktok\.com|youtube\.com|threads\.(net|com)/.test(host)) return at.slice(1);
  if (/reddit\.com$/.test(host) && (parts[0] === "user" || parts[0] === "u"))
    return parts[1] ?? null;
  return null;
}

// ---- What the database holds ----

export interface OwnRows {
  posts: Array<{ platform: string; at: Date | null; url: string | null }>;
  failures: Array<{ platform: string | null; at: Date; kind: string; note: string | null }>;
  days: Array<{ platform: string; raw: unknown }>;
  /** TokenRenewal's passes, newest first. */
  renewals: Array<{ at: Date; finishedAt: Date | null; stats: unknown }>;
}

const RENEWALS_READ = 60;

/** One read per source, each the newest row per platform. */
export async function readOwnRows(db: Queryable, platforms: readonly Platform[]): Promise<OwnRows> {
  if (!platforms.length) return { posts: [], failures: [], days: [], renewals: [] };
  const [posts, failures, days, renewals] = await Promise.all([
    db
      .selectDistinctOn([contentDrafts.platform], {
        platform: contentDrafts.platform,
        at: contentDrafts.publishedAt,
        url: contentDrafts.url,
      })
      .from(contentDrafts)
      .where(
        and(
          eq(contentDrafts.status, "published"),
          isNotNull(contentDrafts.publishedAt),
          inArray(contentDrafts.platform, [...platforms]),
        ),
      )
      .orderBy(contentDrafts.platform, desc(contentDrafts.publishedAt)),
    db
      .selectDistinctOn([draftEvents.platform], {
        platform: draftEvents.platform,
        at: draftEvents.at,
        kind: draftEvents.kind,
        note: draftEvents.note,
      })
      .from(draftEvents)
      .where(and(eq(draftEvents.event, "failed"), inArray(draftEvents.platform, [...platforms])))
      .orderBy(draftEvents.platform, desc(draftEvents.at), desc(draftEvents.id)),
    db
      .selectDistinctOn([socialDays.platform], {
        platform: socialDays.platform,
        raw: socialDays.raw,
      })
      .from(socialDays)
      .where(inArray(socialDays.platform, [...platforms]))
      .orderBy(socialDays.platform, desc(socialDays.day)),
    db
      .select({ at: runs.startedAt, finishedAt: runs.finishedAt, stats: runs.stats })
      .from(runs)
      .where(eq(runs.command, RENEWAL_COMMAND))
      .orderBy(desc(runs.startedAt))
      .limit(RENEWALS_READ),
  ]);
  return { posts, failures, days, renewals };
}

// ---- The view ----

export interface OwnRenewal {
  at: string;
  ok: boolean;
  /** What it said about this site, scrubbed: "Renewed", or why not. */
  said: string;
}

export interface OwnChannelView {
  platform: Platform;
  label: string;
  handle: string | null;
  /** The autobrowse login it runs as, when not the site's own. */
  login: string | null;
  posts: { via: OwnChannel["via"]; where: OwnWhere; how: string; switches: readonly string[] };
  token: {
    /** none: it posts in the browser; kept: autobrowse keeps it; wren: in wren's settings. */
    kind: "none" | "kept" | "wren";
    /** The lapse date a renewal pass named for this site, newest first. */
    lapses: string | null;
    /** The newest renewal pass that ran a step for this site. */
    renewal: OwnRenewal | null;
  };
  lastPost: { at: string; url: string | null } | null;
  lastFailure: { at: string; what: string; why: string } | null;
  /** The Check can reach a site for it. */
  checkable: boolean;
}

export interface OwnView {
  channels: OwnChannelView[];
  /** Platforms Wren could post to that config leaves off, by name. */
  off: string[];
  /** TokenRenewal's newest pass: when, whether it ran, and the soonest lapse after it. */
  renewal: { at: string; ok: boolean; why: string | null; next: string | null } | null;
}

interface RenewStats {
  lines?: unknown;
  next?: unknown;
  error?: unknown;
}

const LINE =
  /^(due:|renewed|could not renew) (\S+) .*?\((?:was lapsing|lapses) ([^)]+)\)(?::\s*(.*))?$/;

/** A renewal line about one site: `renewed linkedin consent (was lapsing 2026-…)`. */
export function renewalLine(
  line: string,
): { site: string; ok: boolean | null; lapses: string | null; why: string | null } | null {
  const m = LINE.exec(line.trim());
  if (!m) return null;
  const [, verb, site = "", date = "", why = ""] = m;
  return {
    site,
    ok: verb === "renewed" ? true : verb === "due:" ? null : false,
    // Renewed: the old date is past history; the new one shows on the next pass or a Check.
    lapses: verb === "renewed" ? null : date.trim(),
    why: why ? plainFailure(why) : null,
  };
}

const iso = (d: Date | string | null | undefined) =>
  d ? (d instanceof Date ? d.toISOString() : new Date(d).toISOString()) : null;

const WHAT: Record<string, string> = {
  post: "A post",
  video: "A video",
  thread: "A thread",
  comment: "A comment",
  post_comment: "A comment",
  dm: "A DM",
  invite: "An invite",
  invite_note: "An invite",
};

/** Everything the page shows, from config and the rows. Pure. */
export function ownView(
  channels: readonly OwnChannel[],
  rows: OwnRows,
  every: readonly Platform[],
): OwnView {
  const passes = rows.renewals.map((r) => ({ ...r, stats: (r.stats ?? {}) as RenewStats }));
  const newest = passes[0];
  const renewal = newest
    ? {
        at: iso(newest.at) as string,
        ok: newest.finishedAt !== null && typeof newest.stats.error !== "string",
        why:
          typeof newest.stats.error === "string"
            ? plainFailure(newest.stats.error)
            : newest.finishedAt
              ? null
              : "Still running, or stopped before it finished.",
        next: typeof newest.stats.next === "string" ? newest.stats.next : null,
      }
    : null;
  const bySite = (site: string) => {
    let lapses: string | null = null;
    let done: OwnRenewal | null = null;
    for (const p of passes) {
      const lines = Array.isArray(p.stats.lines) ? p.stats.lines : [];
      for (const l of lines) {
        const r = typeof l === "string" ? renewalLine(l) : null;
        if (!r || r.site !== site) continue;
        if (lapses === null && r.lapses && !done) lapses = r.lapses;
        if (!done && r.ok !== null)
          done = {
            at: iso(p.at) as string,
            ok: r.ok,
            said: r.ok ? "Renewed" : (r.why ?? "Could not renew"),
          };
      }
      if (done) break;
    }
    return { lapses, renewal: done };
  };
  const out = channels.map((c): OwnChannelView => {
    const post = rows.posts.find((p) => p.platform === c.platform);
    const fail = rows.failures.find((f) => f.platform === c.platform);
    const day = rows.days.find((d) => d.platform === c.platform);
    const kind = c.tokenless ? "none" : c.site === null ? "wren" : "kept";
    const token = kind === "kept" && c.site ? bySite(c.site) : { lapses: null, renewal: null };
    return {
      platform: c.platform,
      label: c.label,
      handle: handleOf(day?.raw) ?? handleFromUrl(post?.url),
      login: c.account,
      posts: { via: c.via, where: c.where, how: c.how, switches: c.switches },
      token: { kind, ...token },
      lastPost: post?.at ? { at: iso(post.at) as string, url: post.url ?? null } : null,
      lastFailure: fail
        ? {
            at: iso(fail.at) as string,
            what: WHAT[fail.kind] ?? "A step",
            why: plainFailure(fail.note),
          }
        : null,
      checkable: c.site !== null,
    };
  });
  const on = new Set(channels.map((c) => c.platform));
  const off = every.filter((p) => !on.has(p)).map((p) => PLATFORM_SPECS[p]?.name ?? p);
  return { channels: out, off, renewal };
}

// ---- The Check ----

/** The part of autobrowse's `sites/status` answer the Check reads. */
export interface OwnSiteRow {
  authed?: boolean;
  routes?: Array<{
    method: string;
    path: string;
    via: "api" | "browser" | "none";
    missing?: string;
  }>;
  probe?: { path: string; input?: Record<string, unknown> };
}

/** What autobrowse's `sites/renew {dry: true}` answers that the Check reads. */
export interface OwnRenewDry {
  due?: Array<{ site: string; expiresAt: string }>;
  next?: string | null;
}

/** The `sites`/`desk` calls a Check makes, so a test or the preview can stand in. */
export interface OwnSites {
  status(where: OwnWhere, site: string): Promise<OwnSiteRow>;
  read(
    where: OwnWhere,
    site: string,
    path: string,
    input: Record<string, unknown>,
    account: string | null,
  ): Promise<unknown>;
  renewDry(where: OwnWhere): Promise<OwnRenewDry | null>;
  now(): Promise<number>;
}

export interface OwnCheck {
  platform: Platform;
  at: string;
  /** null: nothing to check for it here. */
  ok: boolean | null;
  said: string;
  ms: number | null;
  /** autobrowse can mint a bearer for the site now. */
  authed: boolean | null;
  /** The site's routes now, by how each answers. */
  routes: { api: number; browser: number; none: number } | null;
  lapses: string | null;
  handle: string | null;
}

/** `/rest/socialActions/{urn}` matches `/rest/socialActions/urn:li:share:1` (autobrowse `matchPath`). */
function matches(pattern: string, path: string): boolean {
  const p = pattern.split("/");
  const a = (path.split("?")[0] ?? "").split("/");
  return (
    p.length === a.length &&
    p.every((seg, i) => {
      const m = /^([^{}]*)\{[^{}]+\}([^{}]*)$/.exec(seg);
      const got = a[i] ?? "";
      if (!m) return seg === got;
      const [, before = "", after = ""] = m;
      return (
        got.startsWith(before) && got.endsWith(after) && got.length > before.length + after.length
      );
    })
  );
}

/** Words from an error, with its code when it has one: `401 bad token`. */
const errorWords = (err: unknown): string => {
  if (err instanceof restate.TerminalError) return `${err.code ?? ""} ${err.message}`.trim();
  return err instanceof Error ? err.message : String(err);
};

/**
 * autobrowse's `site check` for one channel: the site's status, its who-am-I probe on the API
 * leg (as the channel's login), and a dry renew for the lapse date. One probe call per Check.
 */
export async function checkOwn(sites: OwnSites, c: OwnChannel): Promise<OwnCheck> {
  const at = new Date(await sites.now()).toISOString();
  const none = { authed: null, routes: null, lapses: null, handle: null, ms: null };
  if (!c.site)
    return {
      platform: c.platform,
      at,
      ok: null,
      said: "Wren calls this API itself, so there is nothing to check here.",
      ...none,
    };
  let row: OwnSiteRow;
  try {
    row = await sites.status(c.where, c.site);
  } catch (err) {
    return {
      platform: c.platform,
      at,
      ok: false,
      said: `Autobrowse ${WHERE[c.where]} didn't answer. ${plainFailure(errorWords(err))}`,
      ...none,
    };
  }
  const routes = { api: 0, browser: 0, none: 0 };
  for (const r of row.routes ?? []) routes[r.via] = (routes[r.via] ?? 0) + 1;
  const dry = await sites.renewDry(c.where).catch(() => null);
  const lapses = dry?.due?.find((d) => d.site === c.site)?.expiresAt ?? null;
  const base = { platform: c.platform, at, authed: row.authed ?? null, routes, lapses };
  const probe = row.probe;
  if (!probe)
    return {
      ...base,
      ok: null,
      said: "Autobrowse has no sign-in check for this site.",
      ms: null,
      handle: null,
    };
  const leg = (row.routes ?? []).find((r) => r.method === "GET" && matches(r.path, probe.path));
  // The status's `via` is the site's own token; a login's token is only found by calling as it.
  if (!c.account && leg?.via !== "api")
    return {
      ...base,
      ok: null,
      said: leg?.missing
        ? `Its sign-in check can't run: ${scrub(leg.missing)}.`
        : "Its sign-in check only works in the browser.",
      ms: null,
      handle: null,
    };
  const t = await sites.now();
  try {
    const answer = await sites.read(c.where, c.site, probe.path, probe.input ?? {}, c.account);
    const ms = (await sites.now()) - t;
    return { ...base, ok: true, said: "Signed in and answering.", ms, handle: handleOf(answer) };
  } catch (err) {
    const ms = (await sites.now()) - t;
    return { ...base, ok: false, said: plainFailure(errorWords(err)), ms, handle: null };
  }
}

/** How long a Check waits on autobrowse for each call before it says so. */
export const CHECK_WAIT_MS = { status: 45_000, read: 45_000, renew: 20_000 } as const;

type SitesCalls = {
  status: (ctx: restate.Context, req: { site: string }) => Promise<OwnSiteRow>;
  call: (
    ctx: restate.Context,
    req: {
      site: string;
      method: "GET";
      path: string;
      input?: Record<string, unknown>;
      account?: string;
      caller?: string;
    },
  ) => Promise<unknown>;
  renew: (ctx: restate.Context, req: { dry?: boolean }) => Promise<OwnRenewDry>;
};

/**
 * The Check's calls through this invocation: the box's `sites` (woken first, once) or the Mac's
 * `desk`, each a durable call with a wait cap, so a sleeping Mac answers "no answer in time".
 */
export function restateOwnSites(ctx: restate.Context, box: SitesHost): OwnSites {
  let woken: Promise<unknown> | null = null;
  const client = (where: OwnWhere) => {
    if (where === "box") {
      const wake = box.wake;
      if (wake) woken ??= ctx.run("wake autobrowse", wake);
      return { svc: ctx.serviceClient<SitesCalls>(box.service), ready: woken ?? Promise.resolve() };
    }
    return { svc: ctx.serviceClient<SitesCalls>({ name: "desk" }), ready: Promise.resolve() };
  };
  const capped = async <T>(p: restate.RestatePromise<T>, ms: number): Promise<T> => {
    try {
      return await p.orTimeout(ms);
    } catch (err) {
      if (err instanceof restate.TimeoutError)
        throw new restate.TerminalError(`no answer in ${Math.round(ms / 1000)} s`, {
          errorCode: 504,
        });
      throw err;
    }
  };
  return {
    async status(where, site) {
      const { svc, ready } = client(where);
      await ready;
      return capped(svc.status({ site }), CHECK_WAIT_MS.status);
    },
    async read(where, site, path, input, account) {
      const { svc, ready } = client(where);
      await ready;
      return capped(
        svc.call({
          site,
          method: "GET",
          path,
          input,
          ...(account ? { account } : {}),
          caller: "wren:own-check",
        }),
        CHECK_WAIT_MS.read,
      );
    },
    async renewDry(where) {
      const { svc, ready } = client(where);
      await ready;
      return capped(svc.renew({ dry: true }), CHECK_WAIT_MS.renew);
    },
    now: () => ctx.date.now(),
  };
}
