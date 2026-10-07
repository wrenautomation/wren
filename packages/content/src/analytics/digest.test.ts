import { describe, expect, it } from "vitest";
import { withCounts } from "../restate/metrics.js";
import { buildDigest, type DigestPost } from "./digest.js";

const NOW = new Date("2026-10-12T09:00:00Z");
const ago = (days: number, hour = 15) => {
  const d = new Date(NOW.getTime() - days * 86_400_000);
  d.setUTCHours(hour);
  return d;
};
let n = 0;
const post = (o: Partial<DigestPost>): DigestPost => ({
  id: `idea/youtube/${++n}`,
  platform: "youtube",
  title: `Synthetic post ${n}`,
  format: "short",
  stage: "reach",
  published: ago(1),
  views: 100,
  engaged: 5,
  viewPct: null,
  clicks: 0,
  ...o,
});

describe("weekly digest", () => {
  it("names the top and bottom post, what moved, what next and cadence", () => {
    const posts = [
      post({ title: "Best one", views: 200, engaged: 30, published: ago(2) }),
      post({ title: "Worst one", views: 300, engaged: 3, format: "long", stage: "trust" }),
      post({ title: "Last week", views: 50, engaged: 2, published: ago(9) }),
      post({ title: "Last week too", views: 70, engaged: 3, published: ago(10, 9) }),
    ];
    const d = buildDigest({ now: NOW, posts, threadComments: { reddit: 12 } });
    const yt = d.get("youtube") ?? [];
    expect(yt.find((l) => l.kind === "top")).toMatchObject({ post: posts[0]?.id });
    expect(yt.find((l) => l.kind === "top")?.text).toContain('"Best one"');
    expect(yt.find((l) => l.kind === "bottom")?.text).toContain('"Worst one"');
    // Views per post: median 250 against 60.
    expect(yt.find((l) => l.kind === "moved")?.text).toBe(
      "Views per post up 317%: 250 against 60 the week before.",
    );
    expect(yt.find((l) => l.kind === "next")?.text).toMatch(
      /^Next: another Short for the reach stage around 15:00 UTC\. That shape leads with/,
    );
    expect(yt.filter((l) => l.kind === "cadence").map((l) => l.text)).toEqual([
      "YouTube long videos: 1 of 2 this week.",
      "YouTube Shorts: 1 of 5 this week.",
    ]);
    expect(d.get("reddit")?.find((l) => l.text.startsWith("Reddit comments"))?.text).toBe(
      "Reddit comments: 12 of 35 this week.",
    );
    // All platforms names the platform in each line.
    expect(d.get("all")?.find((l) => l.kind === "top")?.text).toContain("YouTube Short");
  });

  it("an empty week says so and still counts cadence", () => {
    const d = buildDigest({ now: NOW, posts: [] });
    expect(d.get("instagram")?.map((l) => l.text)).toEqual([
      "Nothing published this week.",
      "Instagram Reels: 0 of 7 this week.",
    ]);
  });
});

describe("withCounts", () => {
  it("adds the look's counts under insight names; an insight's own value wins", () => {
    const m = {
      id: "p1",
      views: 10,
      reactions: 2,
      comments: 1,
      shares: 0,
      asOf: "2026-10-12T00:00:00Z",
      fetchedWith: "api" as const,
    };
    const got = withCounts(m, {
      values: [
        { metric: "views", value: 12 },
        { metric: "saves", value: 3 },
      ],
      gaps: [{ metric: "retention", state: "needs_scope", why: "403" }],
      asOf: "2026-10-12T01:00:00Z",
    });
    expect(got.values).toEqual([
      { metric: "views", value: 12 },
      { metric: "saves", value: 3 },
      { metric: "likes", value: 2 },
      { metric: "comments", value: 1 },
      { metric: "shares", value: 0 },
    ]);
    expect(got.gaps).toHaveLength(1);
    expect(withCounts(m, null).values.map((v) => v.metric)).toEqual([
      "views",
      "likes",
      "comments",
      "shares",
    ]);
  });
});
