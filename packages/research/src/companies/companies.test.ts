/**
 * Company hiring checks (R8): boards named on the firm's own site, read
 * through their public APIs; LinkedIn only when allowed and needed; nothing
 * guessed. Canned pages and a fake SiteClient, no network.
 */
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { FetchError, type Fetcher, type FetchResponse } from "../fetch/fetcher.js";
import { findBoards, readBoard } from "./boards.js";
import { type CompanySubject, checkHiring, linkedinCompany } from "./hiring.js";

/** Pages by url; a missing page is a 404, a thrown one is a dead host. */
function fetcher(pages: Record<string, string | Partial<FetchResponse> | Error>): Fetcher & {
  asked: string[];
} {
  const asked: string[] = [];
  return {
    userAgent: "test",
    asked,
    async get(url) {
      asked.push(url);
      const p = pages[url];
      if (p instanceof Error) throw p;
      if (p === undefined) return { status: 404, url, text: "" };
      if (typeof p === "string") return { status: 200, url, text: p };
      return { status: 200, url, text: "", ...p };
    },
  };
}

type Handler = (path: string, input: Record<string, unknown>, account?: string) => unknown;
function sites(handlers: Record<string, Handler>): SiteClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async call(site, method, path, input = {}, account) {
      calls.push(`${site} ${path}`);
      const h = handlers[site];
      if (!h) throw new SiteCallError(site, method, path, 404, "no such site");
      return h(path, input as Record<string, unknown>, account) as never;
    },
    async via() {
      return "api";
    },
  };
}
const noSites = sites({});

const acme: CompanySubject = {
  companyId: 7,
  firm: { name: "Acme Staffing", domain: "acmestaffing.com" },
  linkedinPage: null,
};

const GREENHOUSE_JOBS = JSON.stringify({
  jobs: [
    {
      title: "Recruiter",
      absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1",
      location: { name: "Toronto" },
      first_published: "2026-09-01T10:00:00Z",
    },
    {
      title: "Account Manager",
      absolute_url: "https://job-boards.greenhouse.io/acme/jobs/2",
      location: { name: "Remote" },
      first_published: "2026-09-20T10:00:00Z",
    },
  ],
  meta: { total: 2 },
});

describe("findBoards", () => {
  it("finds each ATS's board token, once, in page order", () => {
    const html = `
      <a href="https://jobs.lever.co/acme">jobs</a>
      <script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>
      <a href="https://jobs.lever.co/acme/123">again</a>`;
    expect(findBoards(html).map((b) => `${b.ats}:${b.token}`)).toEqual([
      "lever:acme",
      "greenhouse:acme",
    ]);
  });

  it("skips the ATS's own pages", () => {
    expect(findBoards("https://www.workable.com/ https://api.lever.co/v0/")).toEqual([]);
    expect(findBoards("https://apply.workable.com/api/v1/")).toEqual([]);
  });

  it("builds the public API url", () => {
    const [b] = findBoards("https://jobs.ashbyhq.com/Acme%20Staffing");
    expect(b?.api).toBe("https://api.ashbyhq.com/posting-api/job-board/Acme%20Staffing");
  });
});

describe("readBoard", () => {
  const [board] = findBoards("https://boards.greenhouse.io/acme");
  if (!board) throw new Error("no board");

  it("reads the postings", async () => {
    const r = await readBoard(fetcher({ [board.api]: GREENHOUSE_JOBS }), board);
    expect(r).toMatchObject({ ok: true, total: 2 });
    if (r.ok) expect(r.jobs[1]).toMatchObject({ title: "Account Manager", postedAt: "2026-09-20" });
  });

  it("says why a board can't be read, never throws for it", async () => {
    expect(await readBoard(fetcher({}), board)).toEqual({ ok: false, why: "HTTP 404" });
    expect(await readBoard(fetcher({ [board.api]: "<html>" }), board)).toEqual({
      ok: false,
      why: "not JSON",
    });
    expect(await readBoard(fetcher({ [board.api]: '{"jobs": 3}' }), board)).toEqual({
      ok: false,
      why: "not the board's shape",
    });
  });
});

describe("linkedinCompany", () => {
  it("reads the handle from a company url, nothing else", () => {
    expect(linkedinCompany("https://www.linkedin.com/company/acme-staffing/about/")).toBe(
      "acme-staffing",
    );
    expect(linkedinCompany("https://ca.linkedin.com/company/12345")).toBe("12345");
    expect(linkedinCompany("https://www.linkedin.com/in/jane")).toBeNull();
    expect(linkedinCompany(null)).toBeNull();
  });
});

describe("checkHiring: the firm's own site", () => {
  it("careers page names a board: the board's roles, newest first", async () => {
    const f = fetcher({
      "https://acmestaffing.com/careers": `<iframe src="https://boards.greenhouse.io/embed/job_board?for=acme">`,
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs": GREENHOUSE_JOBS,
    });
    const r = await checkHiring({ fetcher: f, sites: noSites }, acme, { linkedin: "research" });
    expect(r.state).toBe("hiring");
    expect(r.finding).toMatchObject({
      kind: "hiring",
      companyId: 7,
      via: "greenhouse",
      confidence: 0.95,
      sourceUrl: "https://job-boards.greenhouse.io/acme",
      value: { count: 2, roles: [{ title: "Account Manager" }, { title: "Recruiter" }] },
    });
    expect(r.finding?.document?.text).toBe(
      "Account Manager | Remote | 2026-09-20\nRecruiter | Toronto | 2026-09-01",
    );
    expect(noSites.calls).toEqual([]);
  });

  it("a board with no roles: no openings, LinkedIn never asked", async () => {
    const s = sites({});
    const f = fetcher({
      "https://acmestaffing.com/careers": "https://jobs.lever.co/acme",
      "https://api.lever.co/v0/postings/acme?mode=json": "[]",
    });
    const r = await checkHiring({ fetcher: f, sites: s }, acme, { linkedin: "research" });
    expect(r.state).toBe("no_openings");
    expect(r.finding).toBeNull();
    expect(s.calls).toEqual([]);
  });

  it("follows the home page's careers link on the firm's own site", async () => {
    const f = fetcher({
      "https://acmestaffing.com/": `<a href="/work-with-us">Join us</a><a href="https://other.com/careers">x</a>`,
      "https://acmestaffing.com/work-with-us": "https://jobs.lever.co/acme",
      "https://api.lever.co/v0/postings/acme?mode=json": JSON.stringify([
        {
          text: "Recruiter",
          hostedUrl: "https://jobs.lever.co/acme/1",
          createdAt: 1_758_000_000_000,
        },
      ]),
    });
    const r = await checkHiring({ fetcher: f, sites: noSites }, acme, { linkedin: null });
    expect(r.state).toBe("hiring");
    expect(f.asked).not.toContain("https://other.com/careers");
  });

  it("several boards, none the firm's: no guess", async () => {
    const f = fetcher({
      "https://acmestaffing.com/careers":
        "https://jobs.lever.co/clientone https://jobs.lever.co/clienttwo",
    });
    const r = await checkHiring({ fetcher: f, sites: noSites }, acme, { linkedin: null });
    expect(r.state).toBe("unresolved");
    expect(r.tried[0]?.outcome).toBe("2 boards, none clearly the firm's");
  });

  it("several boards, one the firm's: that one", async () => {
    const f = fetcher({
      "https://acmestaffing.com/careers":
        "https://jobs.lever.co/clientone https://jobs.lever.co/acme-staffing",
      "https://api.lever.co/v0/postings/acme-staffing?mode=json": "[]",
    });
    const r = await checkHiring({ fetcher: f, sites: noSites }, acme, { linkedin: null });
    expect(r.state).toBe("no_openings");
  });

  it("a careers path that redirects to another company's site is not the firm's", async () => {
    const f = fetcher({
      "https://acmestaffing.com/careers": {
        url: "https://newowner.com/careers",
        text: "https://jobs.lever.co/newowner",
      },
    });
    const r = await checkHiring({ fetcher: f, sites: noSites }, acme, { linkedin: null });
    expect(r.state).toBe("unresolved");
    expect(f.asked).not.toContain("https://api.lever.co/v0/postings/newowner?mode=json");
  });

  it("a dead host is asked once", async () => {
    const f = fetcher({ "https://acmestaffing.com/careers": new FetchError("ENOTFOUND") });
    const r = await checkHiring({ fetcher: f, sites: noSites }, acme, { linkedin: null });
    expect(r.state).toBe("unresolved");
    expect(f.asked).toEqual(["https://acmestaffing.com/careers"]);
  });
});

describe("checkHiring: LinkedIn", () => {
  const jobs = { jobs: [{ title: "Recruiter", postedAt: "2026-09-25" }] };

  it("a known page: its jobs, with the account", async () => {
    const s = sites({
      linkedin: (path, input, account) => {
        expect(path).toBe("/company/acme-staffing/jobs");
        expect(input).toEqual({ max: 50 });
        expect(account).toBe("research");
        return jobs;
      },
    });
    const r = await checkHiring(
      { fetcher: null, sites: s },
      { ...acme, linkedinPage: "acme-staffing" },
      { linkedin: "research" },
    );
    expect(r.state).toBe("hiring");
    expect(r.finding).toMatchObject({
      via: "linkedin@research",
      confidence: 0.85,
      sourceUrl: "https://www.linkedin.com/company/acme-staffing/jobs/",
    });
  });

  it("a page found by search counts only when its website is the firm's", async () => {
    const s = sites({
      web: () => ({
        hits: [
          {
            title: "Acme Staffing | LinkedIn",
            url: "https://www.linkedin.com/company/acme-uk",
            snippet: null,
          },
          {
            title: "Acme Staffing - LinkedIn",
            url: "https://www.linkedin.com/company/acme-staffing",
            snippet: null,
          },
        ],
      }),
      linkedin: (path) => {
        if (path === "/company/acme-uk")
          return { name: "Acme Staffing", website: "https://acme.co.uk" };
        if (path === "/company/acme-staffing")
          return { name: "Acme Staffing", website: "acmestaffing.com" };
        if (path === "/company/acme-staffing/jobs") return { jobs: [] };
        throw new Error(`unexpected ${path}`);
      },
    });
    const r = await checkHiring({ fetcher: null, sites: s }, acme, { linkedin: "research" });
    expect(r.state).toBe("no_openings");
    expect(s.calls).toContain("linkedin /company/acme-staffing/jobs");
  });

  it("no account: unresolved, nothing asked", async () => {
    const s = sites({});
    const r = await checkHiring({ fetcher: null, sites: s }, acme, { linkedin: null });
    expect(r.state).toBe("unresolved");
    expect(s.calls).toEqual([]);
  });

  it("a daily cap parks the company until the cap lifts", async () => {
    const now = new Date("2026-09-29T12:00:00Z");
    const s = sites({
      linkedin: () => {
        throw new SiteCallError("linkedin", "GET", "/company/x/jobs", 429, "retry after 43200s");
      },
    });
    const r = await checkHiring(
      { fetcher: null, sites: s },
      { ...acme, linkedinPage: "x" },
      { linkedin: "research", now: () => now },
    );
    expect(r).toMatchObject({ state: "capped", cappedBy: "linkedin" });
    expect(r.retryAt?.toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("a cap from earlier in the run parks without asking", async () => {
    const s = sites({});
    const until = new Date(Date.now() + 3_600_000);
    const r = await checkHiring(
      { fetcher: null, sites: s },
      { ...acme, linkedinPage: "x" },
      { linkedin: "research", linkedinCappedUntil: until },
    );
    expect(r).toMatchObject({ state: "capped", retryAt: until });
    expect(s.calls).toEqual([]);
  });

  it("a refused page read is unresolved, not an error", async () => {
    const s = sites({
      linkedin: () => {
        throw new SiteCallError("linkedin", "GET", "/company/x/jobs", 404, "not found");
      },
    });
    const r = await checkHiring(
      { fetcher: null, sites: s },
      { ...acme, linkedinPage: "x" },
      { linkedin: "research" },
    );
    expect(r.state).toBe("unresolved");
  });
});
