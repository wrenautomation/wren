/**
 * Canon › References answers. Synthetic: made-up creators, notes and rule lines. The list answer
 * filters like the server (`canon-console.ts`): platform, provider, tag, q, noted, `after`.
 */
import type {
  AddRow,
  canonConsoleApi,
  Reference,
  ReferenceWhole,
} from "@wren/research/canon-console";
import { serve, UPLOAD_HOST } from "../api.js";
import { ago } from "./shell.js";

const LONG_NOTE =
  "the editing here is insane, every cut lands on the kick drum and the captions pop in one word at a time so you never read ahead of him. " +
  "steal the zoom on the punchline: it pushes in about 10% over 4 frames, then snaps back on the next beat. " +
  "also the b-roll never sits longer than a second and a half, and the hook is a question he answers in the last line, which makes people watch twice. " +
  "try this on the next short about pricing, the one with the whiteboard, and keep the music under the voice the whole time.";

const day = (d: number) => ago(d).slice(0, 10);
const human = { kind: "human", who: "william" };
const agent = { kind: "agent", who: "feed-reader" };

const row = (i: number, r: Partial<Reference>): Reference => ({
  id: `instagram-Fake${i}`,
  title: `Reference ${i}`,
  url: `https://www.instagram.com/reel/Fake${i}/`,
  platform: "instagram",
  kind: "reel",
  handle: `creator.${i}`,
  length: 20 + i,
  provider: agent,
  note: null,
  tags: [],
  saved: day(i),
  posted: day(i + 30),
  stats: null,
  poster: `/variants/cut-${(i % 3) + 1}.jpg`,
  video: `/variants/cut-${(i % 3) + 1}.mp4`,
  embed: null,
  ...r,
});

export const CANON_ROWS: Reference[] = [
  row(1, {
    title: "Cuts on the kick, captions one word at a time",
    handle: "edit.studio.example",
    provider: human,
    note: { text: LONG_NOTE, by: "william", at: day(1) },
    tags: ["video-editing", "hooks"],
    stats: { views: 1_240_000, likes: 88_000, comments: 1_420 },
  }),
  row(2, {
    title: "Pricing in one whiteboard",
    provider: human,
    note: { text: "good structure: problem, number, offer.", by: "william", at: day(2) },
    tags: ["offers"],
  }),
  row(3, {
    id: "youtube-fakeVideo01",
    title: "A long talk on retention with a title that runs past one line on a phone",
    url: "https://youtube.com/watch?v=fakeVideo01",
    platform: "youtube",
    kind: "video",
    handle: null,
    length: 3_725,
    poster: null,
    video: null,
    tags: ["video-editing"],
  }),
  row(4, { title: "Hook in the first frame", tags: ["hooks"] }),
  row(5, {
    title: "Ahttps://example.com/a/very/long/unbroken/title/without/any/spaces/at/all/in/it",
    handle: "a.handle.that.is.very.long.and.never.breaks.example",
    length: null,
  }),
  ...Array.from({ length: 7 }, (_, k) => row(6 + k, {})),
];

const WHOLE: Record<string, Partial<ReferenceWhole>> = {
  "instagram-Fake1": {
    hook: "Why do your shorts stop at 3 seconds?",
    hookStyle: "question",
    cta: "Follow for part two.",
    topic: "video-editing",
    beats: [
      { t: 0, beat: "Question to camera" },
      { t: 3, beat: "Zoom on the punchline" },
      { t: 9, beat: "B-roll run, one second each" },
      { t: 18, beat: "Answer, then the call to action" },
    ],
    caption: "The one edit that keeps people watching.",
    transcript:
      "Why do your shorts stop at three seconds? Because nothing moves. Here is what I do instead. Every cut on the beat, every caption one word at a time.",
    backs: [
      {
        set: "video-editing-cuts",
        setTitle: "Cuts",
        topic: "video-editing",
        line: "VC-1",
        text: "Cut on the beat, never between beats.",
      },
      {
        set: "video-editing-captions",
        setTitle: "Captions",
        topic: "video-editing",
        line: "VCA-3",
        text: "Show captions one word at a time, in time with the voice.",
      },
    ],
  },
};

const whole = (r: Reference): ReferenceWhole => ({
  hook: null,
  hookStyle: null,
  cta: null,
  topic: null,
  beats: [],
  caption: null,
  transcript: null,
  backs: [],
  ...r,
  ...WHOLE[r.id],
});

const facet = (rows: Reference[], of: (r: Reference) => string[]) => {
  const n = new Map<string, number>();
  for (const r of rows) for (const v of of(r)) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].map(([value, c]) => ({ value, n: c })).sort((a, b) => b.n - a.n);
};

const PAGE = 8;

export const CANON_ANSWERS = serve<ReturnType<typeof canonConsoleApi>>("canon", {
  references: (b) => {
    const s = (k: string) => (typeof b[k] === "string" && b[k] ? (b[k] as string) : null);
    const q = s("q")?.toLowerCase();
    const keep = (r: Reference, skip?: string) =>
      (skip === "platform" || !s("platform") || r.platform === s("platform")) &&
      (skip === "provider" || !s("provider") || r.provider?.kind === s("provider")) &&
      (skip === "tag" || !s("tag") || r.tags.includes(s("tag") as string)) &&
      (!q || `${r.title} ${r.handle ?? ""} ${r.note?.text ?? ""}`.toLowerCase().includes(q)) &&
      (!b.noted || !!r.note);
    const rows = CANON_ROWS.filter((r) => keep(r));
    const after = typeof b.after === "number" ? b.after : 0;
    return {
      indexed: true,
      head: "5fe93471aa0c2b9d4e6f7a8b9c0d1e2f3a4b5c6d",
      total: rows.length,
      rows: rows.slice(after, after + PAGE),
      next: after + PAGE < rows.length ? after + PAGE : null,
      facets: {
        platform: facet(
          CANON_ROWS.filter((r) => keep(r, "platform")),
          (r) => [r.platform],
        ),
        provider: facet(
          CANON_ROWS.filter((r) => keep(r, "provider")),
          (r) => (r.provider ? [r.provider.kind] : []),
        ),
        tag: facet(
          CANON_ROWS.filter((r) => keep(r, "tag")),
          (r) => r.tags,
        ),
      },
    };
  },
  reference: (b) => {
    const r = CANON_ROWS.find((x) => x.id === b.id);
    if (!r) throw new Error("no such reference");
    return whole(r);
  },
});

/** The Add box: one filing, one filed, one failed. A new ask joins the top as Filing. */
export const CANON_ADDS: AddRow[] = [
  {
    id: 3,
    what: "https://www.instagram.com/reel/FakeNew01/",
    fileName: null,
    note: "the pacing here, every cut on the beat",
    person: "william",
    state: "claimed",
    error: null,
    records: [],
    at: ago(0),
  },
  {
    id: 2,
    what: "https://www.youtube.com/watch?v=fakeVideo01",
    fileName: null,
    note: null,
    person: "william",
    state: "done",
    error: null,
    records: ["youtube-fakeVideo01"],
    at: ago(0),
  },
  {
    id: 1,
    what: "https://www.tiktok.com/@made-up-creator/video/7000000000000000001",
    fileName: null,
    note: "good hook",
    person: "william",
    state: "failed",
    error: "yt-dlp: this video is private",
    records: [],
    at: ago(1),
  },
];

export function canonAddAnswers(start: AddRow[] = CANON_ADDS) {
  let rows = [...start];
  let next = 100;
  return {
    "canon/adds": () => ({ rows }),
    "canon/add": (b: Record<string, unknown>) => {
      const row: AddRow = {
        id: next++,
        what: String(b.what),
        fileName: (b.fileName as string | null) ?? null,
        note: (b.note as string | null) ?? null,
        person: "william",
        state: "pending",
        error: null,
        records: [],
        at: new Date().toISOString(),
      };
      rows = [row, ...rows];
      return row;
    },
    "canon/retry": (b: Record<string, unknown>) => {
      rows = rows.map((r) =>
        r.id === b.id ? { ...r, state: "pending" as const, error: null } : r,
      );
      return rows.find((r) => r.id === b.id) ?? null;
    },
    "canon/upload": (b: Record<string, unknown>) => ({
      url: `${UPLOAD_HOST}/media/${String(b.sha256).slice(0, 32)}`,
      headers: { "content-type": "application/pdf" },
      source: `s3://fake-media/media/${String(b.sha256).slice(0, 32)}.pdf`,
    }),
  };
}
