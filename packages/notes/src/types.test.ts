import { describe, expect, it } from "vitest";
import { moveWords, ownerName } from "./types.js";

describe("ownerName", () => {
  it("says an agent by its name", () => {
    expect(ownerName("agent:claude")).toBe("Claude");
    expect(ownerName("agent:review-bot")).toBe("Review-bot");
  });

  it("keeps a person's address, or takes the first name", () => {
    expect(ownerName("sam.lee@firm.test")).toBe("sam.lee@firm.test");
    expect(ownerName("sam.lee@firm.test", true)).toBe("Sam");
    expect(ownerName("agent:claude", true)).toBe("Claude");
  });

  it("is empty for nobody", () => {
    expect(ownerName(null)).toBe("");
    expect(ownerName(undefined)).toBe("");
  });

  it("names people in the Timeline's words", () => {
    const words = moveWords(
      { kind: "assign", to: null, assignee: "agent:claude", why: null },
      (w) => ownerName(w, true),
    );
    expect(words).toBe("gave it to Claude");
  });
});
