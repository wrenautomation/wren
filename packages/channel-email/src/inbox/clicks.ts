/**
 * The lander's export, and who clicked what in which email.
 *
 * Each message's sign-off link carries `?r=<messages.link_code>`; the lander records the code on
 * the view the link lands on (`hits.r`). `ClicksScheduler` pulls those views hourly into
 * `email_clicks` (`./click-sync.ts`): one row per code and page, with the first and last click and
 * a count. The sent log (`core/sent-views.ts`) reads that table to set "clicked", and
 * `wren email clicks` lists it (`clickedEmails`) with what each clicker did after (`clickFollowUps`, live). Stored since 2026-10-14 (B7): until then this
 * read the export on every call and kept nothing, but the log needs clicks in SQL.
 *
 * What stays a live read of the export: visits and what a visitor did after (`siteExport`,
 * `clickFollowUps` for `wren email clicks`, the call brief's "On the site", the day tables).
 * A click is interest, not consent: nothing sends or stops on it.
 */
import { companies } from "@wren/core/schema";
import type { Queryable } from "@wren/db";
import { eq } from "drizzle-orm";
import type { FetchLike } from "../fetch-like.js";
import { emailClicks, enrollments, messages } from "../schema.js";

/** Rows per request; the lander caps at 5000. */
export const SITE_PAGE = 5000;
/** One page of a lander table (up to `SITE_PAGE` rows, a replay's events among them). */
const SITE_EXPORT_LIMIT_MS = 2 * 60_000;
/** Requests per table per run: a ceiling, so a bad cursor can't loop against the site. */
export const SITE_MAX_PAGES = 20;

export class SiteExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteExportError";
  }
}

/** One page view on the lander (`hits`). `r` is set only on the view that arrived from an email link. */
export interface SiteHit {
  id: number;
  ts: string;
  visitor: string | null;
  page: string;
  secs: number;
  cta: number;
  touched: number;
  r: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  /** A `/go/` link's third part: the post (`<first 8 of the draft>`), when it names one. */
  utm_content?: string;
  ref?: string;
}

/** One pitch-page application (`applications`), tied to its visitor. */
export interface SiteApplication {
  id: number;
  ts: string;
  visitor: string | null;
  offer: string;
  fit: number;
  r: string;
  email?: string | null;
  /** The visitor's first touch, JSON. */
  first_touch?: string | null;
  /** This tab's touch when they sent it, JSON. */
  last_touch?: string | null;
}

/** One recorded view (`replays`): its rrweb chunks live in S3 under `site/replays/<view>/`. */
export interface SiteReplay {
  id: number;
  view: string;
  visitor: string | null;
  page: string;
  started: string;
  last: string;
  chunks: number;
  bytes: number;
  w: number | null;
  country: string | null;
  capped: number;
  /** The visitor's first touch when recording began, JSON. */
  first_touch?: string | null;
}

/** One thing a visitor did on a page (`events`): `cta`, `form.submit`, `click`, `scroll` and the rest. */
export interface SiteEvent {
  id: number;
  ts: string;
  view: string;
  visitor: string | null;
  page: string;
  name: string;
  /** JSON, 1 KB at most. */
  props: string;
}

/** A visitor's answer to a site survey (`answers`); only with the cookie yes, so always a visitor. */
export interface SiteAnswer {
  id: number;
  ts: string;
  survey: string;
  visitor: string;
  view: string;
  page: string;
  value: string;
}

/** One `/go/` hop to a page of ours (`clicks`): the short name, its utm and the path it went to. */
interface SiteClick {
  id: number;
  ts: string;
  link: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  page: string;
  ref: string | null;
  country: string | null;
}

interface SiteTables {
  hits: SiteHit;
  applications: SiteApplication;
  replays: SiteReplay;
  events: SiteEvent;
  /** `exp.seen` events with a visitor (cookie yes): what experiments count. */
  exposures: SiteEvent;
  answers: SiteAnswer;
  clicks: SiteClick;
}

interface SiteReadOptions {
  baseUrl: string;
  exportToken: string;
  fetch?: FetchLike;
  since?: number;
  /** One visitor's rows only (every table but clicks). */
  visitor?: string;
}

/** One page of one lander table after id `since`, oldest first: at most `SITE_PAGE` rows. */
export async function sitePage<T extends keyof SiteTables>(
  table: T,
  opts: SiteReadOptions,
): Promise<SiteTables[T][]> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const url = new URL(`${opts.baseUrl.replace(/\/+$/, "")}/api/export`);
  url.searchParams.set("table", table);
  url.searchParams.set("since", String(opts.since ?? 0));
  url.searchParams.set("limit", String(SITE_PAGE));
  if (opts.visitor) url.searchParams.set("visitor", opts.visitor);
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${opts.exportToken}` },
      signal: AbortSignal.timeout(SITE_EXPORT_LIMIT_MS),
    });
  } catch (err) {
    throw new SiteExportError(`site unreachable: ${(err as Error).message}`);
  }
  if (response.status === 401) {
    // Named without quoting either value: the secret never reaches a log line.
    throw new SiteExportError(
      "site rejected the export credential: WREN_SITE_EXPORT_TOKEN must equal the lander's EXPORT_TOKEN secret",
    );
  }
  if (response.status === 404)
    throw new SiteExportError("site has no export (EXPORT_TOKEN unset on the lander)");
  if (response.status !== 200) throw new SiteExportError(`site answered ${response.status}`);
  const rows = ((await response.json()) as Record<string, unknown> | null)?.[table];
  if (!Array.isArray(rows)) throw new SiteExportError(`site answered with no ${table}`);
  return rows as SiteTables[T][];
}

/** Every row of one lander table after id `since` (all of them by default), paged forward by id. */
export async function siteExport<T extends keyof SiteTables>(
  table: T,
  opts: SiteReadOptions,
): Promise<SiteTables[T][]> {
  const out: SiteTables[T][] = [];
  let since = opts.since ?? 0;
  for (let page = 0; page < SITE_MAX_PAGES; page++) {
    const rows = await sitePage(table, { ...opts, since });
    out.push(...rows);
    if (rows.length < SITE_PAGE) return out;
    since = (rows[rows.length - 1] as { id: number }).id;
  }
  throw new SiteExportError(
    `more than ${SITE_PAGE * SITE_MAX_PAGES} ${table}; raise SITE_MAX_PAGES`,
  );
}

/** One clicked email: every page its link landed on, counted, named by the message that carried it. */
export interface ClickedEmail {
  code: string;
  /** The pages it landed on, sorted. */
  pages: string[];
  firstAt: Date;
  lastAt: Date;
  /** Clicks on all its pages. */
  clicks: number;
  /** null = no message holds this code: typed by hand, or from a message since deleted. */
  message: {
    id: number;
    step: number;
    niche: string;
    toEmail: string;
    company: string | null;
    sentAt: Date | null;
  } | null;
}

/** The stored clicks, one row per email, latest click first, each named by its message (`messages.link_code`). */
export async function clickedEmails(
  db: Queryable,
  opts: { limit?: number } = {},
): Promise<ClickedEmail[]> {
  const rows = await db
    .select({
      code: emailClicks.linkCode,
      url: emailClicks.url,
      firstAt: emailClicks.firstAt,
      lastAt: emailClicks.lastAt,
      clicks: emailClicks.clicks,
      id: messages.id,
      step: messages.step,
      toEmail: messages.toEmail,
      sentAt: messages.sentAt,
      niche: enrollments.niche,
      company: companies.name,
    })
    .from(emailClicks)
    .leftJoin(messages, eq(messages.id, emailClicks.messageId))
    .leftJoin(enrollments, eq(enrollments.id, messages.enrollmentId))
    .leftJoin(companies, eq(companies.id, enrollments.companyId));
  const byCode = new Map<string, ClickedEmail>();
  for (const r of rows) {
    const seen = byCode.get(r.code);
    if (seen) {
      seen.pages = [...new Set([...seen.pages, r.url])].sort();
      seen.clicks += r.clicks;
      if (r.firstAt < seen.firstAt) seen.firstAt = r.firstAt;
      if (r.lastAt > seen.lastAt) seen.lastAt = r.lastAt;
      continue;
    }
    byCode.set(r.code, {
      code: r.code,
      pages: [r.url],
      firstAt: r.firstAt,
      lastAt: r.lastAt,
      clicks: r.clicks,
      message:
        r.id === null || r.step === null || r.toEmail === null || r.niche === null
          ? null
          : {
              id: r.id,
              step: r.step,
              niche: r.niche,
              toEmail: r.toEmail,
              company: r.company,
              sentAt: r.sentAt,
            },
    });
  }
  return [...byCode.values()]
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime() || a.code.localeCompare(b.code))
    .slice(0, opts.limit ?? 50);
}

/** What the browsers that arrived on one email's link did on the site, from the export's live rows. */
export interface ClickFollowUp {
  /** Browsers that arrived on this code. Two or more = forwarded, or opened on phone and desk. */
  visitors: number;
  /** Every view those browsers made, from any source. */
  views: number;
  secs: number;
  reachedForm: boolean;
  applied: { offer: string; fit: boolean; ts: string } | null;
}

/**
 * Follow each code's visitors through the export's `hits` and `applications`, by code. Read live and
 * never stored: a visitor's later visits are the lander's, and a click is all this side keeps.
 */
export function clickFollowUps(
  hits: readonly SiteHit[],
  applications: readonly SiteApplication[],
): Map<string, ClickFollowUp> {
  const byVisitor = new Map<string, SiteHit[]>();
  const arrivals = new Map<string, SiteHit[]>();
  for (const h of hits) {
    if (h.visitor) byVisitor.set(h.visitor, [...(byVisitor.get(h.visitor) ?? []), h]);
    if (h.r) arrivals.set(h.r, [...(arrivals.get(h.r) ?? []), h]);
  }
  const out = new Map<string, ClickFollowUp>();
  for (const [code, came] of arrivals) {
    const visitors = new Set(came.map((h) => h.visitor).filter((v): v is string => !!v));
    const seen = [...visitors].flatMap((v) => byVisitor.get(v) ?? []);
    const applied = applications
      .filter((a) => a.visitor && visitors.has(a.visitor))
      .sort((a, b) => b.fit - a.fit || a.id - b.id)[0];
    out.set(code, {
      visitors: visitors.size,
      views: seen.length || came.length,
      secs: seen.reduce((n, h) => n + h.secs, 0),
      reachedForm: seen.some((h) => h.cta || h.touched),
      applied: applied ? { offer: applied.offer, fit: applied.fit === 1, ts: applied.ts } : null,
    });
  }
  return out;
}
