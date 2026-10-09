import { describe, expect, it } from "vitest";
import { nextPassAt } from "../restate/social.js";
import { isDue, pingOf, type RecentPost } from "./store.js";

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

  it("nextPassAt: 30 minutes on inside 07:00-23:00 New York, else the next 07:00", () => {
    const zone = "America/New_York";
    expect(nextPassAt(NOW, zone).toISOString()).toBe("2026-10-06T16:30:00.000Z");
    // 22:45 New York: 23:15 is outside, so 07:00 next morning.
    expect(nextPassAt(new Date("2026-10-07T02:45:00Z"), zone).toISOString()).toBe(
      "2026-10-07T11:00:00.000Z",
    );
  });
});
