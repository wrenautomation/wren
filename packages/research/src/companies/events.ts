/**
 * A firm's dated news (designs/2026-10-06-company-events.md): an acquisition, a merger, a funding
 * round or a new leader in the last 6 months, each kept as a `news` finding with its date and
 * source. Free only: Google News RSS when a fetcher is given (no Google page budget), then Google's
 * page (signed out, on the desk), then Exa's search from the keys' free daily credit. Each source
 * is asked only when the one before it couldn't answer. A rename alone is never an event, and a
 * hit with no date is never kept. Kinds are a parameter; the default is the 4 above.
 */
import type { SiteClient } from "@wren/core/content";
import { FetchError, type Fetcher } from "../fetch/fetcher.js";
import type { CompanyFindingDraft } from "../findings.js";
import { Capped, paced, realSleep, refusedBy, searchStopped } from "../pacing.js";
import { bareCompanyName, type Firm, plain } from "../people/names.js";
import { firmSite } from "./profile.js";

/** Every kind a hit can be read as. */
export const NEWS_KINDS = [
  "acquisition",
  "merger",
  "funding",
  "leader",
  "launch",
  "office",
  "award",
  "partnership",
  "expansion",
] as const;
export type EventKind = (typeof NEWS_KINDS)[number];
/** The default kinds: what `crm run` searches. */
export const EVENT_KINDS: readonly EventKind[] = ["acquisition", "merger", "funding", "leader"];
export const EVENT_MONTHS = 6;
const EVENT_RESULTS = 10;
/** Keyword reads of a snippet, not a model's: a wrong one costs a call, not a send. */
const EVENT_CONFIDENCE = 0.6;

// ponytail: keyword reads, a model pass when false hits show up in briefs.
/** In order: a hit is the first enabled kind it matches. */
const KINDS: [EventKind, RegExp][] = [
  ["acquisition", /\b(acquir(e|es|ed|ing)|acquisition|buys|bought|takeover)\b/i],
  ["merger", /\b(merg(e|es|ed|er|ing))\b/i],
  ["funding", /\b(raises?|raised|funding|series [a-f]\b|seed round|growth investment)\b/i],
  [
    "leader",
    /\b(appoint(s|ed)?|names?|named|hires?|promot(es|ed)|welcomes|new)\b[^.]{0,60}\b(ceo|chief \w+ officer|president|managing director|cfo|coo|cto)\b/i,
  ],
  [
    "office",
    /\b(open(s|ed|ing)?\b[^.]{0,40}\b(office|location|branch|headquarters)|new (office|location|branch|headquarters))\b/i,
  ],
  ["launch", /\b(launch(es|ed|ing)?|unveil(s|ed)?|introduc(es|ed))\b/i],
  ["partnership", /\b(partner(s|ed|ing)? with|partnership|teams? up with|alliance)\b/i],
  ["expansion", /\b(expand(s|ed|ing)?|expansion)\b/i],
  [
    "award",
    /\b(awards?|awarded|honou?red|named (to|among|one of)|ranked|wins [^.]{0,40}\baward)\b/i,
  ],
];

/** Each kind's words in a Google query and its phrase in Exa's. */
const KIND_WORDS: Record<EventKind, { google: string[]; exa: string }> = {
  acquisition: { google: ["acquired", "acquisition"], exa: "acquisition" },
  merger: { google: ["merger"], exa: "merger" },
  funding: { google: ["funding", "raises"], exa: "funding round" },
  leader: { google: ["appoints", '"new CEO"'], exa: "new CEO" },
  launch: { google: ["launches"], exa: "launch" },
  office: { google: ['"new office"'], exa: "new office" },
  award: { google: ["award"], exa: "award" },
  partnership: { google: ["partnership"], exa: "partnership" },
  expansion: { google: ["expands", "expansion"], exa: "expansion" },
};

export interface CompanyEvent {
  kind: EventKind;
  /** YYYY-MM-DD. */
  date: string;
  title: string;
  snippet: string | null;
  url: string;
  source: "rss" | "google" | "exa";
  /** The hit as the source returned it: the finding's document. */
  raw: unknown;
}

export interface EventHit {
  title: string;
  url: string;
  snippet?: string | null;
  /** Google's printed date ("Aug 21, 2026", "3 days ago") or an ISO date (Exa, RSS). */
  date?: string | null;
  /** The hit as the source returned it; default the hit itself. */
  raw?: unknown;
}

const MONTH = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const AGO: Record<string, number> = { hour: 0, day: 1, week: 7, month: 30 };

/** The day a hit was published, as YYYY-MM-DD; null when it doesn't say. */
export function eventDate(said: string | null | undefined, now: Date): string | null {
  const s = said?.trim().toLowerCase();
  if (!s) return null;
  const ago = /^(\d+) (hour|day|week|month)s? ago$/.exec(s);
  if (ago) {
    const days = Number(ago[1]) * (AGO[ago[2] as string] ?? 0);
    return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  }
  const printed = /^([a-z]{3})[a-z]* (\d{1,2}), (\d{4})$/.exec(s);
  if (printed) {
    const m = MONTH.indexOf(printed[1] as string);
    if (m < 0) return null;
    return new Date(Date.UTC(Number(printed[3]), m, Number(printed[2]))).toISOString().slice(0, 10);
  }
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/** The hit names the firm: its bare name as whole words, or it is on the firm's own site. */
function aboutFirm(h: EventHit, firm: Firm): boolean {
  if (firmSite(h.url, firm.domain)) return true;
  const name = firm.name ? plain(bareCompanyName(firm.name)) : "";
  if (name.length < 3) return false;
  return ` ${plain(`${h.title} ${h.snippet ?? ""}`)} `.includes(` ${name} `);
}

/** The firm's events among search hits: dated within 6 months, about the firm, one per url. Pure. */
export function readEvents(
  hits: readonly EventHit[],
  firm: Firm,
  source: CompanyEvent["source"],
  now: Date,
  kinds: readonly EventKind[] = EVENT_KINDS,
): CompanyEvent[] {
  const read = KINDS.filter(([k]) => kinds.includes(k));
  const since = new Date(now);
  since.setUTCMonth(since.getUTCMonth() - EVENT_MONTHS);
  const from = since.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  const out: CompanyEvent[] = [];
  for (const h of hits) {
    const date = eventDate(h.date, now);
    if (!date || date < from || date > to || out.some((e) => e.url === h.url)) continue;
    if (!aboutFirm(h, firm)) continue;
    const text = `${h.title} ${h.snippet ?? ""}`;
    const kind = read.find(([, re]) => re.test(text))?.[0];
    if (!kind) continue;
    const raw = h.raw ?? h;
    out.push({ kind, date, title: h.title, snippet: h.snippet ?? null, url: h.url, source, raw });
  }
  return out;
}

export const eventQuery = (
  firm: Firm,
  source: CompanyEvent["source"],
  kinds: readonly EventKind[] = EVENT_KINDS,
): string | null => {
  const name = firm.name ? bareCompanyName(firm.name) : null;
  if (!name || name.length < 3) return null;
  if (source === "rss") return `"${name}"`;
  if (source === "google")
    return `"${name}" ${kinds.flatMap((k) => KIND_WORDS[k].google).join(" OR ")}`;
  const phrases = kinds.map((k) => KIND_WORDS[k].exa);
  const last = phrases.pop();
  return `${name} ${phrases.length ? `${phrases.join(", ")} or ${last}` : last} news`;
};

export const NEWS_RSS = "https://news.google.com/rss/search";

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (s: string): string =>
  s
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#"
        ? String.fromCodePoint(
            e[1]?.toLowerCase() === "x" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)),
          )
        : (ENTITY[e.toLowerCase()] ?? m),
    )
    .trim();
const tag = (item: string, name: string): string | null => {
  const m = new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(item);
  return m ? unxml(m[2] as string) : null;
};

/**
 * Google News RSS items as hits; null when the text is not a feed (a consent page). The
 * description is HTML: its text is the snippet. The pubDate becomes an ISO date. Pure.
 */
export function readRss(xml: string): EventHit[] | null {
  if (!/<rss[\s>]/i.test(xml)) return null;
  const hits: EventHit[] = [];
  for (const [, body] of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = body as string;
    const title = tag(item, "title");
    const url = tag(item, "link");
    if (!title || !url) continue;
    const pubDate = tag(item, "pubDate");
    const at = pubDate ? new Date(pubDate) : null;
    const description = tag(item, "description");
    const source = /<source\s+url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/i.exec(item);
    hits.push({
      title,
      url,
      snippet: description
        ? unxml(description.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ")
        : null,
      date: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null,
      raw: {
        title,
        link: url,
        pubDate,
        description,
        source: source
          ? { url: unxml(source[1] as string), name: unxml(source[2] as string) }
          : null,
      },
    });
  }
  return hits;
}

export type EventsState = "found" | "none" | "unresolved" | "capped";

export interface EventsTried {
  step: "rss" | "google" | "exa";
  what: string;
  outcome: string;
}

export interface EventsResult {
  state: EventsState;
  events: CompanyEvent[];
  tried: EventsTried[];
  retryAt: Date | null;
  /** Google said stop (cap or a bot check): the rest of the run skips it. */
  googleStopped: boolean;
}

/** A kept event as a dated `news` finding; its raw hit is the document. */
export const eventFinding = (
  companyId: number,
  e: CompanyEvent,
): CompanyFindingDraft & { signalAt: Date; dated: "published" } => ({
  kind: "news",
  companyId,
  factKey: `company:${companyId}:news:${e.url}`.slice(0, 500),
  value: { event: e.kind, date: e.date, title: e.title, snippet: e.snippet },
  confidence: EVENT_CONFIDENCE,
  via: e.source,
  sourceUrl: e.url,
  document: {
    url: e.url,
    kind: "snippet",
    title: e.title,
    text: JSON.stringify(e.raw) ?? "null",
    fetchTier: e.source,
  },
  signalAt: new Date(`${e.date}T00:00:00Z`),
  dated: "published",
});

interface GoogleSerp {
  results?: { title: string; url: string; snippet?: string | null; date?: string | null }[];
}
interface WebSerp {
  results?: { title: string | null; url: string; snippet?: string | null; raw?: unknown }[];
}

/**
 * One firm's events: Google News RSS (only with `fetcher`), else Google, else Exa. A source
 * answers unless it failed or is out. A cap on Exa parks the firm until it lifts; a search that
 * found nothing dated is `none`; one with no query or every source refused is `unresolved`.
 */
export async function searchEvents(
  sites: SiteClient,
  firm: Firm,
  opts: {
    google: boolean;
    /** Kinds to keep; default `EVENT_KINDS`. */
    kinds?: readonly EventKind[];
    /** Reads Google News RSS first; none = skip it. */
    fetcher?: Fetcher | null;
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<EventsResult> {
  const kinds = opts.kinds ?? EVENT_KINDS;
  const clock = opts.now ?? (() => new Date());
  const call = paced(sites, clock, opts.sleep ?? realSleep);
  const tried: EventsTried[] = [];
  let googleStopped = false;
  const done = (state: EventsState, events: CompanyEvent[] = [], retryAt: Date | null = null) => ({
    state,
    events,
    tried,
    retryAt,
    googleStopped,
  });

  const gq = eventQuery(firm, "google", kinds);
  if (!gq) {
    tried.push({ step: "google", what: "-", outcome: "no name to search" });
    return done("unresolved");
  }
  if (opts.fetcher) {
    const rq = eventQuery(firm, "rss") as string;
    const url = `${NEWS_RSS}?${new URLSearchParams({ q: rq, hl: "en-US", gl: "US", ceid: "US:en" })}`;
    let outcome: string;
    try {
      const res = await opts.fetcher.get(url);
      const hits = res.status === 200 ? readRss(res.text) : null;
      if (hits) {
        const events = readEvents(hits, firm, "rss", clock(), kinds);
        tried.push({
          step: "rss",
          what: rq,
          outcome: `${hits.length} items, ${events.length} events`,
        });
        return done(events.length ? "found" : "none", events);
      }
      outcome = res.status === 200 ? "not a feed" : `HTTP ${res.status}`;
    } catch (err) {
      if (!(err instanceof FetchError)) throw err;
      outcome = `failed: ${err.message}`;
    }
    tried.push({ step: "rss", what: rq, outcome });
  }
  if (opts.google) {
    try {
      const res = await call<GoogleSerp>("web", "GET", "/google", { q: gq, n: EVENT_RESULTS });
      const events = readEvents(res.results ?? [], firm, "google", clock(), kinds);
      tried.push({
        step: "google",
        what: gq,
        outcome: `${res.results?.length ?? 0} results, ${events.length} events`,
      });
      return done(events.length ? "found" : "none", events);
    } catch (err) {
      const stopped = searchStopped(err, "web");
      const refused = refusedBy(err);
      if (!stopped && refused === null) throw err;
      googleStopped = Boolean(stopped);
      tried.push({
        step: "google",
        what: gq,
        outcome: stopped ? `stopped: ${stopped.why}` : `refused: ${refused}`,
      });
    }
  }

  const eq = eventQuery(firm, "exa", kinds) as string;
  try {
    const res = await call<WebSerp>("web", "GET", "/search", {
      q: eq,
      n: EVENT_RESULTS,
      via: "exa",
    });
    const hits = (res.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url,
      snippet: r.snippet ?? null,
      date: (r.raw as { publishedDate?: string } | undefined)?.publishedDate ?? null,
      raw: r,
    }));
    const events = readEvents(hits, firm, "exa", clock(), kinds);
    tried.push({
      step: "exa",
      what: eq,
      outcome: `${hits.length} results, ${events.length} events`,
    });
    return done(events.length ? "found" : "none", events);
  } catch (err) {
    if (err instanceof Capped) {
      tried.push({ step: "exa", what: eq, outcome: `capped: ${err.why}` });
      return done("capped", [], err.retryAt);
    }
    const refused = refusedBy(err);
    if (refused === null) throw err;
    tried.push({ step: "exa", what: eq, outcome: `refused: ${refused}` });
    return done("unresolved");
  }
}
