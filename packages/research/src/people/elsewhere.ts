/**
 * Where else is this person online? Asks the `web` site's search (Exa) for their name with each
 * handle we hold and the firm, and keeps result pages on known platforms. Pure over a paced
 * call: `lookUpPerson` runs it only when asked (`opts.elsewhere`), `profile-research.ts` stores it.
 *
 * A page is kept when its title names them, or when a handle we hold and the firm both show in
 * it. Confidence counts what matched: name, firm, handle. A name alone is a weak match.
 */

import type { SiteClient } from "@wren/core/content";
import { normalizeHandle } from "@wren/core/touches";
import { Capped, refusedBy, searchStopped } from "../pacing.js";
import { type Firm, firmNames, mentionsFirm, plain, sameName } from "./names.js";

/** Search results per query: as in the studies' search. */
export const HITS_PER_QUERY = 8;
/** Searches per run at most: one for the firm, then one per handle held. */
const ELSEWHERE_SEARCHES = 3;

export interface ElsewhereHit {
  /** A platform handle we can hold as a key, or a link we only show. */
  kind: "handle" | "link";
  /** `linkedin`, `x`, `instagram`, `reddit`, `youtube`, `tiktok`, `facebook`; links: `github`, `threads`, `site`. */
  platform: string;
  /** The normalized handle; for a link, the owner (github, threads) or the host (site). */
  value: string;
  url: string;
  /** The result's title, as the page shows it. */
  title: string;
  confidence: number;
  /** What matched: the name, the firm, a handle we hold. */
  matched: { name: boolean; firm: boolean; handle: boolean };
  /** The search that found it. */
  query: string;
}

export interface ElsewhereSubject {
  firstName: string | null;
  lastName: string | null;
  firm: Firm;
  /** Handles we hold, already normalized. */
  handles: { platform: string; handle: string }[];
}

interface ElsewhereTried {
  step: "elsewhere";
  what: string;
  outcome: string;
}

interface ElsewhereRun {
  hits: ElsewhereHit[];
  tried: ElsewhereTried[];
  /** A cap said stop: the rest of the searches were not asked. */
  capped: Capped | null;
}

interface Hit {
  title: string;
  url: string;
  snippet?: string;
}

/** A page as a platform page, null for anything we do not keep. */
export interface Page {
  kind: "handle" | "link";
  platform: string;
  value: string;
  url: string;
}

const FB_RESERVED = new Set(
  "watch groups events pages marketplace photo photo.php profile.php share sharer login public hashtag story.php permalink.php people p reel reels videos help policies privacy gaming ads business stories search l.php plugins dialog tr about legal".split(
    " ",
  ),
);
const GH_RESERVED = new Set(
  "orgs topics sponsors features about pricing login explore marketplace settings notifications search collections trending events apps enterprise security pulls issues readme site customer-stories new organizations users".split(
    " ",
  ),
);

const hostOf = (u: URL) => u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
const onHost = (host: string, name: string) => host === name || host.endsWith(`.${name}`);

/** Name words of 3+ letters, joined: how a handle or a domain label spells a person. */
const compact = (s: string) => plain(s).replace(/ /g, "");

/** A result's page as a platform page; null for pages we do not keep. */
export function pageOf(url: string, title: string, subject: ElsewhereSubject): Page | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = hostOf(u);
  const segs = u.pathname.split("/").filter(Boolean);
  const handle = (platform: string, text: string, link?: string): Page | null => {
    const ref = normalizeHandle(platform, text);
    const to = link ?? ref?.url;
    return ref && to ? { kind: "handle", platform, value: ref.handle, url: to } : null;
  };
  if (onHost(host, "linkedin.com")) return segs[0] === "in" ? handle("linkedin", url) : null;
  if (onHost(host, "x.com") || onHost(host, "twitter.com")) return handle("x", url);
  if (onHost(host, "instagram.com")) return handle("instagram", url);
  if (onHost(host, "reddit.com")) return handle("reddit", url);
  if (onHost(host, "youtube.com")) {
    const first = segs[0] ?? "";
    return first.startsWith("@") || (first === "channel" && segs[1])
      ? handle("youtube", url)
      : null;
  }
  if (onHost(host, "tiktok.com")) {
    const h = (segs[0] ?? "").startsWith("@") ? (segs[0] ?? "").slice(1).toLowerCase() : "";
    return /^[a-z0-9._]{2,24}$/.test(h)
      ? handle("tiktok", h, `https://www.tiktok.com/@${h}`)
      : null;
  }
  if (onHost(host, "facebook.com") || host === "fb.com") {
    const h = (segs[0] ?? "").toLowerCase();
    return /^[a-z0-9.]{5,50}$/.test(h) && !FB_RESERVED.has(h)
      ? handle("facebook", h, `https://www.facebook.com/${h}`)
      : null;
  }
  if (onHost(host, "github.com")) {
    const owner = (segs[0] ?? "").toLowerCase();
    return /^[a-z0-9-]{1,39}$/.test(owner) && !GH_RESERVED.has(owner)
      ? { kind: "link", platform: "github", value: owner, url: `https://github.com/${owner}` }
      : null;
  }
  if (onHost(host, "threads.net") || onHost(host, "threads.com")) {
    const h = (segs[0] ?? "").startsWith("@") ? (segs[0] ?? "").slice(1).toLowerCase() : "";
    return /^[a-z0-9._]{1,30}$/.test(h)
      ? { kind: "link", platform: "threads", value: h, url: `https://www.threads.net/@${h}` }
      : null;
  }
  // A personal site: a domain that spells their name, and a title that is their name.
  const labels = host.split(".").slice(0, -1).map(compact).filter(Boolean);
  const first = compact(subject.firstName ?? "");
  const last = compact(subject.lastName ?? "");
  const spells = labels.some(
    (l) =>
      (last.length >= 3 && l.includes(last)) ||
      (first.length >= 3 && last && l.includes(first) && l.includes(last)),
  );
  const firmHost = subject.firm.domain?.toLowerCase().replace(/^www\./, "");
  if (!spells || (firmHost && onHost(host, firmHost))) return null;
  if (!sameName(subject, nameIn(title)) || nameIn(title).split(/\s+/).length > 4) return null;
  return {
    kind: "link",
    platform: "site",
    value: host,
    url: `${u.protocol}//${u.host}${u.pathname}`,
  };
}

/** The name a page's title leads with: "Jane Doe (@jd) - Title | Site" -> "Jane Doe (@jd)". */
export function nameIn(title: string): string {
  const lead = title.split(/\s+[-–—|•·]\s+|\s*\|\s*|:\s+/)[0] ?? "";
  return lead
    .replace(
      /\s+on\s+(X|Twitter|Instagram|Facebook|LinkedIn|TikTok|Threads|YouTube|Reddit|GitHub)\b.*$/i,
      "",
    )
    .trim();
}

/** The queries to ask, at most `ELSEWHERE_SEARCHES`: the firm's, then one per handle held. */
export function queriesFor(s: ElsewhereSubject): string[] {
  const who = [s.firstName, s.lastName].filter(Boolean).join(" ");
  const full = !!s.firstName && !!s.lastName;
  const firm = firmNames(s.firm)[0];
  // A LinkedIn URN, a company page or an X id says nothing a search can use.
  const handles = [
    ...new Set(s.handles.map((h) => h.handle).filter((h) => !/^(urn:|company:|name:|id:)/.test(h))),
  ];
  const out: string[] = [];
  if (full && firm) out.push(`${who} ${firm}`);
  else if (full) out.push(who);
  for (const h of handles) out.push(`${who} ${h}`.trim());
  return [...new Set(out)].slice(0, ELSEWHERE_SEARCHES);
}

/** Judge one result against what we hold; null when it is not them. */
function judge(h: Hit, page: Page, s: ElsewhereSubject, query: string): ElsewhereHit | null {
  const text = `${h.url} ${h.title} ${h.snippet ?? ""}`;
  const held = s.handles.filter((x) => compact(x.handle).length >= 3);
  // The same platform's handle is the page itself: already ours, nothing to find.
  if (s.handles.some((x) => x.platform === page.platform && x.handle === page.value)) return null;
  const spelled = compact(text);
  const first = compact(s.firstName ?? "");
  const last = compact(s.lastName ?? "");
  const handleSpellsName =
    page.kind === "handle" &&
    !!first &&
    !!last &&
    compact(page.value).includes(first) &&
    compact(page.value).includes(last);
  const name = sameName(s, nameIn(h.title)) || handleSpellsName;
  const firm = mentionsFirm(text, s.firm, [[s.firstName, s.lastName].filter(Boolean).join(" ")]);
  const handle = held.some((x) => spelled.includes(compact(x.handle)));
  if (!name && !(handle && firm)) return null;
  const confidence = Math.min(0.95, (name ? 0.4 : 0) + (firm ? 0.3 : 0) + (handle ? 0.25 : 0));
  return {
    kind: page.kind,
    platform: page.platform,
    value: page.value,
    url: page.url,
    title: h.title,
    confidence: Math.round(confidence * 100) / 100,
    matched: { name, firm, handle },
    query,
  };
}

/**
 * Run the searches. A cap stops them and comes back in `capped`; a refused or failed search is a
 * line in `tried` and the next one goes on. Anything else (a bug) throws.
 */
export async function searchElsewhere(
  call: <T>(...args: Parameters<SiteClient["call"]>) => Promise<T>,
  s: ElsewhereSubject,
): Promise<ElsewhereRun> {
  const tried: ElsewhereTried[] = [];
  const kept = new Map<string, ElsewhereHit>();
  const queries = queriesFor(s);
  if (!queries.length) {
    tried.push({ step: "elsewhere", what: "-", outcome: "nothing to search with" });
    return { hits: [], tried, capped: null };
  }
  let capped: Capped | null = null;
  for (const q of queries) {
    let res: { hits?: Hit[]; via?: string };
    try {
      res = await call("web", "GET", "/search", { q, n: HITS_PER_QUERY });
    } catch (err) {
      if (err instanceof Capped) {
        capped = err;
        break;
      }
      const stopped = searchStopped(err, "web");
      const refused = refusedBy(err);
      if (!stopped && refused === null) throw err;
      tried.push({
        step: "elsewhere",
        what: q,
        outcome: stopped ? `stopped: ${stopped.why}` : `refused: ${refused}`,
      });
      if (stopped) break;
      continue;
    }
    const hits = res.hits ?? [];
    let found = 0;
    for (const h of hits) {
      const page = pageOf(h.url, h.title ?? "", s);
      const hit = page && judge({ ...h, title: h.title ?? "" }, page, s, q);
      if (!hit) continue;
      found += 1;
      const ref = `${hit.kind}:${hit.platform}:${hit.value}`;
      const had = kept.get(ref);
      if (!had || had.confidence < hit.confidence) kept.set(ref, hit);
    }
    tried.push({
      step: "elsewhere",
      what: q,
      outcome: `${hits.length} results, ${found} kept`,
    });
  }
  const hits = [...kept.values()].sort((a, b) => b.confidence - a.confidence);
  return { hits, tried, capped };
}
