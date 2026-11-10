import { describe, expect, it } from "vitest";
import { newestPerWho, spanOfMarks } from "./presence.js";

const row = (who: string, gone = false, n = 0) => ({ who, gone, n });

describe("newestPerWho", () => {
  it("keeps the first row of each who, rows newest first", () => {
    expect(newestPerWho([row("a", false, 3), row("b", false, 2), row("a", false, 1)])).toEqual([
      row("a", false, 3),
      row("b", false, 2),
    ]);
  });

  it("drops one whose newest row says it left, older rows too", () => {
    expect(newestPerWho([row("a", true, 2), row("a", false, 1), row("b")])).toEqual([row("b")]);
  });

  it("shows one who came back after it left", () => {
    expect(newestPerWho([row("a", false, 2), row("a", true, 1)])).toEqual([row("a", false, 2)]);
  });
});

describe("spanOfMarks", () => {
  it("covers every mark, a moment's own time as its end", () => {
    expect(
      spanOfMarks([
        { start: 4, end: 6 },
        { start: 9, end: null },
      ]),
    ).toEqual({ start: 4, end: 9 });
  });
  it("is one moment for one moment, and nothing for no mark", () => {
    expect(spanOfMarks([{ start: 4, end: null }])).toEqual({ start: 4 });
    expect(spanOfMarks([])).toEqual({});
  });
});
