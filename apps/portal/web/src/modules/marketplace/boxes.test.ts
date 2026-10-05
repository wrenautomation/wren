// What the Map draws from the catalog's rows (mapOf).
import { describe, expect, it } from "vitest";
import { mapOf } from "./boxes.js";

const row = (id: string, needs: string | null, more: Record<string, string> = {}) => ({
  id,
  name: id,
  needs,
  ready: "ready",
  for: "client",
  installed: null,
  ...more,
});

describe("mapOf", () => {
  const rows = [
    row("a.base", null),
    row("a.top", "a.base, gmail", { installed: "no" }),
    row("b.alone", null),
    row("c.top", "meta"),
  ];
  const { groups, alone } = mapOf(rows, (id) => `/x/${id}`);
  const boxes = groups[0] ?? [];

  it("needs that name a part are edges; the rest are account inputs, drawn last", () => {
    expect(boxes.map((b) => b.id)).toEqual(["a.base", "a.top", "@gmail"]);
    expect(boxes[2]).toMatchObject({ label: "Gmail account", input: true, after: [] });
    expect(boxes.find((b) => b.id === "a.top")?.after).toEqual(["a.base", "@gmail"]);
  });

  it("groups share no line, biggest first", () => {
    expect(groups.map((g) => g.map((b) => b.id))).toEqual([
      ["a.base", "a.top", "@gmail"],
      ["c.top", "@meta"],
    ]);
  });

  it("not installed is dim; parts with no edges stand alone", () => {
    expect(boxes.find((b) => b.id === "a.top")?.dim).toBe(true);
    expect(boxes.find((b) => b.id === "a.base")?.dim).toBe(false);
    expect(alone.map((b) => [b.id, b.href])).toEqual([["b.alone", "/x/b.alone"]]);
  });
});
