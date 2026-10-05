import { describe, expect, it } from "vitest";
import { pgSafe } from "./columns.js";

describe("pgSafe", () => {
  it("drops NUL and half an emoji, keeps whole ones, at any depth", () => {
    const cut = "Aarti 🙏".slice(0, -1);
    expect(pgSafe({ a: ["x\u0000y", cut, "🙏"], n: 1 })).toEqual({
      a: ["xy", "Aarti ", "🙏"],
      n: 1,
    });
  });
});
