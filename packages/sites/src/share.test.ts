import { describe, expect, it } from "vitest";
import { isShareToken, readShare, SHARE_DAYS, shareToken } from "./share.js";

const KEY = "test-shared-secret";
const PAGE = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-09T12:00:00Z");

describe("share links", () => {
  it("opens its version for 7 days, on its page, with its key", () => {
    const t = shareToken(KEY, PAGE, 3, NOW);
    expect(isShareToken(t)).toBe(true);
    expect(t.length).toBeLessThanOrEqual(64);
    expect(readShare(KEY, PAGE, t, NOW)).toBe(3);
    const late = new Date(NOW.getTime() + SHARE_DAYS * 86_400_000 + 1000);
    expect(readShare(KEY, PAGE, t, late)).toBeNull();
    expect(readShare("other", PAGE, t, NOW)).toBeNull();
    expect(readShare(KEY, PAGE.replace(/1$/, "2"), t, NOW)).toBeNull();
    expect(readShare(KEY, PAGE, t.replace("s.3.", "s.4."), NOW)).toBeNull();
    expect(readShare(KEY, PAGE, "s.3.zz.short", NOW)).toBeNull();
  });
});
