import { columns, homeAt, PathError, wholeAt } from "@wren/core/paths";
import { describe, expect, it } from "vitest";
import { type WeaverSource, type WeaverView, weaverTree } from "./weaver-tree.js";

// two rounds: r1 read two pages, q2 hit both; r2 grew from r1
const VIEW: WeaverView = {
  run: "r1",
  queries: [
    { id: "q1", round: 1, terms: "bakery wholesale", why: "first look", hits: ["h1"] },
    {
      id: "q2",
      round: 1,
      terms: "cafe buyers",
      why: "who buys",
      site: "x.example",
      hits: ["h1", "h2", "h3"],
    },
  ],
  hits: [{ id: "h1", document: "d1" }, { id: "h2", document: "d2" }, { id: "h3" }],
  documents: [
    {
      id: "d1",
      hit: "h1",
      url: "https://www.bakers.example/guide",
      title: "A guide",
      media: "text",
      image: "https://img.example/1.jpg",
    },
    { id: "d2", hit: "h2", url: "https://cafes.example/list", media: "text" },
  ],
  findings: [
    { id: "f1", document: "d1", text: "Start with three cafes.", kept: true },
    { id: "f2", document: "d1", text: "Vendor pitch.", kept: false },
  ],
};

const source = (calls: string[] = []): WeaverSource => ({
  runs: async () => {
    calls.push("runs");
    return [
      {
        run: "r1",
        ask: "How do bakeries find buyers?",
        parent: null,
        updated: "2026-10-28T18:20:00Z",
        documents: 2,
        kept: 1,
      },
      {
        run: "r2",
        ask: "Which cafes buy?",
        parent: "r1",
        updated: "2026-10-28T18:30:00Z",
        documents: 0,
        kept: 0,
      },
    ];
  },
  view: async (run) => {
    calls.push(`view ${run}`);
    return run === "r1" ? VIEW : { run, queries: [], hits: [], documents: [], findings: [] };
  },
  page: async (run, doc) => ({
    id: doc,
    url: "https://x",
    title: null,
    media: "text",
    text: `${run}/${doc} text`,
  }),
});

describe("weaverTree", () => {
  it("lists runs newest first, then a run's pages, queries and rounds", async () => {
    const t = weaverTree(source());
    expect((await t.children("weaver")).items.map((i) => i.path)).toEqual([
      "weaver/r2",
      "weaver/r1",
    ]);
    expect((await t.children("weaver/r1")).items.map((i) => [i.path, i.count])).toEqual([
      ["weaver/r1/pages", 2],
      ["weaver/r1/queries", 2],
      ["weaver/r1/grew-into", 1],
    ]);
    expect((await t.children("weaver/r2")).items.at(-1)?.path).toBe("weaver/r2/grew-from");
  });

  it("holds a page's findings and the queries that hit it", async () => {
    const t = weaverTree(source());
    const rows = (await t.children("weaver/r1/pages/d1")).items;
    expect(rows.map((i) => [i.path, i.mark])).toEqual([
      ["weaver/r1/pages/d1/f1", undefined],
      ["weaver/r1/pages/d1/f2", "dropped"],
      ["weaver/r1/pages/d1/hit-by", undefined],
    ]);
    const by = (await t.children("weaver/r1/pages/d1/hit-by")).items;
    expect(by.map((i) => [i.path, i.original])).toEqual([
      ["weaver/r1/pages/d1/hit-by/q1", "weaver/r1/queries/q1"],
      ["weaver/r1/pages/d1/hit-by/q2", "weaver/r1/queries/q2"],
    ]);
    const page = (await t.children("weaver/r1/pages")).items[0];
    expect(page).toMatchObject({
      name: "A guide",
      sub: "bakers.example",
      count: 2,
      poster: "https://img.example/1.jpg",
    });
  });

  it("shows a query's read pages as aliases; an unread hit is no page", async () => {
    const t = weaverTree(source());
    const rows = (await t.children("weaver/r1/queries/q2")).items;
    expect(rows.map((i) => i.original)).toEqual(["weaver/r1/pages/d1", "weaver/r1/pages/d2"]);
    expect(await homeAt(t, "weaver/r1/queries/q2/d2")).toBe("weaver/r1/pages/d2");
    expect((await t.item("weaver/r1/queries/q2")).sub).toBe("site x.example · round 1 · 3 hits");
  });

  it("walks a route through a relation and back to a home", async () => {
    const t = weaverTree(source());
    const shown = await columns(t, "weaver/r1/pages/d1/hit-by/q2/d2");
    expect(shown.columns.at(-1)?.home).toBe("weaver/r1/pages/d2");
    expect(shown.whole?.body).toBe("r1/d2 text");
  });

  it("reads a page whole with its text and its links", async () => {
    const w = await wholeAt(weaverTree(source()), "weaver/r1/pages/d1");
    expect(w.body).toBe("r1/d1 text");
    expect(w.links.map((l) => [l.rel, l.dir, l.items.length])).toEqual([["hit-by", "in", 2]]);
    const f = await wholeAt(weaverTree(source()), "weaver/r1/pages/d1/f2");
    expect(f).toMatchObject({ body: "Vendor pitch.", mark: "dropped", leaf: true });
  });

  it("finds runs by ask at the root, and records inside a run", async () => {
    const t = weaverTree(source());
    expect((await t.find("cafe", "weaver")).map((i) => i.path)).toEqual(["weaver/r2"]);
    expect((await t.find("cafe", "weaver/r1")).map((i) => i.path)).toEqual([
      "weaver/r1/queries/q2",
      "weaver/r1/pages/d2",
      "weaver/r1/pages/d1/f1",
    ]);
  });

  it("reads each run's view once, and answers unknown paths", async () => {
    const calls: string[] = [];
    const t = weaverTree(source(calls));
    await t.children("weaver/r1/pages");
    await t.children("weaver/r1/queries");
    expect(calls).toEqual(["runs", "view r1"]);
    await expect(t.item("weaver/r9")).rejects.toMatchObject({ code: "unknown-path" });
    await expect(t.item("weaver/r1/pages/d9")).rejects.toMatchObject({ code: "unknown-path" });
    await expect(t.children("weaver/r1/queries/q1/d1/x")).rejects.toBeInstanceOf(PathError);
  });

  it("passes the source's offline on", async () => {
    const t = weaverTree({
      ...source(),
      runs: () => Promise.reject(new PathError("offline", "weaver serve does not answer")),
    });
    const shown = await columns(t, "weaver/r1");
    expect(shown.error).toMatchObject({ code: "offline", route: "weaver/r1" });
  });
});
