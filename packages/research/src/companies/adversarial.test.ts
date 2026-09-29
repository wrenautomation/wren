/**
 * Adversarial tests for company hiring checks: ATS token parsing, off-site
 * redirects, board API shapes and dates, the LinkedIn fallback. Each test says
 * what SHOULD happen per the doc comments; failing ones are marked BUG.
 */
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { FetchError, type Fetcher, type FetchResponse } from "../fetch/fetcher.js";
import { findBoards, readBoard } from "./boards.js";
import { type CompanySubject, checkHiring, linkedinCompany } from "./hiring.js";

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

const acme: CompanySubject = {
  companyId: 7,
  firm: { name: "Acme Staffing", domain: "acmestaffing.com" },
  linkedinPage: null,
};
const tokens = (text: string) => findBoards(text).map((b) => `${b.ats}:${b.token}`);
const LEVER_ONE = JSON.stringify([
  { text: "Recruiter", hostedUrl: "https://jobs.lever.co/acme/1" },
]);

describe("findBoards: token parsing", () => {
  it("query strings, fragments, trailing slashes and sentence dots don't leak into the token", () => {
    expect(tokens("see https://jobs.lever.co/acme?lever-source=site#top")).toEqual(["lever:acme"]);
    expect(tokens("https://jobs.lever.co/acme/.")).toEqual(["lever:acme"]);
    expect(tokens("Apply at https://jobs.lever.co/acme.")).toEqual(["lever:acme"]);
    expect(tokens("https://jobs.ashbyhq.com/acme/?utm_source=x")).toEqual(["ashby:acme"]);
    expect(tokens("https://boards.greenhouse.io/acme/jobs/123?gh_jid=123")).toEqual([
      "greenhouse:acme",
    ]);
    expect(tokens("https://apply.workable.com/acme/j/ABC123/")).toEqual(["workable:acme"]);
  });

  it("the same board in two cases is one board", () => {
    expect(tokens("https://jobs.lever.co/Acme https://JOBS.LEVER.CO/acme")).toEqual(["lever:Acme"]);
  });

  it("greenhouse embeds, with other params first and HTML-escaped ampersands", () => {
    expect(
      tokens(`<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>`),
    ).toEqual(["greenhouse:acme"]);
    expect(
      tokens(`src="https://boards.greenhouse.io/embed/job_app?token=123&amp;for=acme"`),
    ).toEqual(["greenhouse:acme"]);
    expect(tokens(`src="https://job-boards.greenhouse.io/embed/job_board?b=x&for=acme"`)).toEqual([
      "greenhouse:acme",
    ]);
  });

  it("the ATSs' own marketing and app hosts are never a company's board", () => {
    const marketing = [
      "https://www.greenhouse.io/",
      "https://www.lever.co/job-seeker-support/",
      "https://www.ashbyhq.com/",
      "https://www.workable.com/?utm_source=careers",
      "https://resources.workable.com/tutorial",
      "https://help.workable.com/",
      "https://jobs.workable.com/view/abc",
      "https://www.smartrecruiters.com/",
      "https://www.recruitee.com/",
      "https://blog.recruitee.com/",
      "https://app.recruitee.com/",
      "https://www.bamboohr.com/applicant-tracking-system/",
      "https://marketplace.bamboohr.com/",
      "https://api.lever.co/v0/postings/x",
      "https://jobs.ashbyhq.com/api/non-user-graphql",
    ].join(" ");
    expect(findBoards(marketing)).toEqual([]);
  });

  // BUG: SmartRecruiters one-click apply links (jobs.smartrecruiters.com/oneclick-ui/company/<id>/...) read as a board named "oneclick-ui".
  it("a SmartRecruiters one-click apply link is not a board called oneclick-ui", () => {
    const t = tokens(
      `<a href="https://jobs.smartrecruiters.com/oneclick-ui/company/AcmeStaffing/publication/0b1c?dcr_ci=AcmeStaffing">Apply</a>`,
    );
    expect(t).not.toContain("smartrecruiters:oneclick-ui");
  });

  // BUG: an EU Greenhouse board is recognised, then its page and API are built on the US hosts.
  it("an EU greenhouse board keeps its EU page and API", () => {
    const [b] = findBoards("https://job-boards.eu.greenhouse.io/acme");
    expect(b?.page).toBe("https://job-boards.eu.greenhouse.io/acme");
    expect(b?.api).toBe("https://boards-api.eu.greenhouse.io/v1/boards/acme/jobs");
  });

  // BUG: a board named only in a JSON-escaped script (https:\/\/jobs.lever.co\/acme, as SPAs ship it) is missed.
  it("a board named inside JSON with escaped slashes is found", () => {
    expect(
      tokens(`<script id="__NEXT_DATA__">{"careers":"https:\\/\\/jobs.lever.co\\/acme"}</script>`),
    ).toEqual(["lever:acme"]);
  });

  it("an undecodable token is skipped, never thrown on", () => {
    expect(() => findBoards("https://jobs.ashbyhq.com/acme%E0%A4%A")).not.toThrow();
  });
});

describe("readBoard: shapes and dates", () => {
  const [gh] = findBoards("https://boards.greenhouse.io/acme");
  if (!gh) throw new Error("no board");

  // BUG: day() converts to UTC, so a role Greenhouse stamps 21:00 EDT on Sep 1 is stored as posted Sep 2.
  it("posted day is the day the board says, not the UTC day", async () => {
    const r = await readBoard(
      fetcher({
        [gh.api]: JSON.stringify({
          jobs: [{ title: "Recruiter", first_published: "2026-09-01T21:00:00-04:00" }],
        }),
      }),
      gh,
    );
    expect(r.ok && r.jobs[0]?.postedAt).toBe("2026-09-01");
  });

  it("a garbage date is null, not a crash", async () => {
    const r = await readBoard(
      fetcher({
        [gh.api]: JSON.stringify({ jobs: [{ title: "Recruiter", first_published: "soon" }] }),
      }),
      gh,
    );
    expect(r).toMatchObject({ ok: true, total: 1, jobs: [{ postedAt: null }] });
  });

  it("ashby unlisted roles don't count", async () => {
    const [b] = findBoards("https://jobs.ashbyhq.com/acme");
    if (!b) throw new Error("no board");
    const r = await readBoard(
      fetcher({
        [b.api]: JSON.stringify({
          jobs: [
            { title: "Hidden", isListed: false },
            { title: "Open", isListed: true },
          ],
        }),
      }),
      b,
    );
    expect(r).toMatchObject({ ok: true, total: 1 });
  });

  it("a 200 with a JSON error body is not zero openings", async () => {
    const [b] = findBoards("https://jobs.lever.co/acme");
    if (!b) throw new Error("no board");
    const r = await readBoard(fetcher({ [b.api]: '{"ok":false,"error":"Document not found"}' }), b);
    expect(r.ok).toBe(false);
  });
});

describe("linkedinCompany", () => {
  // BUG: a scheme-less company url (as CRMs and About pages store it) yields null, so a known page is searched for again.
  it("reads a scheme-less linkedin company url", () => {
    expect(linkedinCompany("www.linkedin.com/company/acme-staffing")).toBe("acme-staffing");
    expect(linkedinCompany("linkedin.com/company/acme-staffing/")).toBe("acme-staffing");
  });

  it("ignores query strings and showcase/school pages", () => {
    expect(linkedinCompany("https://www.linkedin.com/company/acme?trk=x")).toBe("acme");
    expect(linkedinCompany("https://www.linkedin.com/showcase/acme")).toBeNull();
    expect(linkedinCompany("https://notlinkedin.com/company/acme")).toBeNull();
    expect(linkedinCompany("https://linkedin.com.evil.io/company/acme")).toBeNull();
  });
});

describe("checkHiring: off-site redirects", () => {
  // BUG: the redirect check looks for a board anywhere in the final url, so an off-site page whose query names a board counts.
  it("a careers path that leaves for another site stays not the firm's, even if its query names a board", async () => {
    const f = fetcher({
      "https://acmestaffing.com/careers": {
        url: "https://login.newowner.com/sso?return=https://jobs.lever.co/newowner",
        text: "",
      },
      "https://api.lever.co/v0/postings/newowner?mode=json": LEVER_ONE,
    });
    const r = await checkHiring({ fetcher: f, sites: sites({}) }, acme, { linkedin: null });
    expect(r.state).toBe("unresolved");
    expect(f.asked).not.toContain("https://api.lever.co/v0/postings/newowner?mode=json");
  });

  it("a careers path that redirects straight to a board is that board", async () => {
    const f = fetcher({
      "https://acmestaffing.com/careers": { url: "https://jobs.lever.co/acme", text: "Open roles" },
      "https://api.lever.co/v0/postings/acme?mode=json": LEVER_ONE,
    });
    const r = await checkHiring({ fetcher: f, sites: sites({}) }, acme, { linkedin: null });
    expect(r.state).toBe("hiring");
  });

  it("www and subdomains of the firm's domain are the firm's site", async () => {
    const f = fetcher({
      "https://acmestaffing.com/careers": {
        url: "https://www.acmestaffing.com/careers",
        text: "https://jobs.lever.co/acme",
      },
      "https://api.lever.co/v0/postings/acme?mode=json": LEVER_ONE,
    });
    const r = await checkHiring({ fetcher: f, sites: sites({}) }, acme, { linkedin: null });
    expect(r.state).toBe("hiring");
  });

  it("a lookalike domain is not the firm's site", async () => {
    const f = fetcher({
      "https://acmestaffing.com/careers": {
        url: "https://acmestaffing.com.evil.io/careers",
        text: "https://jobs.lever.co/evil",
      },
    });
    const r = await checkHiring({ fetcher: f, sites: sites({}) }, acme, { linkedin: null });
    expect(r.state).toBe("unresolved");
    expect(f.asked).not.toContain("https://api.lever.co/v0/postings/evil?mode=json");
  });

  it("the home page's off-site careers link is never followed", async () => {
    const f = fetcher({
      "https://acmestaffing.com/": `<a href="https://acmestaffing.com.evil.io/careers">Careers</a>`,
    });
    const r = await checkHiring({ fetcher: f, sites: sites({}) }, acme, { linkedin: null });
    expect(r.state).toBe("unresolved");
    expect(f.asked).not.toContain("https://acmestaffing.com.evil.io/careers");
  });

  it("an unreachable careers page does not crash on a javascript: link", async () => {
    const f = fetcher({
      "https://acmestaffing.com/": `<a href="javascript:void(0)">Careers</a><a href="mailto:jobs@acmestaffing.com">Jobs</a>`,
    });
    const r = await checkHiring({ fetcher: f, sites: sites({}) }, acme, { linkedin: null });
    expect(r.state).toBe("unresolved");
  });
});

describe("checkHiring: board choice", () => {
  it("several boards, two named like the firm: no guess", async () => {
    const f = fetcher({
      "https://acmestaffing.com/careers":
        "https://jobs.lever.co/acme https://jobs.lever.co/acme-staffing https://jobs.lever.co/other",
    });
    const r = await checkHiring({ fetcher: f, sites: sites({}) }, acme, { linkedin: null });
    expect(r.state).toBe("unresolved");
  });

  it("an unreadable board falls through to LinkedIn, and the trail says why", async () => {
    const f = fetcher({ "https://acmestaffing.com/careers": "https://jobs.lever.co/acme" });
    const s = sites({ linkedin: () => ({ jobs: [] }) });
    const r = await checkHiring(
      { fetcher: f, sites: s },
      { ...acme, linkedinPage: "acme-staffing" },
      { linkedin: "research" },
    );
    expect(r.state).toBe("no_openings");
    expect(r.tried.find((t) => t.step === "board")?.outcome).toBe("unreadable: HTTP 404");
  });

  it("a dead network on the board API throws (a stage error), not a silent unresolved", async () => {
    const f = fetcher({
      "https://acmestaffing.com/careers": "https://jobs.lever.co/acme",
      "https://api.lever.co/v0/postings/acme?mode=json": new FetchError("ECONNRESET"),
    });
    await expect(
      checkHiring({ fetcher: f, sites: sites({}) }, acme, { linkedin: null }),
    ).rejects.toThrow(/ECONNRESET/);
  });

  it("a firm with no domain skips its site; no name and no domain never searches", async () => {
    const s = sites({});
    const r = await checkHiring(
      { fetcher: fetcher({}), sites: s },
      { companyId: 1, firm: { name: null, domain: null }, linkedinPage: null },
      { linkedin: "research" },
    );
    expect(r.state).toBe("unresolved");
    expect(s.calls).toEqual([]);
  });
});

describe("checkHiring: LinkedIn search tie", () => {
  it("a same-named page whose website is a lookalike of the firm's is not the firm's", async () => {
    const s = sites({
      web: () => ({
        hits: [
          {
            title: "Acme Staffing | LinkedIn",
            url: "https://www.linkedin.com/company/acme-x",
            snippet: null,
          },
        ],
      }),
      linkedin: (path) => {
        if (path === "/company/acme-x") return { website: "https://acmestaffing.com.evil.io" };
        throw new Error(`unexpected ${path}`);
      },
    });
    const r = await checkHiring({ fetcher: null, sites: s }, acme, { linkedin: "research" });
    expect(r.state).toBe("unresolved");
    expect(s.calls).not.toContain("linkedin /company/acme-x/jobs");
  });

  it("a search cap parks the company as capped by web, with the cap's time", async () => {
    const now = new Date("2026-09-29T12:00:00Z");
    const s = sites({
      web: () => {
        throw new SiteCallError("web", "GET", "/search", 429, "retry after 7200s");
      },
    });
    const r = await checkHiring({ fetcher: null, sites: s }, acme, {
      linkedin: "research",
      now: () => now,
    });
    expect(r).toMatchObject({ state: "capped", cappedBy: "web" });
    expect(r.retryAt?.toISOString()).toBe("2026-09-29T14:00:00.000Z");
  });

  it("an expired cap from earlier in the run doesn't park", async () => {
    const s = sites({ linkedin: () => ({ jobs: [{ title: "Recruiter" }] }) });
    const r = await checkHiring(
      { fetcher: null, sites: s },
      { ...acme, linkedinPage: "acme" },
      { linkedin: "research", linkedinCappedUntil: new Date(Date.now() - 1000) },
    );
    expect(r.state).toBe("hiring");
  });
});
