/**
 * Worst case for Research's board (WA-1405): 180 read pages over 30 channels, 12 picks, 5 patterns
 * (one an exception, known only by its words), posters as inline svg, some missing. Synthetic.
 */
import type {
  ReadPick,
  RunDocument,
  RunFinding,
  RunHit,
  RunView,
} from "../../modules/research/serve.js";
import { RESEARCH_VIEW } from "./research.js";

const ai = { from: "ai", by: "claude-code" };
const tool = { from: "tool", by: "runner" };

const HUES = [
  "#6d5bd0",
  "#e0a458",
  "#2f8f83",
  "#c4553f",
  "#3b6fb6",
  "#8a9a3a",
  "#b0487a",
  "#4d4d4d",
];

/** a poster drawn inline; `tall` for shorts and reels */
const poster = (i: number, tall: boolean) => {
  const a = HUES[i % HUES.length] as string;
  const b = HUES[(i * 3 + 1) % HUES.length] as string;
  const [w, h] = tall ? [360, 640] : [640, 360];
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w / 2}" cy="${h * 0.42}" r="${Math.min(w, h) * 0.18}" fill="#fff" fill-opacity=".3"/><rect x="${w * 0.2}" y="${h * 0.72}" width="${w * 0.6}" height="${h * 0.05}" rx="8" fill="#fff" fill-opacity=".4"/></svg>`,
  )}`;
};

type Site = "youtube" | "x" | "tiktok" | "instagram" | "reddit" | "web";
const CHANNELS: { site: Site; name: string }[] = [
  ...[
    "Maya Baker",
    "Crumb Theory",
    "The Night Baker",
    "Laminated",
    "Flour Ledger",
    "Proof Box",
  ].map((name) => ({ site: "youtube" as const, name })),
  ...[
    "crumbandco",
    "rackandroll",
    "sourdoughsally",
    "bakehouse_ops",
    "a_very_long_handle_that_never_wraps_well",
  ].map((name) => ({ site: "x" as const, name })),
  ...["ovenhours", "doughdiaries", "bunsonwheels"].map((name) => ({
    site: "tiktok" as const,
    name,
  })),
  ...["morningrack", "pastrycase", "loafandlatte"].map((name) => ({
    site: "instagram" as const,
    name,
  })),
  ...["r/Breadit", "r/Baking", "r/smallbusiness", "r/KitchenConfidential"].map((name) => ({
    site: "reddit" as const,
    name,
  })),
  ...[
    "bakers.example",
    "wholesale.example",
    "cafeowner.example",
    "foodbiz.example",
    "a-very-long-trade-publication-domain-name.example",
    "guild.example",
    "margins.example",
    "pastrynews.example",
    "shopfloor.example",
  ].map((name) => ({ site: "web" as const, name })),
];

const TITLES = [
  "How I landed 12 cafe accounts",
  "Wholesale pricing: what cafes really pay per dozen",
  "We rolled the morning rack into a cafe we'd never pitched",
  "The one sample box that got us into nine coffee shops in a single week, and the follow-up email that closed six of them",
  "Delivery routes for a two-person bakery",
  "Why our first wholesale buyer dropped us after a month",
  "Croissant margins at 60% of retail",
  "Cold walk-ins vs. warm intros",
  "A day of wholesale bakes, 3 a.m. to noon",
  "Standing orders: how to ask",
];

const URL_OF: Record<Site, (c: string, i: number) => string> = {
  youtube: (_c, i) => `https://www.youtube.com/watch?v=vid${String(i).padStart(8, "0")}`,
  x: (c, i) => `https://x.com/${c}/status/18900000000${String(i).padStart(8, "0")}`,
  tiktok: (c, i) => `https://www.tiktok.com/@${c}/video/74000000${String(i).padStart(8, "0")}`,
  instagram: (_c, i) => `https://www.instagram.com/reel/Cx${String(i).padStart(9, "0")}/`,
  reddit: (c, i) => `https://www.reddit.com/${c}/comments/t${i}/thread_${i}/`,
  web: (c, i) => `https://${c}/guide-${i}`,
};

const MEDIA: Record<Site, string> = {
  youtube: "video",
  x: "video",
  tiktok: "video",
  instagram: "video",
  reddit: "text",
  web: "text",
};

const N = 180;
const PICKS = 12;

const hits: RunHit[] = [];
const documents: RunDocument[] = [];
const pages: (ReadPick & { site: Site })[] = [];

for (let i = 0; i < N; i++) {
  const ch = CHANNELS[(i * 7) % CHANNELS.length] as (typeof CHANNELS)[number];
  const url = URL_OF[ch.site](ch.name, i);
  const title = i % 11 === 5 ? undefined : (TITLES[i % TITLES.length] as string);
  const video = MEDIA[ch.site] === "video";
  const views = video ? Math.round(1_500 * 1.9 ** (i % 17)) : undefined;
  const multiple = Number(((i * 37) % 900) / 10 + 0.4).toFixed(1);
  const hit = `bh${i}`;
  const doc = `bd${i}`;
  const speaker = {
    value: ch.site === "web" ? "company" : ch.site === "reddit" ? "forum" : "person",
    by: "agent",
  } as const;
  const evidence = { value: i % 4 ? "account" : "analysis", by: "agent" } as const;
  // absent, never undefined (exactOptionalPropertyTypes)
  const named = {
    ...(title ? { title } : {}),
    ...(ch.site === "web" ? {} : { channel: ch.name }),
  };
  hits.push({
    id: hit,
    round: 1 + (i % 3),
    url,
    ...named,
    sources: [ch.site === "web" ? "exa" : ch.site],
    queries: ["q1"],
    call: { verdict: "keep", why: "on the ask", ...ai },
    document: doc,
    speaker,
    evidence,
    ...tool,
  });
  documents.push({
    id: doc,
    hit,
    url,
    ...named,
    media: MEDIA[ch.site],
    // picks run short and new, the rest longer and older: the board's splits have a gap to find
    ...(video ? { length: i < PICKS ? 18 + ((i * 13) % 40) : 30 + ((i * 47) % 600) } : {}),
    date: new Date(Date.UTC(2026, 10, 10) - (i < PICKS ? i : 5 + ((i * 11) % 200)) * 86_400_000)
      .toISOString()
      .slice(0, 10),
    // every ninth page has no picture: the tile falls back
    ...(i % 9 === 4 ? {} : { image: poster(i, ch.site === "tiktok" || ch.site === "instagram") }),
    chars: 1_200 + i * 53,
    speaker,
    evidence,
    verdict: { quality: i % 5 ? "rich" : "thin" },
    ...tool,
  });
  pages.push({
    site: ch.site,
    id: doc,
    url,
    ...named,
    ...(views
      ? {
          metrics: { views, likes: Math.round(views / 31), comments: Math.round(views / 900) },
        }
      : {}),
    // as on real runs: picks and about 1 in 10 others carry a multiple
    ...(views && (i < PICKS || i % 10 === 3)
      ? {
          score: {
            count: "views",
            multiple: Number(multiple),
            band: Number(multiple) >= 50 ? "50x+" : "10-50x",
            n: 30,
            base: 7_000,
          },
        }
      : {}),
    kept: i < PICKS ? 4 : i % 6,
    dropped: i % 3,
    quality: i % 5 ? "rich" : "thin",
    why: "",
    by: "claude-code",
  });
}

const WHY = [
  "The clearest account of a first buyer in the run, on camera, step by step.",
  "Real prices per dozen from three bakers, with the cafe's side.",
  "A one-take cart demo: the baker rolls a rack into a cafe and the owner orders on the spot, no voice-over, 48 seconds. Copy first: the single take and the order on camera.",
  "The only source that names a lost account and why.",
];

const readList: ReadPick[] = pages.slice(0, PICKS).map(({ site: _s, ...p }, i) => ({
  ...p,
  ...(i < 10 ? { rank: i + 1 } : {}),
  why: WHY[i % WHY.length] as string,
}));
const unpicked = pages.slice(PICKS).map(({ site: _s, why: _w, by: _b, ...p }) => p);

// 48 kept findings on the 12 picks
const findings: RunFinding[] = readList.flatMap((p, i) =>
  [0, 1, 2, 3].map((k) => ({
    id: `bf${i * 4 + k}`,
    round: 1,
    document: p.id,
    evidence: { value: "account", by: "agent" },
    text: `Finding ${k + 1} from ${p.title ?? p.channel ?? "a page"}.`,
    quote: "a quote",
    kept: true,
    checks: [],
    ...ai,
  })),
);

const pattern = (id: string, text: string, picks: number[]) => ({
  id,
  round: 1,
  text,
  findings: picks.flatMap((i) => [`bf${i * 4}`, `bf${i * 4 + 1}`]),
  sources: picks.length,
  speakers: {},
  evidence: {},
  echo: false,
  unchecked: [],
  cites: [],
});

export const BOARD_VIEW: RunView = {
  ...RESEARCH_VIEW,
  run: "r1",
  brief: {
    ask: { text: "How do small bakeries find wholesale buyers?" },
    readList,
    unpicked,
    patterns: [
      pattern("pt1", "Walk in with samples; the first order comes on the spot.", [0, 2, 3, 7, 9]),
      pattern("pt2", "Price at about 60% of retail, per dozen.", [1, 6]),
      pattern(
        "pt3",
        "A standing weekly order beats one-off orders, because the cafe plans its case around it and the baker plans the bake around the cafe, so both sides keep it going for months.",
        [4, 5, 8, 10, 11],
      ),
      pattern("pt4", "Short routes: every buyer inside a 20-minute drive.", [4, 9]),
      pattern("pt5", "Exception: one baker lost the account by going under price.", [5]),
    ],
  },
  hits,
  documents,
  findings,
};
