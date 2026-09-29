import { describe, expect, it } from "vitest";
import { sharedAccounts } from "./index.js";

describe("sharedAccounts", () => {
  it("names an account two clients research from", () => {
    expect(
      sharedAccounts([
        { id: "a", accounts: { linkedin: "linkedin" } },
        { id: "b", accounts: { linkedin: "linkedin", web: "w1" } },
        { id: "c", accounts: { linkedin: "linkedin@c", web: "w2" } },
      ]),
    ).toEqual(["linkedin=linkedin is shared by a, b: one daily cap between them"]);
  });
  it("the same account name on two sites is not shared", () => {
    expect(
      sharedAccounts([
        { id: "a", accounts: { linkedin: "x" } },
        { id: "b", accounts: { web: "x" } },
      ]),
    ).toEqual([]);
  });
});
