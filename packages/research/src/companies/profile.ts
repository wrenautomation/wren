/**
 * The company's LinkedIn page, read from Exa's cache of LinkedIn (`web`
 * `/linkedin/company`; nothing reaches linkedin.com). Candidate pages, cheapest
 * first: the one we hold, the one the matched person's current role links,
 * links on the firm's own pages (footers), Google when the caller allows it,
 * then Exa's company search by domain (only entities whose homepage matches).
 *
 * A page is the firm's only when its website's registrable domain is the
 * firm's own: Exa merges look-alike firms, and a name proves nothing. No
 * match, no write. Every page read is kept, the firm's or not.
 *
 * Pure over a SiteClient: it returns the finding, every page read and the
 * trail; `recordCompanyLookup` writes.
 */
import { extractDomain, registrableDomain } from "@wren/core";
import type { SiteClient } from "@wren/core/content";
import { companies } from "@wren/core/schema";
import type { Queryable } from "@wren/db";
import { eq, sql } from "drizzle-orm";
import {
  type CompanyFindingDraft,
  type DocumentDraft,
  keepDocument,
  keepFinding,
  noNul,
} from "../findings.js";
import { Capped, paced, realSleep, refusedBy, type Stopped, searchStopped } from "../pacing.js";
import { bareCompanyName, type Firm, isFirm } from "../people/names.js";
import { companyLookups, type LookupState } from "../schema.js";

export interface ProfileSubject {
  companyId: number;
  firm: Firm;
  /** `companies.linkedin_url`: a page an earlier lookup tied to the firm. */
  linkedinUrl: string | null;
  /** The matched person's current role's page (`still_there.companyUrl`). */
  personCompanyUrl?: string | null;
  /** linkedin.com/company links on the firm's own pages. */
  pageLinks?: string[];
}

export interface ProfileOptions {
  /** Search Google for the page. The caller keeps its daily budget and hours. */
  google?: boolean;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface ProfileTried {
  step: "page" | "google" | "companies" | "capped";
  what: string;
  outcome: string;
}

export interface ProfileResult {
  state: LookupState;
  /** The firm's page, canonical; null unless matched. */
  url: string | null;
  finding: CompanyFindingDraft | null;
  /** Every page read from the cache, the firm's or not. */
  pages: DocumentDraft[];
  tried: ProfileTried[];
  retryAt: Date | null;
  cappedBy: string | null;
  googleStopped: Stopped | null;
}

/** A company page as the cache returns it; optional fields are absent, never null. */
export interface CompanyPage {
  name: string;
  handle: string;
  url: string;
  website?: string;
  phone?: string;
  industry?: string;
  size?: string;
  headquarters?: string;
  founded?: string | number;
  type?: string;
  employees?: string | number;
  about?: string;
  text: string;
  source: string;
}
interface Serp {
  results: { title: string; url: string }[];
}
interface Companies {
  companies: { linkedin?: string; homepageMatches?: boolean }[];
}

/** Who read the page: Exa's cache of LinkedIn. */
const CACHE_VIA = "exa-cache";
/** A page whose website is the firm's own domain. */
const SURE_PAGE = 0.9;
/** Pages read per company at most. */
const MAX_PAGE_READS = 3;
const GOOGLE_RESULTS = 5;
const COMPANY_SEARCH = 3;

/** The handle or id in a linkedin.com/company/<x> url; null for anything else. */
export function linkedinCompany(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/company\/([^/?#]+)/i.exec(url.trim());
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** `https://www.linkedin.com/company/<handle>/`: one spelling per page. */
export const companyPageUrl = (handle: string): string =>
  `https://www.linkedin.com/company/${encodeURIComponent(handle.toLowerCase())}/`;

/** Is this website the firm's own: the same registrable domain? */
export function firmSite(website: string | null | undefined, domain: string | null): boolean {
  if (!website || !domain) return false;
  const site = extractDomain(website);
  const own = extractDomain(domain);
  return !!site && !!own && registrableDomain(site) === registrableDomain(own);
}

/** A page's facts as one finding, its full text as the source. */
function profileFinding(s: ProfileSubject, page: CompanyPage, url: string): CompanyFindingDraft {
  const handle = linkedinCompany(url) ?? page.handle;
  return {
    kind: "profile",
    companyId: s.companyId,
    factKey: `c${s.companyId}:profile:${CACHE_VIA}:${handle.toLowerCase()}`.slice(0, 400),
    value: {
      name: page.name,
      industry: page.industry ?? null,
      location: page.headquarters ?? null,
      description: page.about ?? null,
      employees: page.employees ?? page.size ?? null,
      founded: page.founded ?? null,
      homepage: page.website ?? null,
      phone: page.phone ?? null,
    },
    confidence: SURE_PAGE,
    via: CACHE_VIA,
    sourceUrl: url,
    document: pageDocument(page, url),
  };
}

const pageDocument = (page: CompanyPage, url: string): DocumentDraft => ({
  url,
  kind: "profile",
  title: page.name,
  text: page.text || JSON.stringify(page),
  fetchTier: CACHE_VIA,
});

/**
 * One company page from the cache: the page, or null when the cache has no
 * copy or refused (the trail says which). A cap and a failed read are thrown.
 */
export async function readCompanyPage(
  call: ReturnType<typeof paced>,
  url: string,
  tried: { what: string; outcome: string }[],
): Promise<CompanyPage | null> {
  try {
    return await call<CompanyPage>("web", "GET", "/linkedin/company", { url });
  } catch (err) {
    const refused = refusedBy(err);
    if (refused === null) throw err;
    tried.push({ what: url, outcome: refused === 404 ? "no cached copy" : `refused: ${refused}` });
    return null;
  }
}

export async function lookUpCompany(
  sites: SiteClient,
  s: ProfileSubject,
  opts: ProfileOptions = {},
): Promise<ProfileResult> {
  const clock = opts.now ?? (() => new Date());
  const call = paced(sites, clock, opts.sleep ?? realSleep);
  const tried: ProfileTried[] = [];
  const pages: DocumentDraft[] = [];
  let googleStopped: Stopped | null = null;
  const done = (
    state: LookupState,
    hit: { url: string; finding: CompanyFindingDraft } | null = null,
    capped: Capped | null = null,
  ): ProfileResult => ({
    state,
    url: hit?.url ?? null,
    finding: hit?.finding ?? null,
    pages,
    tried,
    retryAt: capped?.retryAt ?? null,
    cappedBy: capped?.site ?? null,
    googleStopped,
  });

  const { name, domain } = s.firm;
  if (!domain) {
    tried.push({ step: "page", what: "-", outcome: "no domain to tie a page to the firm" });
    return done("unresolved");
  }

  const read = new Set<string>();
  /** Read one candidate; the hit when its website is the firm's. */
  const check = async (link: string, from: string) => {
    const handle = linkedinCompany(link);
    if (!handle || read.has(handle.toLowerCase()) || read.size >= MAX_PAGE_READS) return null;
    read.add(handle.toLowerCase());
    const url = companyPageUrl(handle);
    const trail: { what: string; outcome: string }[] = [];
    const page = await readCompanyPage(call, url, trail);
    for (const t of trail)
      tried.push({ step: "page", what: `${t.what} (${from})`, outcome: t.outcome });
    if (!page) return null;
    pages.push(pageDocument(page, url));
    const ours = firmSite(page.website, domain);
    tried.push({
      step: "page",
      what: `${url} (${from})`,
      outcome: ours
        ? `website ${page.website}: the firm's`
        : `website ${page.website ?? "none"}: not the firm's`,
    });
    return ours ? { url, finding: profileFinding(s, page, url) } : null;
  };

  try {
    const held: [string | null | undefined, string][] = [
      [s.linkedinUrl, "held"],
      [s.personCompanyUrl, "their people's profiles"],
      ...(s.pageLinks ?? []).map((u): [string, string] => [u, "the firm's page"]),
    ];
    for (const [link, from] of held) {
      const hit = link ? await check(link, from) : null;
      if (hit) return done("matched", hit);
    }

    if (opts.google && name) {
      const q = `site:linkedin.com/company "${bareCompanyName(name)}"`;
      let res: Serp | null = null;
      try {
        res = await call<Serp>("web", "GET", "/google", { q, n: GOOGLE_RESULTS });
      } catch (err) {
        const refused = refusedBy(err);
        googleStopped = searchStopped(err, "web");
        if (!googleStopped && refused === null) throw err;
        tried.push({
          step: "google",
          what: q,
          outcome: googleStopped ? `stopped: ${googleStopped.why}` : `refused: ${refused}`,
        });
      }
      if (res) {
        // Titles read "Acme Staffing | LinkedIn": the name must be the firm's.
        const named = (res.results ?? []).filter(
          (h) =>
            linkedinCompany(h.url) &&
            isFirm(h.title.replace(/\s*[|–-]\s*LinkedIn.*$/i, ""), s.firm),
        );
        tried.push({
          step: "google",
          what: q,
          outcome: `${res.results?.length ?? 0} results, ${named.length} by name`,
        });
        for (const h of named) {
          const hit = await check(h.url, "google");
          if (hit) return done("matched", hit);
        }
      }
    }

    let found: Companies;
    try {
      found = await call<Companies>("web", "GET", "/companies", { domain, n: COMPANY_SEARCH });
    } catch (err) {
      const refused = refusedBy(err);
      if (refused === null) throw err;
      tried.push({ step: "companies", what: domain, outcome: `refused: ${refused}` });
      return done("unresolved");
    }
    const matching = (found.companies ?? []).filter((c) => c.homepageMatches && c.linkedin);
    tried.push({
      step: "companies",
      what: domain,
      outcome: `${found.companies?.length ?? 0} companies, ${matching.length} with the firm's homepage`,
    });
    for (const c of matching) {
      const hit = await check(c.linkedin as string, "company search");
      if (hit) return done("matched", hit);
    }
    return done("unresolved");
  } catch (err) {
    if (!(err instanceof Capped)) throw err;
    tried.push({ step: "capped", what: err.why, outcome: `retry at ${err.retryAt.toISOString()}` });
    return done("capped", null, err);
  }
}

/**
 * Writes a company lookup: every page read and the finding's source into
 * `documents`, the finding, the firm's page on the company, and where the
 * lookup stands. Every write is an upsert, so re-running a company is safe.
 */
export async function recordCompanyLookup(
  db: Queryable,
  companyId: number,
  r: ProfileResult,
  runId: string | null = null,
): Promise<void> {
  for (const page of r.pages) await keepDocument(db, page);
  if (r.finding) await keepFinding(db, r.finding);
  if (r.url)
    await db.update(companies).set({ linkedinUrl: r.url }).where(eq(companies.id, companyId));
  const state = { state: r.state, tried: noNul(r.tried), retryAt: r.retryAt, runId };
  await db
    .insert(companyLookups)
    .values({ companyId, ...state })
    .onConflictDoUpdate({
      target: companyLookups.companyId,
      set: { ...state, lookedUpAt: sql`now()` },
    });
}
