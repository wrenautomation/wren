/** Quick filters: the ones always on a list's bar. */
import { defineRecord, metaOf, name, number, status } from "@wren/core/records";
import { describe, expect, it } from "vitest";
import { quickFilters } from "./list-bar.js";

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
