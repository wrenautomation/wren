/** Variants' fake answers: a video batch and a copy batch to pick, a subject, the catalog. Synthetic. */
import type { Answers } from "../api.js";
import { ago } from "./shell.js";

/** Three cuts of one 12 s test footage (its counter shows the footage second); spans match the files. */
const SPANS = [
  [
    { s: 0, e: 4 },
    { s: 6, e: 10 },
  ],
  [{ s: 2, e: 8 }],
  [
    { s: 9, e: 10.5 },
    { s: 0, e: 5 },
  ],
];
const clip = (i: number) => ({
  mediaUrl: `/variants/cut-${i}.mp4`,
  posterUrl: `/variants/cut-${i}.jpg`,
  source: { ref: "studio:9", spans: SPANS[i - 1] },
});
const base = { media: null, poster: null, keptAt: null, notes: [] as unknown[] };

const VIDEO = {
  batch: { id: 7, createdAt: ago(0.1), note: null },
  subject: {
    id: 2,
    slug: "promo-cut",
    name: "Promo cut, 30s",
    kind: "video",
    brief: "Open on the result, not the setup. Captions on every line.",
  },
  samples: [
    {
      ...base,
      id: 31,
      body: null,
      ...clip(1),
      verdict: "good",
      notes: [
        {
          id: 1,
          anchor: { type: "time", start: 1.2, end: 2.4 },
          tone: "good",
          text: "This pace works",
        },
      ],
    },
    { ...base, id: 32, body: null, ...clip(2), verdict: null },
    {
      ...base,
      id: 33,
      body: null,
      ...clip(3),
      verdict: "bad",
      notes: [
        {
          id: 2,
          anchor: { type: "time", start: 0.4, box: { x: 0.1, y: 0.15, w: 0.4, h: 0.35 } },
          tone: "bad",
          text: "Caption covers the face",
        },
      ],
    },
  ],
};

/** Three scenes that run code, each a link (same origin here; a preview deploy in prod). */
const scene = (i: number) => ({
  body: null,
  mediaUrl: `/variants/scene-${i}.html`,
  posterUrl: `/variants/scene-${i}.svg`,
});
const PAGE = {
  batch: { id: 9, createdAt: ago(0.05), note: null },
  subject: {
    id: 3,
    slug: "hero-background",
    name: "Hero background",
    kind: "page",
    brief: "A scene that moves with scroll. Calm at rest.",
  },
  samples: [
    {
      ...base,
      id: 51,
      ...scene(1),
      verdict: "good",
      notes: [
        {
          id: 4,
          anchor: { type: "box", x: 0.3, y: 0.25, w: 0.4, h: 0.4 },
          tone: "good",
          text: "The centre reads well",
        },
      ],
    },
    { ...base, id: 52, ...scene(2), verdict: null },
    { ...base, id: 53, ...scene(3), verdict: null },
  ],
};

const COPY = {
  batch: { id: 8, createdAt: ago(0.3), note: null },
  subject: {
    id: 1,
    slug: "opener",
    name: "Opener email, small bakeries",
    kind: "text",
    brief: null,
  },
  samples: [
    {
      ...base,
      id: 41,
      verdict: null,
      mediaUrl: null,
      posterUrl: null,
      body: "Saw your sourdough at the Saturday market.\n\nOne idea: a standing order for two cafes near you.\n\nWorth a look?",
    },
    {
      ...base,
      id: 42,
      verdict: "amazing",
      mediaUrl: null,
      posterUrl: null,
      body: "Two cafes on Main Street buy pastries from outside bakers.\n\nI can introduce you this week.",
      notes: [
        {
          id: 3,
          anchor: { type: "quote", exact: "I can introduce you this week." },
          tone: "good",
          text: "Concrete",
        },
      ],
    },
    {
      ...base,
      id: 43,
      verdict: "bad",
      mediaUrl: null,
      posterUrl: null,
      body: "Hi there,\n\nHope you're well. Quick question about your wholesale plans?",
    },
    {
      ...base,
      id: 44,
      verdict: null,
      mediaUrl: null,
      posterUrl: null,
      body: "Your croissants sold out by ten last week.\n\nWant more buyers like that, every week?",
    },
  ],
};

/** Email live rows: one sample's rates per segment, Wilson range and P(best) as the server sends them. */
const rate = (wins: number, of: number, lo: number, hi: number, pBest: number | null) => ({
  wins,
  of,
  rate: of ? wins / of : null,
  lo,
  hi,
  pBest,
});
const mail = (
  sample: number,
  segment: string,
  sends: number,
  replies: [number, number, number, number],
  booked: [number, number, number, number],
) => ({
  sample,
  channel: "email",
  segment,
  ships: 1,
  totals: { sends, replies: replies[0], booked: booked[0] },
  means: {},
  rates: {
    replies: rate(replies[0], sends, replies[1], replies[2], replies[3]),
    booked: rate(booked[0], sends, booked[1], booked[2], booked[3]),
  },
});
const LIVE = {
  segments: ["all", "niche:bakeries", "niche:cafes"],
  rows: [
    mail(22, "all", 420, [19, 0.029, 0.07, 0.81], [4, 0.0037, 0.024, 0.62]),
    mail(24, "all", 410, [11, 0.015, 0.047, 0.17], [2, 0.0013, 0.017, 0.31]),
    mail(26, "all", 380, [6, 0.0073, 0.034, 0.02], [1, 0.0005, 0.015, 0.07]),
    mail(22, "niche:bakeries", 210, [13, 0.036, 0.1, 0.88], [3, 0.0049, 0.041, 0.6]),
    mail(24, "niche:bakeries", 200, [5, 0.011, 0.057, 0.1], [1, 0.0009, 0.028, 0.3]),
    mail(26, "niche:bakeries", 190, [3, 0.0054, 0.045, 0.02], [0, 0, 0.02, 0.1]),
    mail(22, "niche:cafes", 210, [6, 0.013, 0.061, 0.52], [1, 0.0008, 0.026, 0.4]),
    mail(24, "niche:cafes", 210, [6, 0.013, 0.061, 0.44], [1, 0.0008, 0.026, 0.4]),
    mail(26, "niche:cafes", 190, [3, 0.0054, 0.045, 0.04], [1, 0.0009, 0.029, 0.2]),
  ],
  rates: {
    post: [{ name: "engaged", wins: "engaged", of: "views" }],
    site: [{ name: "forms", wins: "form", of: "view" }],
    email: [
      { name: "replies", wins: "replies", of: "sends" },
      { name: "booked", wins: "booked", of: "sends" },
    ],
  },
};

const SUBJECT = {
  subject: { ...COPY.subject, state: "open", samples: 12, kept: 1, toPick: 4 },
  leaders: [
    { sample: 22, strength: 2.4, se: 0.6 },
    { sample: 24, strength: 1.1, se: 0.5 },
  ],
  live: LIVE,
  guides: [
    {
      id: 1,
      text: "Name a real place in line one",
      source: "william",
      state: "testing",
      subjectId: 1,
      kind: null,
      effect: { with: { good: 5, n: 7 }, without: { good: 2, n: 9 }, diff: 0.49, early: true },
    },
    {
      id: 2,
      text: "No greetings",
      source: "sop",
      state: "locked",
      subjectId: null,
      kind: "text",
      effect: { with: { good: 0, n: 0 }, without: { good: 7, n: 16 }, diff: null, early: true },
    },
  ],
  batches: [
    {
      id: 5,
      why: "Six openers: question vs claim",
      note: "Claims win. Shorter.",
      state: "closed",
      createdAt: ago(30),
      goodRate: 0.33,
      samples: [21, 22, 23, 24, 25, 26].map((id, i) => ({
        ...base,
        id,
        body: "",
        mediaUrl: null,
        posterUrl: null,
        change: "claim",
        verdict: i === 1 ? "amazing" : i === 3 ? "good" : i === 5 ? "bad" : null,
      })),
    },
    {
      id: 6,
      why: "Claims only, named places",
      note: null,
      state: "closed",
      createdAt: ago(5),
      goodRate: 0.5,
      samples: [27, 28, 29, 30].map((id, i) => ({
        ...base,
        id,
        body: "",
        mediaUrl: null,
        posterUrl: null,
        change: "place",
        verdict: i < 2 ? "good" : null,
      })),
    },
    {
      ...COPY.batch,
      why: "Named places plus a next step",
      state: "open",
      goodRate: null,
      samples: [],
    },
  ],
};

/** Every batch, newest first: the three open ones blind, then closed ones with calls and ideas. */
const openRow = (o: typeof VIDEO | typeof PAGE | typeof COPY) => ({
  id: o.batch.id,
  why: null,
  note: null,
  state: "open",
  createdAt: o.batch.createdAt,
  goodRate: null,
  subject: o.subject,
  samples: o.samples.map((x) => ({ ...x, verdict: null, notes: [], change: null })),
});
const BATCHES = [
  openRow(PAGE),
  openRow(VIDEO),
  openRow(COPY),
  {
    id: 6,
    why: "Claims only, each opener names a real place",
    note: "The place works. Cut the question at the end.",
    state: "closed",
    createdAt: ago(5),
    goodRate: 0.5,
    subject: COPY.subject,
    samples: COPY.samples.map((x, i) => ({
      ...x,
      id: 27 + i,
      change:
        ["Market stall in line one", "Two named cafes", "Greeting first", "A sold-out fact"][i] ??
        null,
    })),
  },
  {
    id: 4,
    why: "Three scenes: depth, grain, slow light",
    note: "Calm at rest is right. More contrast at night.",
    state: "closed",
    createdAt: ago(9),
    goodRate: 0.67,
    subject: PAGE.subject,
    samples: PAGE.samples.map((x, i) => ({
      ...x,
      id: 47 + i,
      verdict: (["amazing", "good", "bad"] as const)[i],
      keptAt: i === 0 ? ago(9) : null,
      change:
        ["Parallax depth on scroll", "Film grain over a flat field", "A slow light sweep"][i] ??
        null,
    })),
  },
  {
    id: 3,
    why: "Open on the result vs the setup",
    note: "Result first. Captions too low.",
    state: "closed",
    createdAt: ago(14),
    goodRate: 0.33,
    subject: VIDEO.subject,
    samples: VIDEO.samples.map((x, i) => ({
      ...x,
      id: 34 + i,
      change: ["Result in the first second", "Setup first", "Result, then a fast recap"][i] ?? null,
    })),
  },
  {
    id: 5,
    why: "Six openers: question vs claim",
    note: "Claims win. Shorter.",
    state: "closed",
    createdAt: ago(30),
    goodRate: 0.33,
    subject: COPY.subject,
    samples: [
      "Do you sell to cafes yet?",
      "Your rye sells out by noon.",
      "Want more wholesale buyers?",
      "Three cafes near you buy outside pastries.",
      "Ever thought about wholesale?",
      "Hi, quick question for you.",
    ].map((body, i) => ({
      ...base,
      id: 21 + i,
      body,
      mediaUrl: null,
      posterUrl: null,
      change: i % 2 ? "claim" : "question",
      verdict: i === 1 ? "amazing" : i === 3 ? "good" : i === 5 ? "bad" : null,
    })),
  },
].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

export const VARIANTS_ANSWERS: Answers = {
  "variants/batches": BATCHES,
  "variants/queue": [VIDEO, PAGE, COPY],
  "variants/subjects": [
    SUBJECT.subject,
    { ...VIDEO.subject, state: "open", samples: 3, kept: 0, toPick: 3 },
  ],
  "variants/subject": SUBJECT,
  "variants/judge": (b: Record<string, unknown>) => ({ id: b.sample, verdict: b.verdict }),
  "variants/note": (b: Record<string, unknown>) => ({ id: Math.floor(Math.random() * 1e6), ...b }),
  "variants/unnote": { done: [] },
  "variants/keep": { id: 0, keptAt: null },
  "variants/close": { id: 7, subjectId: 2 },
};
