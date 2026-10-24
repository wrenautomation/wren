import { describe, expect, it } from "vitest";
import { LOGIN_GAP_MS, SITE_EVERY_MS, siteReadDue } from "./social.js";

const H = 60 * 60 * 1000;
const T = 1_000 * H;

describe("siteReadDue", () => {
  it("reads a plain unit once a day", () => {
    expect(siteReadDue("posts x", { "posts x": T }, T + 23 * H)).toBe(false);
    expect(siteReadDue("posts x", { "posts x": T }, T + SITE_EVERY_MS)).toBe(true);
  });

  it("reads Instagram's Following list twice a day", () => {
    expect(siteReadDue("following instagram", { "following instagram": T }, T + 11 * H)).toBe(false);
    expect(siteReadDue("following instagram", { "following instagram": T }, T + 12 * H)).toBe(true);
  });

  it("keeps the reads through one Instagram login far apart", () => {
    const last = { "following instagram": T };
    expect(siteReadDue("following threads", last, T + LOGIN_GAP_MS - 1)).toBe(false);
    expect(siteReadDue("following threads", last, T + LOGIN_GAP_MS)).toBe(true);
    // A fresh start: Instagram first, Threads waits out the gap.
    expect(siteReadDue("following instagram", {}, T)).toBe(true);
  });
});
