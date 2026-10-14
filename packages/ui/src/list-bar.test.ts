/** Quick filters (offered first by Filter) and which views show as tabs. */
import { defineRecord, metaOf, name, number, status } from "@wren/core/records";
import { describe, expect, it } from "vitest";
import { quickFilters, splitViews } from "./list-bar.js";

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
