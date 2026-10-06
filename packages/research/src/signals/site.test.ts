/** The site collector: synthetic firms, canned pages and CDX answers, no network. */
import { describe, expect, it } from "vitest";
import { FetchError, type Fetcher } from "../fetch/fetcher.js";
import { signalRefusal } from "../findings.js";
import type { SignalDeps } from "./index.js";
import { captured, cdxRows, lineDiff, newestChange, pick, site } from "./site.js";

const NOW = new Date("2026-10-01T12:00:00Z");
const FIRM = {
  id: 7,
  name: "Acme Studio",
  domain: "acmestudio.test",
  niche: null,
  country: null,
  linkedin_url: null,
};
const on = site.settings.parse({});

/** Pages by url; a function value is called (throw to fail). Robots allow everything unless given. */
function fetcher(pages: Record<string, string | (() => string)>): Fetcher & { gets: string[] } {
  const gets: string[] = [];
  return {
    gets,
    userAgent: "test",
    async get(url) {
      gets.push(url);
      const page = pages[url];
      if (page === undefined) return { status: 404, url, text: "" };
      return { status: 200, url, text: typeof page === "function" ? page() : page };
    },
  };
}

/** `execute` answers in call order: the firm, the last check, the stored pages. */
function deps(answers: unknown[][], f: Fetcher | null): SignalDeps {
  const queue = [...answers];
  return {
    db: { execute: async () => queue.shift() ?? [] } as never,
    sites: null,
    desk: null,
    fetcher: f,
    pages: null,
    youtube: null,
    llm: null,
    linkedin: null,
    googleLeft: 0,
    now: NOW,
  };
}

const HEAD = ["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"];
const cap = (ts: string, url: string, digest: string) => [
  "test,acmestudio)/",
  ts,
  url,
  "text/html",
  "200",
  digest,
  "1000",
];
const CDX_BODY = JSON.stringify([
  HEAD,
  cap("20251101000000", "https://acmestudio.test/", "AAA"),
  cap("20251102000000", "http://acmestudio.test/", "BBB"),
  cap("20260301101500", "https://acmestudio.test/", "CCC"),
  cap("20260302000000", "http://acmestudio.test/", "BBB"),
]);
const html = (...lines: string[]) =>
  `<html><head><title>Acme</title></head><body>${lines.map((l) => `<p>${l}</p>`).join("\n")}</body></html>`;
const LATER = [{ state: "none", tried: [], checked_at: "2026-09-01T00:00:00Z" }];

describe("site collector", () => {
  it("is built with its defaults", () => {
    expect(site.built).toBe(true);
    expect(on).toEqual({ pages: 4, months: 12, robots: "warn" });
  });

  it("first read: the newest new digest from Wayback is one dated, linked signal", async () => {
    const f: Fetcher & { gets: string[] } = {
      gets: [],
      userAgent: "test",
      async get(url) {
        this.gets.push(url);
        return { status: 200, url, text: CDX_BODY };
      },
    };
    const r = await site.collect(deps([[FIRM], []], f), "c7", on);
    expect(f.gets[0]).toContain("web.archive.org/cdx/search/cdx?url=acmestudio.test");
    expect(f.gets[0]).toContain("from=20251001");
    expect(r.state).toBe("found");
    const [d] = r.signals;
    expect(d).toMatchObject({
      kind: "site_change",
      companyId: 7,
      factKey: "c7:site_change:wayback:CCC",
      sourceUrl: "https://web.archive.org/web/20260301101500/https://acmestudio.test/",
      dated: "seen",
      value: { topic: "home", digest: "CCC", captures: 4 },
      document: { kind: "snippet", text: CDX_BODY },
    });
    expect(d?.signalAt.toISOString()).toBe("2026-03-01T10:15:00.000Z");
    expect(d && signalRefusal(d)).toBeNull();
  });

  it("first read: no archive is none; an archive that is down twice is unresolved", async () => {
    const empty = fetcher({});
    empty.get = async (url) => ({ status: 200, url, text: "[]" });
    expect((await site.collect(deps([[FIRM], []], empty), "c7", on)).state).toBe("none");

    let calls = 0;
    const down: Fetcher = {
      userAgent: "test",
      async get() {
        calls += 1;
        throw new FetchError("HTTP 503", 503);
      },
    };
    const r = await site.collect(deps([[FIRM], []], down), "c7", on);
    expect(r.state).toBe("unresolved");
    expect(calls).toBe(2);
    expect(r.tried.filter((t) => t.step === "wayback")).toHaveLength(2);
  });

  it("an unresolved first read is still a first read", async () => {
    const f = fetcher({});
    f.get = async (url) => ({ status: 200, url, text: "[]" });
    const last = [{ state: "unresolved", tried: [{ step: "wayback" }], checked_at: "2026-09-01" }];
    const r = await site.collect(deps([[FIRM], last], f), "c7", on);
    expect(r.tried.map((t) => t.step)).toEqual(["wayback"]);
  });

  it("later read: a changed page is a site_change with its diff; unchanged pages are not", async () => {
    const stored = [
      { id: 11, url: "https://acmestudio.test", text: "Acme Studio\nWe design homes" },
      { id: 12, url: "https://acmestudio.test/pricing", text: "Plans\nBasic $10\nPro $20" },
      { id: 13, url: "https://acmestudio.test/blog/post", text: "Old news" },
    ];
    const f = fetcher({
      "https://acmestudio.test": html("Acme Studio", "We design homes"),
      "https://acmestudio.test/pricing": html("Plans", "Basic $10", "Pro $25", "Team $90"),
    });
    const r = await site.collect(deps([[FIRM], LATER, stored], f), "c7", on);
    expect(f.gets).not.toContain("https://acmestudio.test/blog/post");
    expect(r.state).toBe("found");
    expect(r.signals).toHaveLength(1);
    const [d] = r.signals;
    expect(d?.factKey).toMatch(/^c7:site_change:https:\/\/acmestudio\.test\/pricing:[0-9a-f]{64}$/);
    expect(d).toMatchObject({
      sourceUrl: "https://acmestudio.test/pricing",
      dated: "seen",
      signalAt: NOW,
      value: {
        title: "Pricing page changed: 3 lines",
        topic: "pricing",
        added: ["Pro $25", "Team $90"],
        removed: ["Pro $20"],
        lines_changed: 3,
        new_page: false,
        since: "2026-09-01T00:00:00.000Z",
        previous_document_id: 12,
      },
      document: { url: "https://acmestudio.test/pricing", kind: "webpage" },
    });
    expect(d && signalRefusal(d)).toBeNull();
    expect(r.tried).toContainEqual({
      step: "page",
      what: "https://acmestudio.test",
      outcome: "unchanged",
    });
  });

  it("later read: a page back on a version already reported is not reported again", async () => {
    const stored = [{ id: 12, url: "https://acmestudio.test/pricing", text: "Plans\nBasic $10" }];
    const f = fetcher({ "https://acmestudio.test/pricing": html("Plans", "Basic $12") });
    const r = await site.collect(deps([[FIRM], LATER, stored, [{ "?column?": 1 }]], f), "c7", on);
    expect(r.signals).toEqual([]);
    expect(r.tried).toContainEqual({
      step: "page",
      what: "https://acmestudio.test/pricing",
      outcome: "unchanged: version already reported",
    });
  });

  it("later read: a home page never stored is a new page; a page failing twice is unresolved", async () => {
    const f = fetcher({ "https://acmestudio.test": html("Hello") });
    const r = await site.collect(deps([[FIRM], LATER, []], f), "c7", on);
    expect(r.signals[0]?.value).toMatchObject({
      new_page: true,
      added: ["Hello"],
      removed: [],
      previous_document_id: null,
    });

    const g = fetcher({});
    const stored = [{ id: 11, url: "https://acmestudio.test", text: "Hi" }];
    const u = await site.collect(deps([[FIRM], LATER, stored], g), "c7", on);
    expect(u.state).toBe("unresolved");
    expect(g.gets.filter((x) => x === "https://acmestudio.test")).toHaveLength(2);
  });

  it("robots: enforce skips a disallowed page, warn reads it and says so", async () => {
    const stored = [{ id: 11, url: "https://acmestudio.test", text: "Hi" }];
    const pages = {
      "https://acmestudio.test/robots.txt": "User-agent: *\nDisallow: /",
      "https://acmestudio.test": html("Hello"),
    };
    const f = fetcher(pages);
    const skip = await site.collect(deps([[FIRM], LATER, stored], f), "c7", {
      ...on,
      robots: "enforce",
    });
    expect(skip.state).toBe("none");
    expect(f.gets).toEqual(["https://acmestudio.test/robots.txt"]);

    const warn = await site.collect(deps([[FIRM], LATER, stored], fetcher(pages)), "c7", on);
    expect(warn.signals[0]?.value).toMatchObject({ robots_disallowed: true });
  });

  it("no firm, no domain or no fetcher is unresolved", async () => {
    const f = fetcher({});
    expect((await site.collect(deps([[]], f), "c7", on)).state).toBe("unresolved");
    expect((await site.collect(deps([[{ ...FIRM, domain: null }]], f), "c7", on)).state).toBe(
      "unresolved",
    );
    expect((await site.collect(deps([[FIRM]], null), "c7", on)).state).toBe("unresolved");
  });
});

describe("site helpers", () => {
  it("picks the home page, then hint pages in order, up to the cap", () => {
    const rows = ["/", "/work", "/about-us", "/blog", "/pricing", "/our-team", "/services"].map(
      (p, i) => ({ id: i, url: `https://acmestudio.test${p}`, text: "x" }),
    );
    expect(pick(rows, "acmestudio.test", 4).map((p) => p.topic)).toEqual([
      "home",
      "pricing",
      "services",
      "about",
      "team",
    ]);
    expect(pick(rows, "acmestudio.test", 0)).toHaveLength(1);
  });

  it("reads CDX rows and skips a flap back to an older digest", () => {
    const rows = cdxRows(CDX_BODY);
    expect(rows).toHaveLength(4);
    expect(rows && newestChange(rows)?.digest).toBe("CCC");
    expect(cdxRows("[]")).toEqual([]);
    expect(cdxRows("<html>offline</html>")).toBeNull();
    expect(newestChange([{ timestamp: "1", original: "x", digest: "A" }])).toBeNull();
    expect(captured("20260301101500").toISOString()).toBe("2026-03-01T10:15:00.000Z");
  });

  it("diffs whole lines as multisets", () => {
    expect(lineDiff("a\nb\nb", "b\nc\na")).toEqual({ added: ["c"], removed: ["b"] });
    expect(lineDiff("", "a")).toEqual({ added: ["a"], removed: [] });
  });
});
