/**
 * The one spelling of a post or comment on each platform (designs/2026-10-20-platform-objects.md).
 * Pure: no database, no I/O. `canonRef` turns whatever a reader or writer holds (a bare id, a
 * fullname, a URN, a URL) into the key `platform_objects` uses, or throws. Autobrowse returns raw
 * ids; wren canonicalises here.
 *
 * Core imports no channel package, so every platform's rule lives in this file. `RULES` is typed
 * by `Platform`, so a new platform will not compile until it has a rule.
 */
import type { Platform } from "../content/index.js";
import { OBJECT_KINDS, type ObjectKind } from "../objects-schema.js";

/** A spelling no rule accepts. */
export class CanonError extends Error {
  override name = "CanonError";
}

/**
 * The longest ref we keep. `platform_objects.ref` holds 255, but the role columns of `comments`
 * and `comment_threads` hold 200 (views read them, so they stay), and a key cascade must fit.
 */
const MAX_REF = 200;

interface ObjectId {
  platform: Platform;
  kind: ObjectKind;
  ref: string;
}

/** What one platform's URL parser finds. `kinds` is every kind the URL may serve (default: `kind`). */
interface Found {
  kind: ObjectKind;
  ref: string;
  kinds?: readonly ObjectKind[];
}

interface Rule {
  /** The canonical ref for a spelling that is not a URL. Throws on a spelling it refuses. */
  ref(kind: ObjectKind, raw: string): string;
  /** The object a URL names, or null when it names none or carries no API id. */
  url?(u: URL, host: string): Found | null;
}

const fail = (platform: string, kind: string, raw: string, why: string): CanonError =>
  new CanonError(`${platform} ${kind}: ${why} (${JSON.stringify(raw.slice(0, 120))})`);

/** A URL from text: `https://…`, or `host.tld/path` without a scheme. Null for anything else. */
function parseUrl(text: string): URL | null {
  const s = text.trim();
  const full = /^https?:\/\//i.test(s)
    ? s
    : /^(?:[a-z0-9-]+\.)+[a-z]{2,}\//i.test(s)
      ? `https://${s}`
      : null;
  if (!full) return null;
  try {
    return new URL(full);
  } catch {
    return null;
  }
}

/** True for text `normalUrl` and `fromUrl` read as a URL. */
export const looksLikeUrl = (text: string): boolean => parseUrl(text) !== null;

const hostOf = (u: URL): string => u.hostname.toLowerCase().replace(/^www\./, "");
const onDomain = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`);
const decoded = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

// ---- Reddit: `t3_` posts, `t1_` comments ----------------------------------------------------

const REDDIT_ID = /^[a-z0-9]+$/;
const REDDIT_PREFIX: Readonly<Partial<Record<ObjectKind, string>>> = {
  post: "t3_",
  comment: "t1_",
};

/** `t3_abc` for a post, `t1_abc` for a comment, from a bare id or a fullname of the same kind. */
function redditRef(kind: ObjectKind, raw: string): string {
  const prefix = REDDIT_PREFIX[kind];
  if (!prefix) throw fail("reddit", kind, raw, "Reddit has no objects of this kind");
  const s = raw.toLowerCase();
  const named = /^(t\d)_(.*)$/.exec(s);
  if (named) {
    if (`${named[1]}_` !== prefix) throw fail("reddit", kind, raw, `a ${named[1]}_ fullname`);
    if (!REDDIT_ID.test(named[2] as string)) throw fail("reddit", kind, raw, "not a Reddit id");
    return s;
  }
  if (!REDDIT_ID.test(s)) throw fail("reddit", kind, raw, "not a Reddit id");
  return `${prefix}${s}`;
}

function redditUrl(u: URL, host: string): Found | null {
  if (host === "redd.it") {
    const id = u.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
    return id && REDDIT_ID.test(id) ? { kind: "post", ref: `t3_${id}` } : null;
  }
  if (!onDomain(host, "reddit.com")) return null;
  // /r/<sub>/comments/<post>/<slug>/<comment>, /comments/<post>/_/<comment>, /user/<u>/comments/…
  const parts = u.pathname.split("/").filter(Boolean);
  const at = parts.indexOf("comments");
  const post = parts[at + 1]?.toLowerCase();
  if (at < 0 || !post || !REDDIT_ID.test(post)) return null;
  const comment = parts[at + 3]?.toLowerCase();
  if (comment && REDDIT_ID.test(comment)) return { kind: "comment", ref: `t1_${comment}` };
  return { kind: "post", ref: `t3_${post}` };
}

/** A Reddit post's fullname from a bare id, a `t3_` fullname or a URL. */
export const redditPostRef = (raw: string): string => canonRef("reddit", "post", raw);
/** A Reddit comment's fullname from a bare id, a `t1_` fullname or a URL. */
export const redditCommentRef = (raw: string): string => canonRef("reddit", "comment", raw);

// ---- LinkedIn: a post keeps the URN it came with; a comment is its bare numeric id -------------

const POST_URN = /^urn:li:(?:share|ugcPost|activity):\d+$/;
const COMMENT_URN = /^urn:li:comment:\((urn:li:(?:share|ugcPost|activity):\d+),(\d+)\)$/;
const URN_IN_PATH = /urn:li:(share|ugcPost|activity):(\d+)/;
const POSTS_SLUG = /^\/posts\/.*-(activity|share|ugcPost)-(\d+)-[A-Za-z0-9_]+\/?$/;

function linkedinRef(kind: ObjectKind, raw: string): string {
  if (kind === "post") {
    if (POST_URN.test(raw)) return raw;
    if (/^\d+$/.test(raw))
      throw fail("linkedin", kind, raw, "a bare number is ambiguous; give the URN");
    throw fail("linkedin", kind, raw, "not a share, ugcPost or activity URN");
  }
  if (kind === "comment") {
    if (/^\d+$/.test(raw)) return raw;
    const urn = COMMENT_URN.exec(raw);
    if (urn) return urn[2] as string;
    throw fail("linkedin", kind, raw, "not a numeric comment id or comment URN");
  }
  throw fail("linkedin", kind, raw, "LinkedIn has no objects of this kind");
}

function linkedinUrl(u: URL, host: string): Found | null {
  if (!onDomain(host, "linkedin.com")) return null;
  // The reply or comment a feed link points at beats the post it sits under.
  const inner = u.searchParams.get("replyUrn") ?? u.searchParams.get("commentUrn");
  const comment = inner ? COMMENT_URN.exec(inner) : null;
  if (comment) return { kind: "comment", ref: comment[2] as string };
  const path = decoded(u.pathname);
  const urn = URN_IN_PATH.exec(path);
  if (urn) return { kind: "post", ref: `urn:li:${urn[1]}:${urn[2]}` };
  const slug = POSTS_SLUG.exec(path);
  if (slug) return { kind: "post", ref: `urn:li:${slug[1]}:${slug[2]}` };
  return null;
}

/** Of two spellings of one LinkedIn post, the API URN (`share`, `ugcPost`) beats the feed's `activity`. */
const linkedinPrefer = (a: string, b: string): string =>
  a.startsWith("urn:li:activity:") && /^urn:li:(?:share|ugcPost):/.test(b) ? b : a;

// ---- Every other platform: the API id, trimmed -------------------------------------------------

function apiId(platform: string) {
  return (kind: ObjectKind, raw: string): string => {
    if (/\s/.test(raw)) throw fail(platform, kind, raw, "an id has no spaces");
    return raw;
  };
}

function youtubeUrl(u: URL, host: string): Found | null {
  const id = (s: string | undefined | null) => (s && /^[\w-]{11}$/.test(s) ? s : null);
  let found: string | null = null;
  if (host === "youtu.be") found = id(u.pathname.split("/").filter(Boolean)[0]);
  else if (/^(?:m\.|music\.)?youtube\.com$/.test(host)) {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "watch") found = id(u.searchParams.get("v"));
    else if (["shorts", "live", "embed"].includes(parts[0] ?? "")) found = id(parts[1]);
  }
  return found ? { kind: "post", ref: found } : null;
}

/** A tweet is a post or a reply, and the id space is one: a status URL serves both kinds. */
function xUrl(u: URL, host: string): Found | null {
  if (!/^(?:mobile\.)?(?:x|twitter)\.com$/.test(host)) return null;
  const id = /\/status(?:es)?\/(\d+)/.exec(u.pathname)?.[1];
  return id ? { kind: "post", ref: id, kinds: ["post", "comment"] } : null;
}

function tiktokUrl(u: URL, host: string): Found | null {
  if (!onDomain(host, "tiktok.com")) return null;
  const id = /\/video\/(\d+)/.exec(u.pathname)?.[1];
  return id ? { kind: "post", ref: id } : null;
}

const RULES: Readonly<Record<Platform, Rule>> = {
  reddit: { ref: redditRef, url: redditUrl },
  linkedin: { ref: linkedinRef, url: linkedinUrl },
  youtube: { ref: apiId("youtube"), url: youtubeUrl },
  x: { ref: apiId("x"), url: xUrl },
  // An Instagram, Facebook or Threads page names its post by a shortcode or a path, not the API id.
  instagram: { ref: apiId("instagram") },
  threads: { ref: apiId("threads") },
  facebook: { ref: apiId("facebook") },
  tiktok: { ref: apiId("tiktok"), url: tiktokUrl },
  google_business: { ref: apiId("google_business") },
};

/** Every platform that has a rule, in the order `RULES` lists them. */
export const CANON_PLATFORMS = Object.keys(RULES) as Platform[];

function ruleOf(platform: string): Rule {
  if (!Object.hasOwn(RULES, platform)) throw new CanonError(`unknown platform: ${platform}`);
  return RULES[platform as Platform];
}

/**
 * The canonical ref of an object, from any spelling of it. Throws a `CanonError` on an unknown
 * platform, an empty spelling, a spelling of another kind (`t1_x` as a post), a LinkedIn bare
 * number as a post (it could be a share, an ugcPost or an activity), and a URL that does not carry
 * the API id (an Instagram `/p/<shortcode>` page).
 */
export function canonRef(platform: string, kind: ObjectKind, raw: string): string {
  const rule = ruleOf(platform);
  if (!OBJECT_KINDS.includes(kind)) throw new CanonError(`unknown kind: ${String(kind)}`);
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) throw fail(platform, kind, String(raw ?? ""), "empty");
  const u = parseUrl(text);
  let ref: string;
  if (u) {
    const found = rule.url?.(u, hostOf(u)) ?? null;
    if (!found) throw fail(platform, kind, text, "the URL does not carry the platform's id");
    if (!(found.kinds ?? [found.kind]).includes(kind))
      throw fail(platform, kind, text, `the URL names a ${found.kind}`);
    ref = found.ref;
  } else ref = rule.ref(kind, text);
  if (ref.length > MAX_REF) throw fail(platform, kind, text, `longer than ${MAX_REF} characters`);
  return ref;
}

/** The object a URL names and its canonical ref, or null when the URL carries no API id. Never throws. */
export function fromUrl(url: string): ObjectId | null {
  const u = typeof url === "string" ? parseUrl(url) : null;
  if (!u) return null;
  const host = hostOf(u);
  for (const platform of CANON_PLATFORMS) {
    const found = RULES[platform].url?.(u, host);
    if (found) return { platform, kind: found.kind, ref: found.ref };
  }
  return null;
}

/**
 * A URL as an alias keeps it: `https`, lower-case host without `www.`, no query (a YouTube watch
 * link keeps `v`), no fragment, no trailing slash. Text that is not a URL comes back trimmed.
 */
export function normalUrl(url: string): string {
  const u = parseUrl(url);
  if (!u) return url.trim();
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const port = u.port && u.port !== "443" && u.port !== "80" ? `:${u.port}` : "";
  const path = u.pathname.replace(/\/+$/, "");
  const watch = /^(?:m\.|music\.)?youtube\.com$/.test(host) && path === "/watch";
  const v = watch ? u.searchParams.get("v") : null;
  return `https://${host}${port}${path}${v ? `?v=${encodeURIComponent(v)}` : ""}`;
}

/**
 * Which of two spellings of one object a link keeps. LinkedIn: `share` or `ugcPost` over
 * `activity`. Anything else: `a`.
 */
export function preferRef(platform: string, a: string, b: string): string {
  ruleOf(platform);
  return platform === "linkedin" ? linkedinPrefer(a, b) : a;
}
