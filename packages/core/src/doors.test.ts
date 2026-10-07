import { describe, expect, it } from "vitest";
import { hashToken, maskToken, openToken, sealToken } from "./doors.js";

describe("a door's token", () => {
  const key = "test-key-not-a-secret";
  const token = "A".repeat(43);

  it("opens what it sealed, with the same key only", () => {
    const sealed = sealToken(token, key);
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain(token);
    expect(openToken(sealed, key)).toBe(token);
    expect(openToken(sealed, "another key")).toBeNull();
  });

  it("isn't kept without a key", () => {
    expect(sealToken(token, "")).toBeNull();
    expect(openToken(null, key)).toBeNull();
    expect(openToken("v1.x.y", key)).toBeNull();
  });

  it("masks all but its first letters", () => {
    expect(maskToken("abcdefgh")).toBe(`abcd${"•".repeat(10)}`);
    expect(hashToken(token)).toHaveLength(64);
  });
});
