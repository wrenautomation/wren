import { describe, expect, it } from "vitest";
import { keyId } from "./key-id.js";

describe("keyId", () => {
  it("is the first 12 hex characters of the SHA-256 of the trimmed value", () => {
    // Pinned from `printf 'sk-test-0000' | shasum -a 256`, the rule credvault and autobrowse share.
    expect(keyId("sk-test-0000")).toBe("4870acc0dad0");
    expect(keyId("  sk-test-0000\n")).toBe("4870acc0dad0");
    expect(keyId("sk-test-0001")).not.toBe(keyId("sk-test-0000"));
    expect(keyId("sk-test-0000")).toMatch(/^[0-9a-f]{12}$/);
  });
});
