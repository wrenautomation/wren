/** The hiring collector over `checkHiring`: synthetic firms, canned pages, a fake SiteClient. */
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import type { Fetcher } from "../fetch/fetcher.js";
import { signalRefusal } from "../findings.js";
import { hiring } from "./hiring.js";
import type { SignalDeps } from "./index.js";

const NOW = new Date("2026-10-01T12:00:00Z");

const firmRow = (over: Record<string, unknown> = {}) => ({
  id: 7,
  name: "Acme Staffing",
  domain: "acmestaffing.test",
  niche: null,
  country: null,
  linkedin_url: null,
  ...over,
});

function fetcher(pages: Record<string, string>): Fetcher {
  return {
    userAgent: "test",
    async get(url) {
      const text = pages[url];
      return text === undefined ? { status: 404, url, text: "" } : { status: 200, url, text };
    },
  };
}

function sites(answer: (path: string) => unknown): SiteClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async call(site, _method, path, _input, account) {
      calls.push(`${site} ${path} as ${account ?? "-"}`);
      return answer(path) as never;
    },
    async via() {
      return "api";
    },
  };
}

function deps(over: Partial<SignalDeps> & { row?: unknown } = {}): SignalDeps {
  const { row = firmRow(), ...rest } = over;
  return {
    db: { execute: async () => (row ? [row] : []) } as never,
    sites: null,
    desk: null,
    fetcher: null,
    pages: null,
    youtube: null,
    llm: null,
    linkedin: null,
    googleLeft: 0,
    now: NOW,
    ...rest,
  };
}

const on = hiring.settings.parse({});

const BOARD = {
  "https://acmestaffing.test/careers": "https://jobs.lever.co/acme",
  "https://api.lever.co/v0/postings/acme?mode=json": JSON.stringify([
    { text: "Recruiter", hostedUrl: "https://jobs.lever.co/acme/1", createdAt: 1_758_000_000_000 },
    { text: "Sourcer", hostedUrl: "https://jobs.lever.co/acme/2", createdAt: 1_759_000_000_000 },
  ]),
};

const LINKEDIN_JOBS = (path: string) =>
  path.endsWith("/jobs") ? { jobs: [{ title: "Account Manager" }] } : {};

describe("hiring collector", () => {
  it("is built and on by default, LinkedIn allowed", () => {
    expect(hiring.built).toBe(true);
    expect(on).toEqual({ linkedin: true });
  });

  it("a board's roles: one dated, linked signal with the built key", async () => {
    const r = await hiring.collect(deps({ fetcher: fetcher(BOARD) }), "c7", on);
    expect(r.state).toBe("found");
    const [d] = r.signals;
    expect(d).toMatchObject({
      kind: "hiring",
      companyId: 7,
      factKey: "c7:hiring:lever:https://jobs.lever.co/acme",
      sourceUrl: "https://jobs.lever.co/acme",
      dated: "published",
      value: { topic: "hiring", title: "2 open roles, newest: Sourcer" },
    });
    expect(d?.signalAt.toISOString().slice(0, 10)).toBe("2025-09-27");
    expect(d && signalRefusal(d)).toBeNull();
  });

  it("LinkedIn reads only as linkedin@alt; a posting with no date is dated by our read", async () => {
    const s = sites(LINKEDIN_JOBS);
    const row = firmRow({ linkedin_url: "https://www.linkedin.com/company/acme-staffing/" });
    const r = await hiring.collect(deps({ row, sites: s, linkedin: "linkedin@alt" }), "c7", on);
    expect(s.calls).toEqual(["linkedin /company/acme-staffing/jobs as linkedin@alt"]);
    expect(r.state).toBe("found");
    expect(r.signals[0]).toMatchObject({ dated: "seen", signalAt: NOW });
  });

  it("never reads as William's or Wren's LinkedIn, or when the setting is off", async () => {
    const row = firmRow({ linkedin_url: "https://www.linkedin.com/company/acme-staffing/" });
    for (const [account, s] of [
      ["linkedin", on],
      ["linkedin@wren", on],
      ["linkedin@alt", { linkedin: false }],
    ] as const) {
      const site = sites(LINKEDIN_JOBS);
      const r = await hiring.collect(deps({ row, sites: site, linkedin: account }), "c7", s);
      expect(site.calls).toEqual([]);
      expect(r.state).toBe("unresolved");
    }
  });

  it("a LinkedIn cap parks the firm, not the pass", async () => {
    const s = sites(() => {
      throw new SiteCallError("linkedin", "GET", "/x", 429, "retry after 43200s");
    });
    const row = firmRow({ linkedin_url: "https://www.linkedin.com/company/acme-staffing/" });
    const r = await hiring.collect(deps({ row, sites: s, linkedin: "linkedin@alt" }), "c7", on);
    expect(r).toMatchObject({ state: "capped", signals: [] });
    expect(r.stop).toBeUndefined();
    expect(r.retryAt?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
  });

  it("an empty board is none; an unknown firm or a person key is unresolved", async () => {
    const empty = fetcher({
      "https://acmestaffing.test/careers": "https://jobs.lever.co/acme",
      "https://api.lever.co/v0/postings/acme?mode=json": "[]",
    });
    expect((await hiring.collect(deps({ fetcher: empty }), "c7", on)).state).toBe("none");
    expect((await hiring.collect(deps({ row: null }), "c7", on)).state).toBe("unresolved");
    expect((await hiring.collect(deps(), "p7", on)).tried[0]?.outcome).toBe("no such firm");
  });
});
