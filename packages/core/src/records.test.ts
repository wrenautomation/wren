import { describe, expect, it } from "vitest";
import { choice, clausesOf, csvRow, defineRecord, metaOf, text } from "./records.js";

describe("choice fields", () => {
  const labels: Record<string, string> = { north: "North" };
  const type = defineRecord({
    id: "test.choice",
    app: "outbound",
    channel: null,
    name: { one: "row", many: "rows" },
    view: "test_rows",
    key: "id",
    title: "region",
    fields: { region: choice(() => labels, "Region"), note: text() },
    views: [{ id: "all", label: "All" }],
  });

  it("hands the web its labels as states, read when asked", () => {
    labels.south_east = "South-east";
    const f = metaOf(type, false).fields.find((x) => x.key === "region");
    expect(f).toMatchObject({
      kind: "choice",
      states: {
        north: { label: "North", tone: "neutral" },
        south_east: { label: "South-east", tone: "neutral" },
      },
      ops: ["eq", "in", "empty"],
    });
  });

  it("filters by key, any key, and exports the label", () => {
    expect(clausesOf(type, { region: ["south_east", "west"] })).toEqual([
      { field: "region", op: "in", value: ["south_east", "west"] },
    ]);
    expect(csvRow(type, { id: 1, region: "north", note: null })).toEqual([1, "North", null]);
    // A key with no label of its own reads as words.
    expect(csvRow(type, { id: 2, region: "west", note: null })).toEqual([2, "West", null]);
  });
});
