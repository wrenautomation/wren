/**
 * A firm's dated news (designs/2026-10-06-company-events.md): an acquisition, a merger, a funding
 * round or a new leader in the last 6 months, each kept as a `news` finding with its date and
 * source. Free only: Google's page first (signed out, on the desk), then Exa's search from the
 * keys' free daily credit when Google is out for the day. A rename alone is never an event, and
 * a hit with no date is never kept.
 */
import type { SiteClient } from "@wren/core/content";
import type { CompanyFindingDraft } from "../findings.js";
import { Capped, paced, realSleep, refusedBy, searchStopped } from "../pacing.js";
import { bareCompanyName, type Firm, plain } from "../people/names.js";
import { firmSite } from "./profile.js";

export const EVENT_KINDS = ["acquisition", "merger", "funding", "leader"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_MONTHS = 6;
const EVENT_RESULTS = 10;
/** Keyword reads of a snippet, not a model's: a wrong one costs a call, not a send. */
const EVENT_CONFIDENCE = 0.6;

// ponytail: keyword reads, a model pass when false hits show up in briefs.
const KINDS: [EventKind, RegExp][] = [
  ["acquisition", /\b(acquir(e|es|ed|ing)|acquisition|buys|bought|takeover)\b/i],
  ["merger", /\b(merg(e|es|ed|er|ing))\b/i],
  ["funding", /\b(raises?|raised|funding|series [a-f]\b|seed round|growth investment)\b/i],
  [
    "leader",
    /\b(appoint(s|ed)?|names?|named|hires?|promot(es|ed)|welcomes|new)\b[^.]{0,60}\b(ceo|chief \w+ officer|president|managing director|cfo|coo|cto)\b/i,
  ],
];

export interface CompanyEvent {
  kind: EventKind;
  /** YYYY-MM-DD. */
  date: string;
  title: string;
  snippet: string | null;
  url: string;
  source: "google" | "exa";
}

export interface EventHit {
  title: string;
  url: string;
  snippet?: string | null;
  /** Google's printed date ("Aug 21, 2026", "3 days ago") or Exa's ISO date. */
  date?: string | null;
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
): CompanyEvent[] {
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
    const kind = KINDS.find(([, re]) => re.test(text))?.[0];
    if (!kind) continue;
    out.push({ kind, date, title: h.title, snippet: h.snippet ?? null, url: h.url, source });
  }
  return out;
}

export const eventQuery = (firm: Firm, source: CompanyEvent["source"]): string | null => {
  const name = firm.name ? bareCompanyName(firm.name) : null;
  if (!name || name.length < 3) return null;
  return source === "google"
    ? `"${name}" acquired OR acquisition OR merger OR funding OR raises OR appoints OR "new CEO"`
    : `${name} acquisition, merger, funding round or new CEO news`;
};

export type EventsState = "found" | "none" | "unresolved" | "capped";

export interface EventsTried {
  step: "google" | "exa";
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

export const eventFinding = (companyId: number, e: CompanyEvent): CompanyFindingDraft => ({
  kind: "news",
  companyId,
  factKey: `company:${companyId}:news:${e.url}`.slice(0, 500),
  value: { event: e.kind, date: e.date, title: e.title, snippet: e.snippet },
  confidence: EVENT_CONFIDENCE,
  via: e.source,
  sourceUrl: e.url,
  document: null,
});

interface GoogleSerp {
  results?: { title: string; url: string; snippet?: string | null; date?: string | null }[];
}
interface WebSerp {
  results?: { title: string | null; url: string; snippet?: string | null; raw?: unknown }[];
}

/**
 * One firm's events: Google, else Exa. A cap on Exa parks the firm until it lifts; a search that
 * found nothing dated is `none`; one with no query or both sources refused is `unresolved`.
 */
export async function searchEvents(
  sites: SiteClient,
  firm: Firm,
  opts: { google: boolean; now?: () => Date; sleep?: (ms: number) => Promise<void> },
): Promise<EventsResult> {
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

  const gq = eventQuery(firm, "google");
  if (!gq) {
    tried.push({ step: "google", what: "-", outcome: "no name to search" });
    return done("unresolved");
  }
  if (opts.google) {
    try {
      const res = await call<GoogleSerp>("web", "GET", "/google", { q: gq, n: EVENT_RESULTS });
      const events = readEvents(res.results ?? [], firm, "google", clock());
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

  const eq = eventQuery(firm, "exa") as string;
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
    }));
    const events = readEvents(hits, firm, "exa", clock());
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
