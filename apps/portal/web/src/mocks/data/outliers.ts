/** Canon › Outliers and Studio › Inspiration: made-up creators and posts, worst case included. */

import type { FeedPage, FeedPersonShown, FeedPost } from "@wren/research/canon-console";
import { formatOf } from "@wren/research/feed-format";

/** each preset's least multiple (server: `FEED_PRESETS`) */
const PRESET_MIN: Record<string, number> = {
  breakouts: 5,
  "hidden-gems": 10,
  "viral-now": 10,
  "all-time-greats": 10,
};

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

/** a 4:5 picture drawn inline: no network in a story */
const shot = (a: string, b: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="400" height="500" fill="url(#g)"/><circle cx="200" cy="210" r="70" fill="#fff" fill-opacity=".35"/><rect x="90" y="330" width="220" height="22" rx="11" fill="#fff" fill-opacity=".4"/></svg>`,
  )}`;

/** a round face drawn inline */
const face = (a: string, b: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${a}"/><circle cx="48" cy="38" r="18" fill="${b}"/><ellipse cx="48" cy="92" rx="34" ry="28" fill="${b}"/></svg>`,
  )}`;

type RowIn = Partial<FeedPost> & Pick<FeedPost, "ref" | "handle" | "multiple">;
const row = (o: RowIn): FeedPost => {
  const r = base({
    personId: o.creatorId ?? 1,
    person: o.name ?? `@${o.handle}`,
    ...o,
  });
  // the usual draw the server stores: the count over the multiple
  const n = r.counts[r.scoreCount as "views" | "likes"];
  return {
    ...r,
    // one picture serves tile and detail here
    full: "full" in o ? (o.full ?? null) : r.src,
    baseline:
      "baseline" in o ? (o.baseline ?? null) : r.multiple && n ? Math.round(n / r.multiple) : null,
  };
};
const base = (o: RowIn & Pick<FeedPost, "personId" | "person">): FeedPost => ({
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
  counts: { views: 412_000, likes: 9_800, comments: 310 },
  scoreCount: "views",
  band: (o.multiple ?? 0) >= 50 ? "50x+" : (o.multiple ?? 0) >= 10 ? "10-50x" : "5-10x",
  rank: null,
  likesMultiple: null,
  likesBand: null,
  likesRank: null,
  baselineN: 30,
  baseline: null,
  likesBaseline: null,
  creatorPosts: null,
  record: null,
  picture: null,
  pictureSmall: null,
  pictureLink: null,
  src: shot("#6d5bd0", "#e0a458"),
  full: null,
  video: null,
  seconds: null,
  videoSrc: null,
  ...o,
});

const LONG_TEXT = [
  "Twelve things I learned editing 400 videos for other creators this year.",
  "1. The first frame is a thumbnail. Treat it like one.",
  "2. Cut the breath before every sentence, not after.",
  "3. A J-cut hides a jump better than a zoom ever will.",
  "4. Music under talk sits 18 dB down. Lower than you think.",
  "5. Captions in the top third get covered by the app's own buttons.",
  "6. A punch-in every beat is tiring. Every other beat is a rhythm.",
  "7. Silence trims save a minute a video. Watch time follows.",
  "8. B-roll that shows the thing beats B-roll that shows a vibe.",
  "9. Colour last. Story first, then sound, then picture.",
  "10. Export twice: once for the phone, once for the TV.",
  "11. The end card starts 20 seconds early or nobody sees it.",
  "12. Nobody notices a good edit. Everybody notices a bad one.",
].join("\n");

export const OUTLIER_ROWS: FeedPost[] = [
  row({
    ref: "FakeVid0001",
    seconds: 754,
    handle: "cutsbymaya",
    name: "Maya Cuts",
    multiple: 312.4,
    rank: 1,
    likesMultiple: 41,
    likesBand: "10-50x",
    postedAt: daysAgo(6),
    src: shot("#d0475b", "#f2b366"),
  }),
  row({
    ref: "FakeVid0002",
    seconds: 3725,
    handle: "a_very_long_handle_for_a_creator_who_never_stops",
    creatorId: 2,
    name: "Bartholomew Featherstonehaugh-Montgomery the Third",
    multiple: 48.25,
    postedAt: daysAgo(9),
    title:
      "The one edit that tripled my retention: J-cuts, L-cuts, the punch-in on every beat, the silence trim, and why the first three seconds carry the whole video — a 40-minute teardown of twelve channels",
    followers: 2_480_000,
    niches: ["video-editing", "youtube-growth"],
    counts: { views: 18_200_000, likes: 640_000, comments: 12_400 },
    src: shot("#2b6cb0", "#63b3ed"),
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
    counts: { views: 88_000, likes: 6_400, comments: 212, shares: 1_900, saves: 3_050 },
    likesMultiple: 9.4,
    likesBand: "5-10x",
    rank: 4,
    // the link expired: the card falls back to its text
    src: "/missing/FakeReel003.jpg",
  }),
  row({
    ref: "FakePost004",
    platform: "linkedin",
    url: "https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000004/",
    kind: "post",
    handle: "ops-notes",
    creatorId: 4,
    multiple: 5.1,
    postedAt: daysAgo(12),
    title: null,
    text: "We stopped sending weekly reports. Here is what we send instead.",
    scoreCount: "likes",
    counts: { likes: 2_310, comments: 140 },
    followers: 9_100,
    niches: ["automation"],
    record: "linkedin-FakePost004",
    baseline: null,
    src: null,
  }),
  row({
    ref: "1890000000000000005",
    platform: "x",
    url: "https://x.com/agentsdaily/status/1890000000000000005",
    kind: "post",
    handle: "agentsdaily",
    name: "Agents Daily",
    creatorId: 5,
    multiple: 2.3,
    postedAt: daysAgo(0.2),
    title: null,
    text: "Claude Code + a folder of markdown files is the best CRM I have used. Here's the setup.",
    scoreCount: "views",
    counts: { views: 41_000, likes: 820, comments: 64 },
    followers: 31_000,
    niches: ["automation"],
    src: null,
  }),
  row({
    ref: "1890000000000000006",
    platform: "x",
    url: "https://x.com/agentsdaily/status/1890000000000000006",
    kind: "post",
    handle: "agentsdaily",
    name: "Agents Daily",
    creatorId: 5,
    multiple: 1.4,
    postedAt: daysAgo(1),
    title: null,
    text: "My agent's morning: read the inbox, file the leads, draft three replies. Screenshot of the run 👇",
    counts: { views: 25_000, likes: 300 },
    followers: 31_000,
    niches: ["automation"],
    src: shot("#1f2937", "#4b5563"),
    video: "cache/posts/x/1890000000000000006.mp4",
    videoSrc: "/variants/cut-1.mp4",
  }),
  row({
    ref: "FakeReel007",
    platform: "instagram",
    url: "https://www.instagram.com/reel/FakeReel007/",
    kind: "reel",
    handle: "cutsbymaya",
    name: "Maya Cuts",
    // Maya's second account: one person, two platforms
    creatorId: 6,
    personId: 1,
    person: "Maya Cuts",
    followers: 52_000,
    multiple: null,
    band: null,
    postedAt: daysAgo(0.5),
    title: null,
    // one long first line: the tile keeps its first sentence
    text: "Day 3 of editing one reel a day and today it is the hook: the cut I almost threw away. It ended up doing 10x my usual, so here is the timeline frame by frame.\n\n#editing #reels",
    counts: { views: 3_100, likes: 140 },
    src: shot("#38a169", "#9ae6b4"),
    // copied: the tile plays it on hover, the panel on open (synthetic, `.storybook/public/outliers`)
    video: "cache/posts/instagram/FakeReel007.mp4",
    videoSrc: "/outliers/reel.mp4",
  }),
  row({
    ref: "1890000000000000008",
    platform: "x",
    url: "https://x.com/ops-notes/status/1890000000000000008",
    kind: "post",
    handle: "ops-notes",
    creatorId: 7,
    personId: 4,
    person: "@ops-notes",
    multiple: 3.2,
    postedAt: daysAgo(2),
    title: null,
    text: LONG_TEXT,
    counts: { views: 9_800, likes: 410 },
    followers: 9_100,
    niches: ["automation"],
    src: null,
  }),
];

const account = (
  id: number,
  platform: string,
  handle: string,
  followers: number | null,
  name: string | null = null,
) => ({ id, platform, handle, name, url: null, picture: null, followers });

/** the strip's people: Maya on two platforms, a long name with no face, a one-letter handle */
export const PEOPLE: FeedPersonShown[] = [
  {
    id: 1,
    name: "Maya Cuts",
    n: 118,
    src: face("#f2b366", "#8a3b2e"),
    accounts: [
      account(6, "instagram", "cutsbymaya", 52_000),
      account(1, "youtube", "cutsbymaya", 18_400),
    ],
  },
  {
    id: 2,
    name: "Bartholomew Featherstonehaugh-Montgomery the Third",
    n: 41,
    src: null,
    accounts: [
      account(2, "youtube", "a_very_long_handle_for_a_creator_who_never_stops", 2_480_000),
    ],
  },
  { id: 3, name: "@e", n: 12, src: null, accounts: [account(3, "instagram", "e", null)] },
  {
    id: 4,
    name: "@ops-notes",
    n: 30,
    src: face("#cbd5e1", "#334155"),
    accounts: [account(4, "linkedin", "ops-notes", 9_100), account(7, "x", "ops-notes", 9_100)],
  },
  {
    id: 5,
    name: "Agents Daily",
    n: 41,
    src: face("#1f2937", "#9ca3af"),
    accounts: [account(5, "x", "agentsdaily", 31_000)],
  },
];

export const OUTLIERS: FeedPage = {
  creators: 5,
  scored: 212,
  niches: [
    { value: "video-editing", n: 5 },
    { value: "automation", n: 2 },
    { value: "youtube-growth", n: 1 },
  ],
  platforms: [
    { value: "youtube", n: 4 },
    { value: "instagram", n: 2 },
    { value: "x", n: 2 },
    { value: "linkedin", n: 1 },
  ],
  kinds: [
    { value: "post", n: 140 },
    { value: "video", n: 52 },
    { value: "reel", n: 20 },
  ],
  people: PEOPLE,
  rows: OUTLIER_ROWS,
};

export const OUTLIERS_NONE_TRACKED: FeedPage = {
  creators: 0,
  scored: 0,
  niches: [],
  platforms: [],
  kinds: [],
  people: [],
  rows: [],
};
export const OUTLIERS_NONE_SCORED: FeedPage = {
  ...OUTLIERS,
  scored: 0,
  rows: OUTLIER_ROWS.filter((r) => r.multiple == null),
};

const has = (xs: unknown, v: string | number) =>
  !Array.isArray(xs) || !xs.length || xs.map(String).includes(String(v));
const time = (r: FeedPost) => (r.postedAt ? Date.parse(r.postedAt) : 0);
/** the sort's key, high first, as the server's `sort_key` */
const keyOf = (r: FeedPost, sort: unknown) =>
  sort === "new"
    ? time(r)
    : sort === "views" || sort === "likes"
      ? (r.counts[sort] ?? -1)
      : sort === "reach"
        ? r.counts.views != null && r.followers
          ? r.counts.views / r.followers
          : -1
        : (r.multiple ?? -1);
/** grouped: each person's (or platform's) top 12, sections by their best post */
function grouped(rows: FeedPost[], sort: unknown, group: unknown): FeedPost[] {
  const by = new Map<string, FeedPost[]>();
  for (const r of rows) {
    const k = group === "platform" ? r.platform : String(r.personId);
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.values()]
    .sort((a, b) => keyOf(b[0] as FeedPost, sort) - keyOf(a[0] as FeedPost, sort))
    .flatMap((g) => g.slice(0, 12).map((r) => ({ ...r, creatorPosts: g.length })));
}

/** `canon/feed`, filtered, sorted and grouped as the server does. */
export const OUTLIER_ANSWERS = {
  "canon/feed": (b: Record<string, unknown>): FeedPage => {
    const preset = typeof b.preset === "string" ? PRESET_MIN[b.preset] : undefined;
    const min = Math.max(preset ?? 0, Number(b.min ?? 0));
    const rows = OUTLIER_ROWS.filter(
      (r) =>
        (b.all && !preset ? true : r.multiple != null) &&
        (!min || (r.multiple ?? 0) >= min) &&
        (!Array.isArray(b.niches) || !b.niches.length || r.niches.some((n) => has(b.niches, n))) &&
        has(b.platforms, r.platform) &&
        has(b.kinds, r.kind) &&
        (!b.format || formatOf(r.platform, r.kind) === b.format) &&
        has(b.people, r.personId),
    ).sort(
      (x, y) =>
        keyOf(y, b.sort) - keyOf(x, b.sort) ||
        (b.sort === "new" ? (y.multiple ?? -1) - (x.multiple ?? -1) : time(y) - time(x)),
    );
    return { ...OUTLIERS, rows: b.group ? grouped(rows, b.sort, b.group) : rows };
  },
};
