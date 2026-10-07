import { describe, expect, it } from "vitest";
import { insertAt, pickable, type SnippetLine } from "./snippets.js";

describe("insertAt", () => {
  it("puts the words at the cursor, or over the selection", () => {
    expect(insertAt("Hi there", "Sam, ", 3)).toEqual({ text: "Hi Sam, there", at: 8 });
    expect(insertAt("Hi there", "you", 3, 8)).toEqual({ text: "Hi you", at: 6 });
    expect(insertAt("", "Thanks")).toEqual({ text: "Thanks", at: 6 });
  });
});

describe("pickable", () => {
  const s = (id: number, title: string, body = "", tags: string[] = []): SnippetLine => ({
    id,
    title,
    body,
    tags,
    channel: "any",
  });
  const all = [
    s(1, "Pricing", "It starts at the base plan"),
    s(2, "Booking link"),
    s(3, "Away", "", ["ooo"]),
  ];
  it("puts favorites first, then by title", () => {
    expect(pickable(all, [3], "").map((x) => x.id)).toEqual([3, 2, 1]);
  });
  it("searches titles, words and tags", () => {
    expect(pickable(all, [], "base").map((x) => x.id)).toEqual([1]);
    expect(pickable(all, [], "OOO").map((x) => x.id)).toEqual([3]);
  });
});
