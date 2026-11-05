/** Variants' fake answers: a video batch and a copy batch to pick, a subject, the catalog. Synthetic. */
import type { Answers } from "../api.js";
import { ago } from "./shell.js";

const clip = (i: number) => ({
  mediaUrl: `/variants/cut-${i}.mp4`,
  posterUrl: `/variants/cut-${i}.jpg`,
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

const SUBJECT = {
  subject: { ...COPY.subject, state: "open", samples: 12, kept: 1, toPick: 4 },
  leaders: [{ sample: 22, strength: 2.4, se: 0.6 }],
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

export const VARIANTS_ANSWERS: Answers = {
  "variants/queue": [VIDEO, COPY],
  "variants/subjects": [
    SUBJECT.subject,
    { ...VIDEO.subject, state: "open", samples: 3, kept: 0, toPick: 3 },
  ],
  "variants/subject": SUBJECT,
  "variants/catalog": [{ sample: { ...COPY.samples[1], notes: [] }, subject: COPY.subject }],
  "variants/judge": (b: Record<string, unknown>) => ({ id: b.sample, verdict: b.verdict }),
  "variants/note": (b: Record<string, unknown>) => ({ id: Math.floor(Math.random() * 1e6), ...b }),
  "variants/unnote": { done: [] },
  "variants/keep": { id: 0, keptAt: null },
  "variants/close": { id: 7, subjectId: 2 },
};
