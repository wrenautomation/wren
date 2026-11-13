/** Canon › Outliers: made-up creators and posts, worst case included. */
import type { FeedPage } from "@wren/research/canon-console";
import type { FeedRow } from "@wren/research/creators";

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

const row = (o: Partial<FeedRow> & Pick<FeedRow, "ref" | "handle" | "multiple">): FeedRow => ({
  platform: "youtube",
  url: `https://www.youtube.com/watch?v=${o.ref}`,
  kind: "video",
  postedAt: daysAgo(4),
  title: "How I cut a talking-head video in 20 minutes",
  text: null,
  creatorId: 1,
  name: null,
  niches: ["video-editing"],
  followers: 18_400,
  counts: { views: 412_000, likes: 9_800 },
  scoreCount: "views",
  band: (o.multiple ?? 0) >= 50 ? "50x+" : (o.multiple ?? 0) >= 10 ? "10-50x" : "5-10x",
  rank: null,
  baselineN: 30,
  record: null,
  ...o,
});

export const OUTLIER_ROWS: FeedRow[] = [
  row({ ref: "FakeVid0001", handle: "cutsbymaya", name: "Maya Cuts", multiple: 312.4 }),
  row({
    ref: "FakeVid0002",
    handle: "a_very_long_handle_for_a_creator_who_never_stops",
    creatorId: 2,
    name: "Bartholomew Featherstonehaugh-Montgomery the Third",
    multiple: 48.25,
    title:
      "The one edit that tripled my retention: J-cuts, L-cuts, the punch-in on every beat, the silence trim, and why the first three seconds carry the whole video — a 40-minute teardown of twelve channels",
    followers: 2_480_000,
    niches: ["video-editing", "youtube-growth"],
    counts: { views: 18_200_000 },
  }),
  row({
    ref: "FakeReel003",
    platform: "instagram",
    url: "https://www.instagram.com/reel/FakeReel003/",
    kind: "reel",
    handle: "e",
    creatorId: 3,
    multiple: 12,
    title: null,
    text: "編集のコツ 🎬✂️ three cuts that hold a viewer, with the timeline on screen",
    followers: null,
    postedAt: null,
    counts: { views: 88_000 },
  }),
  row({
    ref: "FakePost004",
    platform: "linkedin",
    url: "https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000004/",
    kind: "post",
    handle: "ops-notes",
    creatorId: 4,
    multiple: 5.1,
    title: null,
    text: "We stopped sending weekly reports. Here is what we send instead.",
    scoreCount: "likes",
    counts: { likes: 2_310, comments: 140 },
    followers: 9_100,
    niches: ["automation"],
    record: "linkedin-FakePost004",
  }),
];

export const OUTLIERS: FeedPage = {
  creators: 7,
  scored: 212,
  niches: [
    { value: "video-editing", n: 5 },
    { value: "automation", n: 2 },
    { value: "youtube-growth", n: 1 },
  ],
  platforms: [
    { value: "youtube", n: 4 },
    { value: "instagram", n: 2 },
    { value: "linkedin", n: 1 },
  ],
  rows: OUTLIER_ROWS,
};

export const OUTLIERS_NONE_TRACKED: FeedPage = {
  creators: 0,
  scored: 0,
  niches: [],
  platforms: [],
  rows: [],
};
export const OUTLIERS_NONE_SCORED: FeedPage = { ...OUTLIERS, scored: 0, rows: [] };

const MIN: Record<string, number> = {
  breakouts: 5,
  "hidden-gems": 10,
  "viral-now": 10,
  "all-time-greats": 10,
};

/** `canon/feed`, filtered as the server filters (presets by multiple only). */
export const OUTLIER_ANSWERS = {
  "canon/feed": (b: Record<string, unknown>): FeedPage => ({
    ...OUTLIERS,
    rows: OUTLIER_ROWS.filter(
      (r) =>
        (!b.niche || r.niches.includes(String(b.niche))) &&
        (!b.platform || r.platform === b.platform) &&
        (!b.kind || r.kind === b.kind) &&
        (!b.preset || (r.multiple ?? 0) >= (MIN[String(b.preset)] ?? 0)),
    ),
  }),
};
