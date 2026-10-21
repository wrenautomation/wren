/** Quick filters (offered first by Filter), which views show as tabs, and what rows group by. */
import { choice, defineRecord, metaOf, name, number, status } from "@wren/core/records";
import { describe, expect, it } from "vitest";
import {
  byField,
  groupFields,
  keptOf,
  lastOf,
  quickFilters,
  restoreOf,
  splitViews,
} from "./list-bar.js";

const two = {
  a: { label: "A", tone: "neutral" as const },
  b: { label: "B", tone: "neutral" as const },
};
const many = Object.fromEntries(
  Array.from({ length: 20 }, (_, i) => [`s${i}`, { label: `S${i}`, tone: "neutral" as const }]),
);
const rec = (o: { quick?: string[]; site?: boolean }) =>
  metaOf(
    defineRecord({
      id: "t.rows",
      app: "marketing",
      channel: o.site ? { field: "platform" } : null,
      name: { one: "row", many: "rows" },
      rows: async () => [],
      key: "id",
      title: "who",
      fields: {
        who: name("Who"),
        kind: status(two, "Kind"),
        big: status(many, "Big"),
        state: status(two, "State"),
        count: number("Count"),
        platform: status(two, "Site"),
        extra: status(two, "Extra"),
      },
      views: [{ id: "all", label: "All" }],
      ...(o.quick ? { quick: o.quick } : {}),
    }),
    false,
  );

describe("quickFilters", () => {
  it("platform first, then short pick lists, three at most", () => {
    expect(quickFilters(rec({ site: true })).map((f) => f.key)).toEqual([
      "platform",
      "kind",
      "state",
    ]);
  });
  it("no platform field: short pick lists in order; a long one stays in Filter", () => {
    expect(quickFilters(rec({})).map((f) => f.key)).toEqual(["kind", "state", "platform"]);
  });
  it("the record's own list wins", () => {
    expect(quickFilters(rec({ quick: ["extra", "count", "nope"] })).map((f) => f.key)).toEqual([
      "extra",
      "count",
    ]);
  });
});

describe("groupFields and byField", () => {
  const kinds = () => ({ x: "X", y: "Y" });
  const typed = (o: { site?: boolean; choices?: boolean }) =>
    metaOf(
      defineRecord({
        id: "t.group",
        app: "marketing",
        channel: o.site ? { field: "platform" } : null,
        name: { one: "row", many: "rows" },
        rows: async () => [],
        key: "id",
        title: "who",
        fields: {
          who: name("Who"),
          count: number("Count"),
          ...(o.choices ? { niche: choice(kinds, "Niche") } : {}),
          state: status(two, "State"),
          platform: status(two, "Site"),
        },
        views: [{ id: "all", label: "All" }],
      }),
      false,
    );
  it("offers the platform, then every status or choice, never twice", () => {
    expect(groupFields(typed({ site: true, choices: true })).map((f) => f.key)).toEqual([
      "platform",
      "niche",
      "state",
    ]);
  });
  it("offers nothing where no field has states", () => {
    const plain = typed({});
    expect(groupFields({ ...plain, fields: plain.fields.filter((f) => !f.states) })).toEqual([]);
  });
  it("By takes the platform, else the first status, else the first choice", () => {
    expect(byField(typed({ site: true }))?.key).toBe("platform");
    expect(byField(typed({ choices: true }))?.key).toBe("state");
  });
});

describe("splitViews", () => {
  const ids = ["all", "a", "b", "c", "d", "e", "f"];
  it("before counts: the first five by declared order", () => {
    expect(splitViews(ids, undefined)).toEqual({
      tabs: ["all", "a", "b", "c", "d"],
      more: ["e", "f"],
    });
  });
  it("an empty view waits under More, the default never does", () => {
    const counts = { all: 0, a: 3, b: 0, c: 1, d: 2, e: 5, f: 1 };
    expect(splitViews(ids, counts)).toEqual({
      tabs: ["all", "a", "c", "d", "e"],
      more: ["b", "f"],
    });
  });
  it("saved views follow the built-in ones", () => {
    expect(splitViews(["all", "a"], { all: 1, a: 1 }, ["sv:1", "sv:2", "sv:3", "sv:4"])).toEqual({
      tabs: ["all", "a", "sv:1", "sv:2", "sv:3"],
      more: ["sv:4"],
    });
  });
});

describe("where a list was left, as a pref", () => {
  const p = (s: string) => new URLSearchParams(s);
  it("kept with the rest of where he left the list", () => {
    expect(lastOf(p("view=all&sort=-at&as=rows&q=hi&sv=3"))).toEqual({
      sv: 3,
      view: "all",
      sort: "-at",
      as: "rows",
    });
  });
  it("a saved view keeps a timeline page's list", () => {
    expect(keptOf(rec({}), p("view=all&as=rows"))).toContain("as=rows");
  });
  it("restored on a bare link, with his view", () => {
    expect(restoreOf({ view: "all", as: "rows" }, p(""), false)).toEqual({
      change: { view: "all", sort: null, cols: null, as: "rows" },
    });
  });
  it("restored when the link names a view but not the form", () => {
    expect(restoreOf({ view: "all", as: "rows" }, p("view=done"), false)).toEqual({
      change: { as: "rows" },
    });
  });
  it("a link that names it, or a saved view, wins", () => {
    expect(restoreOf({ as: "rows" }, p("as=rows&view=all"), false)).toBeNull();
    expect(restoreOf({ view: "all", as: "rows" }, p("sv=4"), false)).toBeNull();
  });
  it("a saved view he used last opens when it still exists", () => {
    expect(restoreOf({ sv: 4 }, p(""), false, new Set([4]))).toEqual({ sv: 4 });
  });
  it("cards are gone: an old cards pref is dropped, the rest still restores", () => {
    expect(lastOf(p("as=cards&view=all"))).toEqual({ view: "all" });
    expect(restoreOf({ as: "cards" }, p(""), false)).toBeNull();
    expect(restoreOf({ view: "all", as: "cards" }, p(""), false)).toEqual({
      change: { view: "all", sort: null, cols: null },
    });
  });
  it("nothing kept, nothing changed", () => {
    expect(restoreOf(undefined, p(""), false)).toBeNull();
    expect(restoreOf({}, p(""), false)).toBeNull();
  });
});
