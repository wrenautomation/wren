/**
 * Adversarial tests for the company page lookup. A page tied to the wrong firm
 * is the worst outcome (Exa merges look-alike firms); a miss is fine. Tests
 * here state what SHOULD happen. A failing one is a bug, not a flaky test.
 */
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { firmSite, lookUpCompany, type ProfileSubject } from "./profile.js";

type Handler = (input: Record<string, unknown>) => unknown;

function fakeSites(routes: Record<string, Handler>) {
  const calls: { key: string; input: Record<string, unknown> }[] = [];
  const sites: SiteClient = {
    async call(site, method, path, input = {}) {
      const key = `${site} ${method} ${path}`;
      calls.push({ key, input: input as Record<string, unknown> });
      const h = routes[key];
      if (!h) throw new SiteCallError(site, method, path, 404, "no route");
      return (await h(input as Record<string, unknown>)) as never;
    },
    async via() {
      return "api";
    },
  };
  return { sites, calls, keys: () => calls.map((c) => c.key) };
}

const subject = (over: Partial<ProfileSubject> = {}): ProfileSubject => ({
  companyId: 9,
  firm: { name: "Acme Staffing LLC", domain: "acmestaffing.example" },
  linkedinUrl: null,
  ...over,
});
const page = (handle: string, website?: string) => ({
  name: "Acme Staffing",
  handle,
  url: `https://www.linkedin.com/company/${handle}/`,
  ...(website ? { website } : {}),
  industry: "Staffing and Recruiting",
  headquarters: "Springfield, ST",
  founded: "2004",
  size: "11-50 employees",
  about: "We place people.",
  text: "Acme Staffing\nStaffing and Recruiting\nWe place people.",
  source: "exa",
});
/** A cache holding these pages by url; anything else is a 404. */
const cache =
  (...pages: ReturnType<typeof page>[]): Handler =>
  (input) => {
    const p = pages.find((x) => x.url === input.url);
    if (!p) throw new SiteCallError("web", "GET", "/linkedin/company", 404, "no cached copy");
    return p;
  };
const noCompanies = () => ({ domain: "acmestaffing.example", via: "exa", companies: [] });
const NOW = new Date("2026-10-03T15:00:00Z");
const opts = { now: () => NOW, sleep: async () => {} };

describe("firmSite", () => {
  it("the same registrable domain, however the page wrote it", () => {
    expect(firmSite("https://www.acmestaffing.example/", "acmestaffing.example")).toBe(true);
    expect(firmSite("careers.acmestaffing.example", "acmestaffing.example")).toBe(true);
    expect(firmSite("http://ACMESTAFFING.example/about?x=1", "acmestaffing.example")).toBe(true);
  });
  it("never a look-alike", () => {
    expect(firmSite("https://acmestaffing.example.evil.test", "acmestaffing.example")).toBe(false);
    expect(firmSite("https://acmestaffing.co.uk", "acmestaffing.example")).toBe(false);
    expect(firmSite("https://goacmestaffing.example", "acmestaffing.example")).toBe(false);
    expect(firmSite("https://acme.wixsite.com/staffing", "wixsite.com")).toBe(false);
    expect(firmSite("", "acmestaffing.example")).toBe(false);
    expect(firmSite(undefined, "acmestaffing.example")).toBe(false);
    expect(firmSite("https://acmestaffing.example", null)).toBe(false);
  });
});

describe("lookUpCompany", () => {
  it("the page we hold, its website the firm's: matched, facts kept, nothing searched", async () => {
    const { sites, keys } = fakeSites({
      "web GET /linkedin/company": cache(page("acme-staffing", "https://acmestaffing.example")),
    });
    const r = await lookUpCompany(
      sites,
      subject({ linkedinUrl: "https://ca.linkedin.com/company/Acme-Staffing/about/" }),
      opts,
    );
    expect(r.state).toBe("matched");
    expect(r.url).toBe("https://www.linkedin.com/company/acme-staffing/");
    expect(r.finding).toMatchObject({
      kind: "profile",
      companyId: 9,
      via: "exa-cache",
      sourceUrl: "https://www.linkedin.com/company/acme-staffing/",
      value: {
        industry: "Staffing and Recruiting",
        location: "Springfield, ST",
        description: "We place people.",
        employees: "11-50 employees",
        founded: "2004",
        homepage: "https://acmestaffing.example",
      },
    });
    expect(r.finding?.document).toMatchObject({ kind: "profile", fetchTier: "exa-cache" });
    expect(keys()).toEqual(["web GET /linkedin/company"]);
  });

  it("a page whose website is a look-alike is never the firm's; its text is still kept", async () => {
    const { sites } = fakeSites({
      "web GET /linkedin/company": cache(
        page("acme-staffing", "https://acmestaffing.example.evil.test"),
      ),
      "web GET /companies": noCompanies,
    });
    const r = await lookUpCompany(
      sites,
      subject({ personCompanyUrl: "https://www.linkedin.com/company/acme-staffing" }),
      opts,
    );
    expect(r.state).toBe("unresolved");
    expect(r.url).toBeNull();
    expect(r.finding).toBeNull();
    expect(r.pages).toHaveLength(1);
  });

  it("each page read is checked by its source; a paused source is skipped", async () => {
    const { sites, keys } = fakeSites({
      "web GET /linkedin/company": cache(
        page("acme-held", "https://acmestaffing.example"),
        page("acme-people", "https://acmestaffing.example.evil.test"),
      ),
      "web GET /companies": noCompanies,
    });
    const r = await lookUpCompany(
      sites,
      subject({
        linkedinUrl: "https://www.linkedin.com/company/acme-held",
        personCompanyUrl: "https://www.linkedin.com/company/acme-people",
      }),
      { ...opts, paused: new Set(["held", "companies"]) },
    );
    expect(r.state).toBe("unresolved");
    expect(r.checks).toEqual([
      {
        source: "people",
        url: "https://www.linkedin.com/company/acme-people/",
        wrong: "website https://acmestaffing.example.evil.test: not the firm's",
      },
    ]);
    expect(keys()).toEqual(["web GET /linkedin/company"]);
  });

  it("a page with no website is never the firm's", async () => {
    const { sites } = fakeSites({
      "web GET /linkedin/company": cache(page("acme-staffing")),
      "web GET /companies": noCompanies,
    });
    const r = await lookUpCompany(
      sites,
      subject({ pageLinks: ["https://www.linkedin.com/company/acme-staffing"] }),
      opts,
    );
    expect(r.state).toBe("unresolved");
  });

  it("no domain: nothing to tie a page to, nothing asked", async () => {
    const { sites, keys } = fakeSites({});
    const r = await lookUpCompany(
      sites,
      subject({ firm: { name: "Acme Staffing", domain: null } }),
      opts,
    );
    expect(r.state).toBe("unresolved");
    expect(keys()).toEqual([]);
  });

  it("company search: only entities whose homepage matches are read", async () => {
    const { sites, calls } = fakeSites({
      "web GET /companies": () => ({
        domain: "acmestaffing.example",
        via: "exa",
        companies: [
          {
            name: "Acme Staffing",
            linkedin: "https://www.linkedin.com/company/acme-pt",
            homepageMatches: false,
          },
          {
            name: "Acme Staffing",
            linkedin: "https://www.linkedin.com/company/acme-staffing",
            homepageMatches: true,
          },
        ],
      }),
      "web GET /linkedin/company": cache(page("acme-staffing", "acmestaffing.example")),
    });
    const r = await lookUpCompany(sites, subject(), opts);
    expect(r.state).toBe("matched");
    expect(calls.map((c) => [c.key, c.input.url ?? c.input.domain])).toEqual([
      ["web GET /companies", "acmestaffing.example"],
      ["web GET /linkedin/company", "https://www.linkedin.com/company/acme-staffing/"],
    ]);
  });

  it("Google is off unless allowed; when on, only hits named as the firm are read", async () => {
    const off = fakeSites({ "web GET /companies": noCompanies });
    await lookUpCompany(off.sites, subject(), opts);
    expect(off.keys()).toEqual(["web GET /companies"]);

    const { sites, calls } = fakeSites({
      "web GET /google": () => ({
        query: "q",
        overview: null,
        results: [
          {
            position: 1,
            title: "Initech | LinkedIn",
            url: "https://www.linkedin.com/company/initech",
            site: "LinkedIn",
            shown: "",
          },
          {
            position: 2,
            title: "Acme Staffing | LinkedIn",
            url: "https://www.linkedin.com/company/acme-staffing",
            site: "LinkedIn",
            shown: "",
          },
        ],
        ads: [],
        questions: [],
      }),
      "web GET /linkedin/company": cache(page("acme-staffing", "https://acmestaffing.example")),
    });
    const r = await lookUpCompany(sites, subject(), { ...opts, google: true });
    expect(r.state).toBe("matched");
    expect(calls[0]?.input).toEqual({ q: 'site:linkedin.com/company "Acme Staffing"', n: 5 });
    expect(calls.map((c) => c.key)).toEqual(["web GET /google", "web GET /linkedin/company"]);
  });

  it("Google stopping (a CAPTCHA) never stops the lookup: company search still runs", async () => {
    const { sites, keys } = fakeSites({
      "web GET /google": () => {
        throw new SiteCallError("web", "GET", "/google", 502, "captcha");
      },
      "web GET /companies": noCompanies,
    });
    const r = await lookUpCompany(sites, subject(), { ...opts, google: true });
    expect(r.state).toBe("unresolved");
    expect(r.googleStopped).toMatchObject({ until: null });
    expect(keys()).toEqual(["web GET /google", "web GET /companies"]);
  });

  it("an Exa cap parks the company; a failed Exa read is thrown", async () => {
    const capped = fakeSites({
      "web GET /companies": () => {
        throw new SiteCallError("web", "GET", "/companies", 429, "retry after 40000s");
      },
    });
    const r = await lookUpCompany(capped.sites, subject(), opts);
    expect(r.state).toBe("capped");
    expect(r.cappedBy).toBe("web");

    const failed = fakeSites({
      "web GET /linkedin/company": () => {
        throw new SiteCallError("web", "GET", "/linkedin/company", 502, "exa failed");
      },
    });
    await expect(
      lookUpCompany(
        failed.sites,
        subject({ linkedinUrl: "https://www.linkedin.com/company/acme-staffing" }),
        opts,
      ),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("one page is read once, however many places link it", async () => {
    const { sites, keys } = fakeSites({
      "web GET /linkedin/company": cache(page("acme-staffing", "https://elsewhere.example")),
      "web GET /companies": noCompanies,
    });
    await lookUpCompany(
      sites,
      subject({
        linkedinUrl: "https://www.linkedin.com/company/acme-staffing/",
        personCompanyUrl: "https://www.linkedin.com/company/Acme-Staffing",
        pageLinks: ["https://linkedin.com/company/acme-staffing/jobs"],
      }),
      opts,
    );
    expect(keys().filter((k) => k === "web GET /linkedin/company")).toHaveLength(1);
  });
});
