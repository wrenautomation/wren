import { describe, expect, it } from "vitest";
import { nextPassAt } from "../restate/social.js";
import { canSkip, isDue, pingOf, type RecentPost } from "./store.js";

const HOUR = 3_600_000;
const NOW = new Date("2026-10-06T16:00:00Z"); // 12:00 New York
const post = (daysOld: number): RecentPost => ({
  platform: "youtube",
  id: "p",
  url: null,
  title: "t",
  publishedAt: new Date(NOW.getTime() - daysOld * 24 * HOUR).toISOString(),
});

describe("social store", () => {
  it("pingOf: comments by platform, then each activity kind; null when nothing", () => {
    const c = (platform: string) => ({ platform }) as never;
    expect(
      pingOf(
        [c("youtube"), c("linkedin"), c("youtube")],
        Array.from({ length: 5 }, () => ({ kind: "follow" as const })),
      ),
    ).toBe("social: 3 comments (2 YouTube, 1 LinkedIn), 5 follows");
    expect(pingOf([], [{ kind: "follow" }])).toBe("social: 1 follow");
    expect(pingOf([], [])).toBeNull();
  });

  it("isDue: a fresh post every pass, an older one every 2 hours", () => {
    expect(isDue(post(1), NOW.getTime() - 60_000, NOW)).toBe(true);
    expect(isDue(post(5), NOW.getTime() - HOUR, NOW)).toBe(false);
    expect(isDue(post(5), NOW.getTime() - 2 * HOUR, NOW)).toBe(true);
    expect(isDue(post(5), undefined, NOW)).toBe(true);
  });

  it("isDue: a TikTok post every 6 hours while young, daily after (its page read is capped)", () => {
    const tt = (d: number): RecentPost => ({ ...post(d), platform: "tiktok" });
    expect(isDue(tt(1), NOW.getTime() - 5 * HOUR, NOW)).toBe(false);
    expect(isDue(tt(1), NOW.getTime() - 6 * HOUR, NOW)).toBe(true);
    expect(isDue(tt(5), NOW.getTime() - 23 * HOUR, NOW)).toBe(false);
    expect(isDue(tt(5), NOW.getTime() - 24 * HOUR, NOW)).toBe(true);
    expect(isDue(tt(5), undefined, NOW)).toBe(true);
  });

  it("isDue: a LinkedIn post every 2 hours while young, every 8 after (its page read is capped)", () => {
    const li = (d: number): RecentPost => ({ ...post(d), platform: "linkedin" });
    expect(isDue(li(1), NOW.getTime() - HOUR, NOW)).toBe(false);
    expect(isDue(li(1), NOW.getTime() - 2 * HOUR, NOW)).toBe(true);
    expect(isDue(li(5), NOW.getTime() - 7 * HOUR, NOW)).toBe(false);
    expect(isDue(li(5), NOW.getTime() - 8 * HOUR, NOW)).toBe(true);
  });

  it("canSkip: a held count inside the sweep skips the read; anything missing or moved reads", () => {
    const at = (hoursAgo: number) => NOW.getTime() - hoursAgo * HOUR;
    // Young: a held count is trusted for 6 hours, then the post is read in full.
    expect(canSkip(post(1), 4, 4, at(5), NOW)).toBe(true);
    expect(canSkip(post(1), 4, 4, at(6), NOW)).toBe(false);
    // Older: 24 hours.
    expect(canSkip(post(5), 0, 0, at(23), NOW)).toBe(true);
    expect(canSkip(post(5), 0, 0, at(24), NOW)).toBe(false);
    // A moved count, no probe, no kept count or no full read yet: read.
    expect(canSkip(post(1), 5, 4, at(1), NOW)).toBe(false);
    expect(canSkip(post(1), undefined, 4, at(1), NOW)).toBe(false);
    expect(canSkip(post(1), 4, undefined, at(1), NOW)).toBe(false);
    expect(canSkip(post(1), 4, 4, undefined, NOW)).toBe(false);
  });

  it("canSkip: X and TikTok sweep every 12 hours young, every 2 days older", () => {
    for (const platform of ["x", "tiktok"] as const) {
      const p = (d: number): RecentPost => ({ ...post(d), platform });
      expect(canSkip(p(1), 2, 2, NOW.getTime() - 11 * HOUR, NOW)).toBe(true);
      expect(canSkip(p(1), 2, 2, NOW.getTime() - 12 * HOUR, NOW)).toBe(false);
      expect(canSkip(p(5), 2, 2, NOW.getTime() - 47 * HOUR, NOW)).toBe(true);
      expect(canSkip(p(5), 2, 2, NOW.getTime() - 48 * HOUR, NOW)).toBe(false);
    }
  });

  it("nextPassAt: 30 minutes on inside 07:00-23:00 New York, else the next 07:00", () => {
    const zone = "America/New_York";
    expect(nextPassAt(NOW, zone).toISOString()).toBe("2026-10-06T16:30:00.000Z");
    // 22:45 New York: 23:15 is outside, so 07:00 next morning.
    expect(nextPassAt(new Date("2026-10-07T02:45:00Z"), zone).toISOString()).toBe(
      "2026-10-07T11:00:00.000Z",
    );
  });
});
