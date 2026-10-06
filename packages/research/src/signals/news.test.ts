import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { signalRefusal } from "../findings.js";
import type { SignalDeps } from "./index.js";
import { news } from "./news.js";

const NOW = new Date("2026-10-06T12:00:00Z");
const FIRM = {
  id: 7,
  name: "Acme Staffing LLC",
  domain: "acmestaffing.example",
  niche: null,
  country: null,
  linkedin_url: null,
};

const RSS = `<rss version="2.0"><channel>
<item><title>Acme Staffing opens new office in Springfield - Trade Daily</title>
<link>https://news.google.example/rss/articles/abc</link>
<pubDate>Mon, 21 Sep 2026 07:00:00 GMT</pubDate></item>
</channel></rss>`;

function deps(over: Partial<SignalDeps> = {}, firm: unknown = FIRM) {
  const calls: string[] = [];
  const sites: SiteClient = {
    async call(site, method, path) {
      calls.push(`${site} ${method} ${path}`);
      if (path === "/google") return { results: [] } as never;
      throw new SiteCallError(site, method, path, 404, "no route");
    },
    async via() {
      return "api";
    },
  };
  const d: SignalDeps = {
    db: { execute: async () => (firm ? [firm] : []) } as never,
    sites,
    desk: null,
    fetcher: { userAgent: "test", get: async (url) => ({ status: 200, url, text: RSS }) },
    pages: null,
    youtube: null,
    llm: null,
    linkedin: null,
    googleLeft: 5,
    now: NOW,
    ...over,
  };
  return { d, calls };
}

const settings = news.settings.parse({});

describe("news collector", () => {
  it("built; every kind by default", () => {
    expect(news.built).toBe(true);
    expect(settings.kinds).toEqual([
      "acquisition",
      "merger",
      "funding",
      "leader",
      "launch",
      "office",
      "award",
      "partnership",
      "expansion",
    ]);
  });

  it("RSS first: a kept, dated, linked signal with its raw, no Google spent", async () => {
    const { d, calls } = deps();
    const got = await news.collect(d, "c7", settings);
    expect(got.state).toBe("found");
    expect(calls).toEqual([]);
    expect(got.tried.map((t) => t.step)).toEqual(["rss"]);
    const [s] = got.signals;
    expect(s).toMatchObject({ kind: "news", companyId: 7, value: { event: "office" } });
    expect(s && signalRefusal(s)).toBeNull();
  });

  it("settings narrow the kinds", async () => {
    const { d } = deps();
    const got = await news.collect(d, "c7", news.settings.parse({ kinds: ["acquisition"] }));
    expect(got).toMatchObject({ state: "none", signals: [] });
  });

  it("no Google left: the page is not asked", async () => {
    const { d, calls } = deps({
      googleLeft: 0,
      fetcher: { userAgent: "test", get: async (url) => ({ status: 403, url, text: "" }) },
    });
    const got = await news.collect(d, "c7", settings);
    expect(calls).toEqual(["web GET /search"]);
    expect(got.tried.map((t) => t.step)).toEqual(["rss", "exa"]);
    expect(got.state).toBe("unresolved");
  });

  it("Google is logged as a google step", async () => {
    const { d, calls } = deps({ fetcher: null });
    const got = await news.collect(d, "c7", settings);
    expect(calls).toEqual(["web GET /google"]);
    expect(got.tried).toMatchObject([{ step: "google" }]);
  });

  it("an unknown firm is unresolved", async () => {
    const { d } = deps({}, null);
    expect((await news.collect(d, "c9", settings)).state).toBe("unresolved");
  });
});
