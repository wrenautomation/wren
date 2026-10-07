/**
 * Who clicked the site link in which email. Each message's sign-off link
 * carries `?r=<messages.link_code>`; the lander records the code on the visit
 * and keeps every later visit and form from that browser. This reads the
 * lander's export and names each code: message, step, company, address.
 *
 * Read only, nothing stored. The lander is the source of truth for visits and
 * the numbers are small, so a re-read is cheaper than a second copy to keep in
 * step. A click is interest, not consent: nothing sends or stops on it.
 */
import { companies } from "@wren/core/schema";
import type { Queryable } from "@wren/db";
import { eq, inArray } from "drizzle-orm";
import type { FetchLike } from "../fetch-like.js";
import { enrollments, messages } from "../schema.js";

/** Rows per request; the lander caps at 5000. */
export const SITE_PAGE = 5000;
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

export interface SiteTables {
  hits: SiteHit;
  applications: SiteApplication;
  replays: SiteReplay;
  events: SiteEvent;
  /** `exp.seen` events with a visitor (cookie yes): what experiments count. */
  exposures: SiteEvent;
}

/** Every row of one lander table after id `since` (all of them by default), paged forward by id. */
export async function siteExport<T extends keyof SiteTables>(
  table: T,
  opts: { baseUrl: string; exportToken: string; fetch?: FetchLike; since?: number },
): Promise<SiteTables[T][]> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const out: SiteTables[T][] = [];
  let since = opts.since ?? 0;
  for (let page = 0; page < SITE_MAX_PAGES; page++) {
    const url = new URL(`${opts.baseUrl.replace(/\/+$/, "")}/api/export`);
    url.searchParams.set("table", table);
    url.searchParams.set("since", String(since));
    url.searchParams.set("limit", String(SITE_PAGE));
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${opts.exportToken}` },
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
    out.push(...(rows as SiteTables[T][]));
    if (rows.length < SITE_PAGE) return out;
    since = (rows[rows.length - 1] as { id: number }).id;
  }
  throw new SiteExportError(
    `more than ${SITE_PAGE * SITE_MAX_PAGES} ${table}; raise SITE_MAX_PAGES`,
  );
}

/** One email link code that was clicked, named, with what those visitors did after. */
export interface EmailClick {
  code: string;
  firstClick: string;
  /** null = no message holds this code: typed by hand, or from a message since deleted. */
  message: {
    id: number;
    step: number;
    niche: string;
    toEmail: string;
    company: string | null;
    sentAt: Date | null;
  } | null;
  /** Browsers that arrived on this code. Two or more = forwarded, or opened on phone and desk. */
  visitors: number;
  /** Every view those browsers made, from any source. */
  views: number;
  secs: number;
  reachedForm: boolean;
  applied: { offer: string; fit: boolean; ts: string } | null;
}

/** Name each clicked code from `messages.link_code` and follow its visitors. Newest click first. */
export async function emailClicks(
  db: Queryable,
  hits: readonly SiteHit[],
  applications: readonly SiteApplication[],
): Promise<EmailClick[]> {
  const byVisitor = new Map<string, SiteHit[]>();
  const arrivals = new Map<string, SiteHit[]>();
  for (const h of hits) {
    if (h.visitor) byVisitor.set(h.visitor, [...(byVisitor.get(h.visitor) ?? []), h]);
    if (h.r) arrivals.set(h.r, [...(arrivals.get(h.r) ?? []), h]);
  }
  const codes = [...arrivals.keys()];
  const named =
    codes.length === 0
      ? []
      : await db
          .select({
            code: messages.linkCode,
            id: messages.id,
            step: messages.step,
            toEmail: messages.toEmail,
            sentAt: messages.sentAt,
            niche: enrollments.niche,
            company: companies.name,
          })
          .from(messages)
          .innerJoin(enrollments, eq(enrollments.id, messages.enrollmentId))
          .leftJoin(companies, eq(companies.id, enrollments.companyId))
          .where(inArray(messages.linkCode, codes));
  const messageOf = new Map(named.map(({ code, ...m }) => [code as string, m]));

  return codes
    .map((code) => {
      const came = arrivals.get(code) ?? [];
      const visitors = new Set(came.map((h) => h.visitor).filter((v): v is string => !!v));
      const seen = [...visitors].flatMap((v) => byVisitor.get(v) ?? []);
      const applied = applications
        .filter((a) => a.visitor && visitors.has(a.visitor))
        .sort((a, b) => b.fit - a.fit || a.id - b.id)[0];
      return {
        code,
        firstClick: came.map((h) => h.ts).sort()[0] ?? "",
        message: messageOf.get(code) ?? null,
        visitors: visitors.size,
        views: seen.length || came.length,
        secs: seen.reduce((n, h) => n + h.secs, 0),
        reachedForm: seen.some((h) => h.cta || h.touched),
        applied: applied ? { offer: applied.offer, fit: applied.fit === 1, ts: applied.ts } : null,
      };
    })
    .sort((a, b) => b.firstClick.localeCompare(a.firstClick));
}
