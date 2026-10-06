/** The funding collector over a canned EDGAR answer: synthetic firms, a fake fetcher, no network. */
import { describe, expect, it } from "vitest";
import type { Fetcher } from "../fetch/fetcher.js";
import { signalRefusal } from "../findings.js";
import { funding } from "./funding.js";
import type { SignalDeps } from "./index.js";

const NOW = new Date("2026-10-01T12:00:00Z");

const firmRow = (over: Record<string, unknown> = {}) => ({
  id: 7,
  name: "Quillmoor Staffing, LLC",
  domain: "quillmoor.test",
  niche: null,
  country: null,
  linkedin_url: null,
  ...over,
});

const hit = (adsh: string, name: string, doc = "primary_doc.xml") => ({
  _index: "edgar_file",
  _id: `${adsh}:${doc}`,
  _source: {
    ciks: ["0009990001"],
    display_names: [`${name}  (CIK 0009990001)`],
    root_forms: ["D"],
    file_date: "2026-07-21",
    biz_states: ["OH"],
    form: "D",
    adsh,
    inc_states: ["DE"],
    items: ["06B"],
  },
});

/** Shaped like the live search-index answer, trimmed. */
const ANSWER = {
  took: 3,
  timed_out: false,
  hits: {
    total: { value: 3, relation: "eq" },
    hits: [
      hit("0009990001-26-000001", "Quillmoor Staffing LLC"),
      hit("0009990001-26-000001", "Quillmoor Staffing LLC", "doc2.xml"),
      hit("0009990002-26-000004", "Quillmoor Staffing Fund II LP"),
    ],
  },
};

function fetcher(status: number, body: unknown = ANSWER): Fetcher & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    userAgent: "test",
    async get(url) {
      urls.push(url);
      return { status, url, text: JSON.stringify(body) };
    },
  };
}

function deps(over: Partial<SignalDeps> & { row?: unknown } = {}): SignalDeps {
  const { row = firmRow(), ...rest } = over;
  return {
    db: { execute: async () => (row ? [row] : []) } as never,
    sites: null,
    desk: null,
    fetcher: fetcher(200),
    pages: null,
    youtube: null,
    llm: null,
    linkedin: null,
    googleLeft: 0,
    now: NOW,
    ...rest,
  };
}

const on = funding.settings.parse({});

describe("funding collector", () => {
  it("is built, a year back by default", () => {
    expect(funding.built).toBe(true);
    expect(on).toEqual({ months: 12 });
  });

  it("searches Form D by the bare name over the window", async () => {
    const f = fetcher(200);
    await funding.collect(deps({ fetcher: f }), "c7", on);
    const u = new URL(f.urls[0] ?? "");
    expect(u.origin + u.pathname).toBe("https://efts.sec.gov/LATEST/search-index");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      q: '"Quillmoor Staffing"',
      forms: "D",
      dateRange: "custom",
      startdt: "2025-10-01",
      enddt: "2026-10-01",
    });
  });

  it("a matching filing: one dated, linked news signal per accession", async () => {
    const r = await funding.collect(deps(), "c7", on);
    expect(r.state).toBe("found");
    expect(r.signals).toHaveLength(1);
    const [d] = r.signals;
    expect(d).toMatchObject({
      kind: "news",
      companyId: 7,
      factKey: "c7:news:sec:0009990001-26-000001",
      via: "sec",
      confidence: 0.7,
      sourceUrl:
        "https://www.sec.gov/Archives/edgar/data/9990001/000999000126000001/0009990001-26-000001-index.htm",
      dated: "published",
      value: {
        title: "Form D filed",
        topic: "funding",
        event: "funding",
        issuer: "Quillmoor Staffing LLC",
        raw: { adsh: "0009990001-26-000001", biz_states: ["OH"] },
      },
    });
    expect(d?.signalAt.toISOString()).toBe("2026-07-21T00:00:00.000Z");
    expect(d && signalRefusal(d)).toBeNull();
  });

  it("no matching issuer is none", async () => {
    const other = { hits: { hits: [hit("0009990003-26-000002", "Quillmoor Ventures LP")] } };
    const r = await funding.collect(deps({ fetcher: fetcher(200, other) }), "c7", on);
    expect(r).toMatchObject({ state: "none", signals: [] });
  });

  it("429 or 403 is capped with a retry and stops the pass", async () => {
    for (const status of [429, 403]) {
      const r = await funding.collect(deps({ fetcher: fetcher(status, {}) }), "c7", on);
      expect(r.state).toBe("capped");
      expect(r.stop).toBeTruthy();
      expect(r.retryAt?.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it("not a firm is unresolved; a non-US firm is none without a search", async () => {
    expect((await funding.collect(deps({ row: null }), "c7", on)).state).toBe("unresolved");
    expect((await funding.collect(deps(), "p7", on)).state).toBe("unresolved");
    const f = fetcher(200);
    const r = await funding.collect(
      deps({ fetcher: f, row: firmRow({ country: "GB" }) }),
      "c7",
      on,
    );
    expect(r.state).toBe("none");
    expect(f.urls).toEqual([]);
  });
});
