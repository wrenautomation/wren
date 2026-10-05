import { describe, expect, it } from "vitest";
import { remember } from "./records.js";

describe("remember", () => {
  it("keeps the newest answers, dropping the least recently answered past the cap", () => {
    const seen = new Map<string, unknown>();
    remember(seen, "a", 1, 2);
    remember(seen, "b", 2, 2);
    remember(seen, "a", 3, 2);
    remember(seen, "c", 4, 2);
    expect([...seen]).toEqual([
      ["a", 3],
      ["c", 4],
    ]);
  });
});
