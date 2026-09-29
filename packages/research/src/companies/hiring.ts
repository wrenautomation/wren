/**
 * Is this company hiring (R8)? Layered, exact and free first:
 *
 * 1. The company's own site: its careers page (or the page its home page
 *    links as careers) names a job board. That board's public API lists the
 *    open roles. A board found on the firm's own site is the firm's.
 * 2. LinkedIn, only when the client allows it and step 1 found no board: the
 *    company's page (tied to the firm by a matched profile, or by a search
 *    hit whose About page names the firm's own website), then its jobs.
 *
 * No board and no LinkedIn = unresolved, never a guess. Pure over a Fetcher
 * and a SiteClient: it returns the finding and the trail, `store.ts` writes.
 */
import type { SiteClient } from "@wren/core/content";
import { FetchError, type Fetcher } from "../fetch/fetcher.js";
import { readPage } from "../fetch/htmltext.js";
import type { CompanyFindingDraft } from "../findings.js";
import { Capped, paced, realSleep, refusedBy } from "../pacing.js";
import { type Firm, isFirm, sameCompany } from "../people/names.js";
import type { CompanyCheckState } from "../schema.js";
import { type Board, findBoards, type Job, readBoard } from "./boards.js";

export interface CompanySubject {
  companyId: number;
  firm: Firm;
  /** The firm's LinkedIn page (handle or id), when a trusted read already tied it to the firm. */
  linkedinPage: string | null;
}

export interface HiringDeps {
  /** For the firm's own pages and the boards' APIs; null = skip step 1. */
  fetcher: Fetcher | null;
  sites: SiteClient;
}

export interface HiringOptions {
  /** The account for LinkedIn reads; null = never log in. */
  linkedin: string | null;
  /** A cap an earlier company in this run hit: park instead of asking again. */
  linkedinCappedUntil?: Date | null;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface CheckTried {
  step: "careers" | "board" | "linkedin page" | "linkedin jobs" | "capped";
  what: string;
  outcome: string;
}

export interface HiringResult {
  state: CompanyCheckState;
  finding: CompanyFindingDraft | null;
  tried: CheckTried[];
  retryAt: Date | null;
  /** The site whose cap parked this company; null unless capped. */
  cappedBy: string | null;
}

/** How sure a reading is that the roles are open today. */
const SURE = { board: 0.95, linkedin: 0.85 } as const;
/** Roles kept in the finding's value; the document keeps every one. */
const ROLES_KEPT = 10;
const LINKEDIN_JOBS_MAX = 50;
/** Search hits whose About page is read to tie a LinkedIn page to the firm. */
const PAGE_CANDIDATES = 2;
/** Paths tried on the firm's site before its home page. */
const CAREERS_PATHS = ["/careers", "/jobs"];
/** A home page link to one of these is its careers page. */
const CAREERS_LINK =
  /\b(careers?|jobs|join[- ]us|work[- ](?:with|for)[- ]us|open[- ]positions|opportunities|hiring)\b/i;

interface CompanyPage {
  name?: string;
  website?: string | null;
}
interface LinkedinJobs {
  jobs: { title: string; url?: string; location?: string; postedAt?: string }[];
}
interface Hits {
  hits: { title: string; url: string; snippet: string | null }[];
}

/** A url's host without www; a bare "acme.com" (as About pages write it) counts. */
const host = (url: string): string | null => {
  if (!url.trim()) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
};

/** Is this host the firm's domain, or under it? */
const onDomain = (h: string | null, domain: string): boolean => {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return !!h && (h === d || h.endsWith(`.${d}`));
};

/** A url without its query: a board named only in `?return=` is not where we landed. */
const hostAndPath = (u: string): string => {
  try {
    const x = new URL(u);
    return `${x.host}${x.pathname}`;
  } catch {
    return "";
  }
};

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

/**
 * Several boards on one page (a portfolio page, a partner list): keep the one
 * whose token is the firm's name, else none. One board on the firm's own site
 * is the firm's.
 */
function pick(boards: Board[], firm: Firm): Board | null {
  if (boards.length <= 1) return boards[0] ?? null;
  const own = boards.filter((b) => {
    const words = decodeURIComponent(b.token).replace(/[-_.]+/g, " ");
    return isFirm(words, firm) || (!!firm.name && sameCompany(words, firm.name));
  });
  return own.length === 1 ? (own[0] ?? null) : null;
}

const newestFirst = (a: Job, b: Job) => (b.postedAt ?? "").localeCompare(a.postedAt ?? "");

function hiringFinding(
  s: CompanySubject,
  source: string,
  via: string,
  page: string,
  jobs: Job[],
  total: number,
  confidence: number,
): CompanyFindingDraft {
  const roles = [...jobs].sort(newestFirst);
  const firm = s.firm.name ?? s.firm.domain ?? "";
  return {
    kind: "hiring",
    companyId: s.companyId,
    factKey: `c${s.companyId}:hiring:${via}:${page}`.slice(0, 400),
    value: {
      count: total,
      roles: roles.slice(0, ROLES_KEPT),
      board: page,
      source,
    },
    confidence,
    via,
    sourceUrl: page,
    document: {
      url: page,
      kind: "webpage",
      title: `${firm} open roles`,
      text: roles
        .map((j) => [j.title, j.location, j.postedAt].filter(Boolean).join(" | "))
        .join("\n"),
      fetchTier: source,
    },
  };
}

export async function checkHiring(
  deps: HiringDeps,
  s: CompanySubject,
  opts: HiringOptions,
): Promise<HiringResult> {
  const clock = opts.now ?? (() => new Date());
  const call = paced(deps.sites, clock, opts.sleep ?? realSleep);
  const tried: CheckTried[] = [];
  const done = (
    state: CompanyCheckState,
    finding: CompanyFindingDraft | null = null,
    capped: Capped | null = null,
  ): HiringResult => ({
    state,
    finding,
    tried,
    retryAt: capped?.retryAt ?? null,
    cappedBy: capped?.site ?? null,
  });

  // Step 1: a board on the firm's own site.
  const board = deps.fetcher && s.firm.domain ? await boardOnSite(deps.fetcher, s, tried) : null;
  if (board && deps.fetcher) {
    const read = await readBoard(deps.fetcher, board);
    tried.push({
      step: "board",
      what: board.api,
      outcome: read.ok ? `${read.total} open roles` : `unreadable: ${read.why}`,
    });
    if (read.ok)
      return read.total > 0
        ? done(
            "hiring",
            hiringFinding(s, board.ats, board.ats, board.page, read.jobs, read.total, SURE.board),
          )
        : done("no_openings");
  }

  // Step 2: LinkedIn.
  const account = opts.linkedin;
  if (!account) {
    tried.push({
      step: "linkedin page",
      what: "-",
      outcome: "no LinkedIn account for this client",
    });
    return done("unresolved");
  }
  try {
    const until = opts.linkedinCappedUntil;
    if (until && until > clock())
      throw new Capped("linkedin", until, "linkedin cap hit earlier this run");
    const page = s.linkedinPage ?? (await findPage(call, s, account, tried));
    if (!page) return done("unresolved");
    let res: LinkedinJobs;
    try {
      res = await call<LinkedinJobs>(
        "linkedin",
        "GET",
        `/company/${encodeURIComponent(page)}/jobs`,
        { max: LINKEDIN_JOBS_MAX },
        account,
      );
    } catch (err) {
      const status = refusedBy(err);
      if (status === null) throw err;
      tried.push({ step: "linkedin jobs", what: page, outcome: `refused: ${status}` });
      return done("unresolved");
    }
    const jobs = (res.jobs ?? []).map((j) => ({
      title: j.title,
      location: j.location ?? null,
      url: j.url ?? null,
      postedAt: j.postedAt ?? null,
    }));
    tried.push({ step: "linkedin jobs", what: page, outcome: `${jobs.length} open roles` });
    if (!jobs.length) return done("no_openings");
    const url = `https://www.linkedin.com/company/${encodeURIComponent(page)}/jobs/`;
    const via = `linkedin@${account}`;
    return done("hiring", hiringFinding(s, "linkedin", via, url, jobs, jobs.length, SURE.linkedin));
  } catch (err) {
    if (!(err instanceof Capped)) throw err;
    tried.push({ step: "capped", what: err.why, outcome: `retry at ${err.retryAt.toISOString()}` });
    return done("capped", null, err);
  }
}

/**
 * The board the firm's own site names: its careers paths first, then its home
 * page, then the one page the home page links as careers. A host that doesn't
 * answer is not asked again.
 */
async function boardOnSite(
  fetcher: Fetcher,
  s: CompanySubject,
  tried: CheckTried[],
): Promise<Board | null> {
  const domain = (s.firm.domain ?? "").toLowerCase().replace(/^www\./, "");
  const pages = [...CAREERS_PATHS.map((p) => `https://${domain}${p}`), `https://${domain}/`];
  const seen = new Set<string>();
  for (let i = 0; i < pages.length; i++) {
    const url = pages[i] as string;
    if (seen.has(url)) continue;
    seen.add(url);
    let res: Awaited<ReturnType<Fetcher["get"]>>;
    try {
      res = await fetcher.get(url);
    } catch (err) {
      if (!(err instanceof FetchError)) throw err;
      tried.push({ step: "careers", what: url, outcome: `unreachable: ${err.message}` });
      return null;
    }
    if (res.status >= 400) {
      tried.push({ step: "careers", what: url, outcome: `HTTP ${res.status}` });
      continue;
    }
    // A careers path that redirects to a board says so in its final url. One
    // that leaves for another site (a new owner, a rebrand) is not the firm's.
    const final = host(res.url);
    if (!onDomain(final, domain) && !findBoards(hostAndPath(res.url)).length) {
      tried.push({ step: "careers", what: url, outcome: `leaves the site for ${final ?? "?"}` });
      continue;
    }
    const boards = findBoards(`${res.url}\n${res.text}`);
    const board = pick(boards, s.firm);
    tried.push({
      step: "careers",
      what: url,
      outcome: board
        ? `${board.ats} board ${board.token}`
        : boards.length
          ? `${boards.length} boards, none clearly the firm's`
          : "no board named",
    });
    if (board) return board;
    if (boards.length) return null;
    // The home page's own careers link, on the firm's site, gets one look.
    if (url === `https://${domain}/` && onDomain(host(res.url), domain)) {
      const link = readPage(res.text, res.url).links.find(
        (l) =>
          onDomain(host(l.url), domain) &&
          (CAREERS_LINK.test(l.anchor) || CAREERS_LINK.test(new URL(l.url).pathname)),
      );
      if (link && !seen.has(link.url)) pages.push(link.url);
    }
  }
  return null;
}

/**
 * The firm's LinkedIn page from a web search, tied to the firm only when its
 * About page names the firm's own website. A same-named firm elsewhere never
 * counts.
 */
async function findPage(
  call: ReturnType<typeof paced>,
  s: CompanySubject,
  account: string,
  tried: CheckTried[],
): Promise<string | null> {
  const { name, domain } = s.firm;
  if (!name || !domain) {
    tried.push({
      step: "linkedin page",
      what: "-",
      outcome: "no name and domain to tie a page to the firm",
    });
    return null;
  }
  const q = `"${name}" site:linkedin.com/company`;
  const res = await call<Hits>("web", "GET", "/search", { q, n: 5 });
  const candidates = [
    ...new Set(
      (res.hits ?? [])
        .filter((h) => isFirm(h.title.replace(/\s*[|–-]\s*LinkedIn.*$/i, ""), s.firm))
        .map((h) => linkedinCompany(h.url))
        .filter((h): h is string => !!h),
    ),
  ].slice(0, PAGE_CANDIDATES);
  tried.push({ step: "linkedin page", what: q, outcome: `${candidates.length} pages by name` });
  for (const c of candidates) {
    let about: CompanyPage;
    try {
      about = await call<CompanyPage>(
        "linkedin",
        "GET",
        `/company/${encodeURIComponent(c)}`,
        {},
        account,
      );
    } catch (err) {
      const status = refusedBy(err);
      if (status === null) throw err;
      tried.push({ step: "linkedin page", what: c, outcome: `refused: ${status}` });
      continue;
    }
    const site = host(about.website ?? "");
    const ours = onDomain(site, domain);
    tried.push({
      step: "linkedin page",
      what: c,
      outcome: ours ? `website ${site}: the firm's` : `website ${site ?? "none"}: not the firm's`,
    });
    if (ours) return c;
  }
  return null;
}
