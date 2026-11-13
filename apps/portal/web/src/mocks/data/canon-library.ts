/**
 * Canon's whole brain answers: Overview, a topic, the Library, a record, a file. Synthetic: made-up
 * topics, rule lines and sources. The records answer filters like the server (`canon-library.ts`).
 */
import type { Reference } from "@wren/research/canon-console";
import type {
  canonLibraryApi,
  FileWhole,
  Home,
  Link,
  RecordRow,
  RecordWhole,
  TopicWhole,
} from "@wren/research/canon-library";
import { serve } from "../api.js";
import { CANON_ROWS } from "./canon.js";
import { ago } from "./shell.js";

const GITHUB = "https://github.com/example-org/canon";
const HEAD = "5fe93471aa0c2b9d4e6f7a8b9c0d1e2f3a4b5c6d";

const link = (id: string, type: string | null, title: string | null, status = "live"): Link => ({
  id,
  type,
  title,
  status,
});

const GUIDE_CITES = [
  link("video-editing-cuts", "rule", "Video editing: Cuts"),
  link("video-editing-captions", "rule", "Video editing: Captions"),
  link("writing-tells-copy", "rule", "Writing tells: Copy"),
];
const CUTS_CITES = [
  link("cuts-land-on-the-kick-fake01", "finding", "Cuts land on the kick drum"),
  link("instagram-Fake1", "source", "Cuts on the kick, captions one word at a time"),
  link("youtube-goneVideo99", null, null, "missing"),
];
const GUIDE = `# Video editing

Edit a video so it holds up next to the best in its genre, and learn a new style fast.

The rules sit in one set per job: \`video-editing-cuts\` (VC) and \`video-editing-captions\` (VCA). Words on screen come from \`writing-tells-copy\` (WC).

## Steps

### 1. Study the style before you edit

1. Watch many videos of the genre. The pattern they share is the bar [1].
2. Keep only the best ones, the ones that make you think "I wish I made that" [notes].
3. Take each one apart frame by frame: pace, framing, camera moves, sound [2].

### 2. Cut

| Part | Rule |
|---|---|
| Cuts | VC-1, VC-2 |
| Captions | VCA-1 |

Check every caption against the copy set [3]. A link with no record behind it: [9].
`;
const CUTS = `# Cuts

Line ids are fixed. Change a line by id; never renumber.

- **VC-1** Cut on the beat, never between beats. [1] [2 at 0:03]
- **VC-2** Hold the first frame for a third of a second. [notes]
- **VC-3** Never cut away from the speaker mid-word. [3]
`;
const CAPTIONS = `# Captions

- **VCA-1** Show captions one word at a time, in time with the voice. [1]
`;

const NOTES = `# Notes

Your own rules for this SOP. They beat every source.

## Rules (William, 2026-11-10)

- the editing has to feel fast but never rushed. keep the music under the voice the whole time.
- steal the zoom on the punchline: it pushes in about 10% over 4 frames, then snaps back on the next beat.`;

const SKILL = `---
name: sop-video-editing
description: "SOP: Edit a video so it holds up next to the best in its genre."
---

Follow this SOP start to finish.

!\`knowledge render video-editing | grep -v '^<!-- set '\`

# The owner's notes (they beat every source)

!\`cat topics/video-editing/notes.md\`

# The rules

!\`knowledge render video-editing-cuts video-editing-captions writing-tells-copy --only WC-1\``;

export const CANON_TOPIC: TopicWhole = {
  name: "video-editing",
  title: "Video editing",
  description:
    "Edit a video so it holds up next to the best in its genre, and learn a new style fast.",
  guide: { id: "video-editing", title: "Video editing", body: GUIDE, cites: GUIDE_CITES },
  sets: [
    {
      id: "video-editing-cuts",
      title: "Video editing: Cuts",
      prefix: "VC",
      topic: "video-editing",
      body: CUTS,
      cites: CUTS_CITES,
      lines: 3,
      rules: [
        {
          id: "VC-1",
          text: "Cut on the beat, never between beats. [1] [2 at 0:03]",
          backing: "human",
          sources: ["instagram-Fake1", "instagram-Fake4"],
        },
        {
          id: "VC-2",
          text: "Hold the first frame for a third of a second. [notes]",
          backing: "human",
          sources: ["web-example-editing-guide"],
        },
        {
          id: "VC-3",
          text: "Never cut away from the speaker mid-word. [3]",
          backing: "agent",
          sources: ["youtube-fakeVideo01"],
        },
      ],
      usedBy: [],
    },
    {
      id: "video-editing-captions",
      title: "Video editing: Captions",
      prefix: "VCA",
      topic: "video-editing",
      body: CAPTIONS,
      cites: [link("instagram-Fake1", "source", "Cuts on the kick, captions one word at a time")],
      lines: 1,
      rules: [
        {
          id: "VCA-1",
          text: "Show captions one word at a time, in time with the voice. [1]",
          backing: "human",
          sources: ["instagram-Fake1"],
        },
      ],
      usedBy: [{ topic: "content-principles", title: "Content principles" }],
    },
  ],
  borrowed: [
    {
      id: "writing-tells-copy",
      title: "Writing tells: Copy",
      prefix: "WC",
      topic: "writing-tells",
      body: "# Copy\n\n- **WC-1** One idea per line on screen.\n- **WC-2** No word the viewer must look up.\n",
      cites: [],
      lines: 2,
      rules: [
        { id: "WC-1", text: "One idea per line on screen.", backing: "none", sources: [] },
        { id: "WC-2", text: "No word the viewer must look up.", backing: "none", sources: [] },
      ],
      usedBy: [{ topic: "content-principles", title: "Content principles" }],
    },
  ],
  skill: SKILL,
  notes: NOTES,
  files: [
    { path: "topics/video-editing/checks/cuts-on-beat.mjs", size: 1_830, text: true },
    { path: "topics/video-editing/counts.tsv", size: 412, text: true },
    { path: "topics/video-editing/refs/style-board.pdf", size: 4_812_330, text: false },
  ],
  conflicts: [
    {
      ...link("conflict-cut-length-fake", "conflict", "Two sources disagree on the first cut"),
      body: "His note says hold the first frame [notes]; an agent source says cut at once [1].",
      state: "open",
      lines: ["VC-2"],
    },
  ],
  references: [
    { ...(CANON_ROWS[0] as Reference), backs: ["VC-1", "VCA-1"] },
    { ...(CANON_ROWS[2] as Reference), backs: ["VC-3"] },
    { ...(CANON_ROWS[3] as Reference), backs: ["VC-1"] },
    {
      ...(CANON_ROWS[4] as Reference),
      id: "web-example-cut-sheet",
      kind: "page",
      platform: "web",
      poster: null,
      backs: [],
    },
  ],
  evidence: [
    {
      ...link(
        "web-example-editing-guide",
        "source",
        "An editing guide on a made-up site",
        "retired",
      ),
      kind: "page",
      tags: [],
      backs: ["VC-2"],
    },
    {
      ...link("arxiv-fake.0001", "source", "A paper on attention spans"),
      kind: "paper",
      tags: [],
      backs: [],
    },
  ],
  github: GITHUB,
};

export const CANON_HOME: Home = {
  indexed: true,
  head: HEAD,
  topics: [
    {
      name: "content-principles",
      title: "Content principles",
      description: "Write scripts, posts and titles that hold one viewer's attention.",
      guide: "content-principles",
      sets: 4,
      lines: 61,
      skill: true,
      notes: true,
      conflicts: 0,
    },
    {
      name: "video-editing",
      title: "Video editing",
      description: CANON_TOPIC.description,
      guide: "video-editing",
      sets: 2,
      lines: 4,
      skill: true,
      notes: true,
      conflicts: 1,
    },
    {
      name: "writing-tells-and-a-much-longer-topic-name-that-wraps",
      title: "writing-tells-and-a-much-longer-topic-name-that-wraps",
      description: null,
      guide: null,
      sets: 1,
      lines: 12,
      skill: false,
      notes: false,
      conflicts: 0,
    },
  ],
  types: [
    { value: "finding", n: 8392 },
    { value: "source", n: 1913 },
    { value: "verdict", n: 93 },
    { value: "rule", n: 82 },
    { value: "pattern", n: 75 },
    { value: "guide", n: 21 },
    { value: "conflict", n: 1 },
  ],
  direction: [
    {
      path: "direction/2026-11-12-personal-brand.md",
      size: 2_400,
      text: true,
      title: "Personal brand, then licensing",
    },
    {
      path: "direction/2026-10-18-business-direction.md",
      size: 3_100,
      text: true,
      title: "Business direction",
    },
  ],
  other: [
    { path: "knowledge.json", size: 64, text: true },
    { path: "shapes/README.md", size: 900, text: true },
  ],
  conflicts: [
    link("conflict-cut-length-fake", "conflict", "Two sources disagree on the first cut"),
  ],
  shared: [
    {
      id: "writing-tells-copy",
      title: "Writing tells: Copy",
      owner: "writing-tells-and-a-much-longer-topic-name-that-wraps",
      users: ["video-editing", "content-principles"],
    },
    {
      id: "video-editing-captions",
      title: "Video editing: Captions",
      owner: "video-editing",
      users: ["content-principles"],
    },
  ],
  stale: [
    {
      id: "video-editing",
      type: "guide",
      title: "Video editing",
      cites: "video-editing-cuts",
      why: "changed",
    },
    {
      id: "video-editing",
      type: "guide",
      title: "Video editing",
      cites: "video-editing-captions",
      why: "changed",
    },
    {
      id: "cuts-land-on-the-kick-fake01",
      type: "finding",
      title: "Cuts land on the kick drum",
      cites: "youtube-goneVideo99",
      why: "missing",
    },
  ],
};

const row = (r: Partial<RecordRow> & Pick<RecordRow, "id" | "type" | "title">): RecordRow => ({
  status: "live",
  topic: null,
  updated: ago(1),
  summary: "",
  ...r,
});

export const CANON_RECORDS: RecordRow[] = [
  row({
    id: "video-editing",
    type: "guide",
    title: "Video editing",
    topic: "video-editing",
    summary: CANON_TOPIC.description ?? "",
    updated: ago(0),
  }),
  row({
    id: "video-editing-cuts",
    type: "rule",
    title: "Video editing: Cuts",
    topic: "video-editing",
    summary:
      "Line ids are fixed. Change a line by id; never renumber. VC-1 Cut on the beat, never between beats.",
  }),
  row({
    id: "cuts-land-on-the-kick-fake01",
    type: "finding",
    title: "Cuts land on the kick drum",
    summary:
      "Every cut in the first 20 seconds sits on a kick drum hit; the captions change on the same frame.",
  }),
  row({
    id: "a-long-pattern-title-fake",
    type: "pattern",
    title:
      "A pattern whose title runs long enough to wrap across two lines on a phone and keeps going",
    summary: "Three studies agree: the hook works when it names the viewer's own words.",
  }),
  row({
    id: "william-dropped-fake",
    type: "verdict",
    title: "William dropped instagram-Fake7",
    status: "live",
  }),
  row({
    id: "web-example-editing-guide",
    type: "source",
    title: "An editing guide on a made-up site",
    summary: "A page about pacing.",
    status: "retired",
  }),
  row({
    id: "conflict-cut-length-fake",
    type: "conflict",
    title: "Two sources disagree on the first cut",
    topic: "video-editing",
    summary: "His note says hold the first frame; an agent source says cut at once.",
  }),
  ...Array.from({ length: 50 }, (_, i) =>
    row({
      id: `finding-fake-${i}`,
      type: "finding",
      title: `Finding ${i + 1}`,
      summary: `A made-up finding, number ${i + 1}.`,
      updated: ago(i + 2),
    }),
  ),
];

const RECORD: Record<string, RecordWhole> = {
  "cuts-land-on-the-kick-fake01": {
    id: "cuts-land-on-the-kick-fake01",
    type: "finding",
    title: "Cuts land on the kick drum",
    status: "live",
    path: "findings/cuts-land-on-the-kick-fake01.md",
    topic: null,
    body: "Every cut in the first 20 seconds sits on a kick drum hit [1]; the captions change on the same frame [1].\n\nA second source says the same of long form [2].",
    data: {
      by: "weaver",
      why: "run 01FAKE (a made-up run)",
      version: 1,
      source: "instagram-Fake1",
      created: ago(3),
      updated: ago(1),
      confidence: 0.82,
      tags: ["video-editing", "pacing"],
      quote: { text: "every cut on the kick", at: 3 },
    },
    cites: [CUTS_CITES[1] as Link, link("youtube-goneVideo99", null, null, "missing")],
    citedBy: [link("video-editing-cuts", "rule", "Video editing: Cuts")],
    github: `${GITHUB}/blob/main/findings/cuts-land-on-the-kick-fake01.md`,
  },
  "web-example-editing-guide": {
    id: "web-example-editing-guide",
    type: "source",
    title: "An editing guide on a made-up site",
    status: "retired",
    path: "sources/web-example-editing-guide.md",
    topic: null,
    body: "# An editing guide\n\nPacing is the edit.",
    data: {
      kind: "page",
      url: "https://example.com/editing",
      provider: { kind: "human", who: "william" },
      note: {
        text: "good on pacing, the part about b-roll length is the useful bit",
        by: "william",
        at: ago(4),
      },
      by: "william",
      why: "he sent it",
      version: 2,
    },
    cites: [],
    citedBy: [],
    github: `${GITHUB}/blob/main/sources/web-example-editing-guide.md`,
  },
};

const FILES: Record<string, FileWhole> = {
  "direction/2026-11-12-personal-brand.md": {
    path: "direction/2026-11-12-personal-brand.md",
    size: 2_400,
    text: true,
    body: "---\ndate: 2026-11-12\n---\n\n# Personal brand, then licensing\n\nYouTube and X first, then a community, then upsells.\n\n- one skill at a time\n- each skill climbs to licensing",
    github: `${GITHUB}/blob/main/direction/2026-11-12-personal-brand.md`,
  },
  "topics/video-editing/refs/style-board.pdf": {
    path: "topics/video-editing/refs/style-board.pdf",
    size: 4_812_330,
    text: false,
    body: null,
    github: `${GITHUB}/blob/main/topics/video-editing/refs/style-board.pdf`,
  },
  "topics/video-editing/counts.tsv": {
    path: "topics/video-editing/counts.tsv",
    size: 412,
    text: true,
    body: "id\tcount\nVC-1\t14\nVC-2\t3\n",
    github: `${GITHUB}/blob/main/topics/video-editing/counts.tsv`,
  },
};

const PAGE = 50;
const counted = (rows: RecordRow[], of: (r: RecordRow) => string | null) => {
  const n = new Map<string, number>();
  for (const r of rows) {
    const v = of(r);
    if (v) n.set(v, (n.get(v) ?? 0) + 1);
  }
  return [...n].map(([value, c]) => ({ value, n: c })).sort((a, b) => b.n - a.n);
};

export const CANON_LIBRARY_ANSWERS = serve<ReturnType<typeof canonLibraryApi>>("canon", {
  home: CANON_HOME,
  topic: (b) => {
    if (b.name !== CANON_TOPIC.name) throw new Error("no such topic");
    return CANON_TOPIC;
  },
  records: (b) => {
    const s = (k: string) => (typeof b[k] === "string" && b[k] ? (b[k] as string) : null);
    const q = s("q")?.toLowerCase();
    const keep = (r: RecordRow, skip?: string) =>
      (skip === "type" || !s("type") || r.type === s("type")) &&
      (skip === "status" || !s("status") || r.status === s("status")) &&
      (skip === "topic" || !s("topic") || r.topic === s("topic")) &&
      (!q || `${r.title} ${r.id} ${r.summary}`.toLowerCase().includes(q));
    const rows = CANON_RECORDS.filter((r) => keep(r));
    const after = typeof b.after === "number" ? b.after : 0;
    return {
      indexed: true,
      total: rows.length,
      rows: rows.slice(after, after + PAGE),
      next: after + PAGE < rows.length ? after + PAGE : null,
      facets: {
        type: counted(
          CANON_RECORDS.filter((r) => keep(r, "type")),
          (r) => r.type,
        ),
        status: counted(
          CANON_RECORDS.filter((r) => keep(r, "status")),
          (r) => r.status,
        ),
        topic: counted(
          CANON_RECORDS.filter((r) => keep(r, "topic")),
          (r) => r.topic,
        ),
      },
      files: q
        ? Object.values(FILES)
            .filter((f) => `${f.path} ${f.body ?? ""}`.toLowerCase().includes(q))
            .map(({ path, size, text }) => ({ path, size, text }))
        : [],
    };
  },
  record: (b) => {
    const r = canonRecord(String(b.id));
    if (!r) throw new Error("no such record");
    return r;
  },
  file: (b) => {
    const f = canonFile(String(b.path));
    if (!f) throw new Error("no such file");
    return f;
  },
});

/** A record whole, as `canon/record` answers; null when Canon has none. */
export function canonRecord(id: string): RecordWhole | null {
  const r = RECORD[id];
  if (r) return r;
  const listed = CANON_RECORDS.find((x) => x.id === id);
  if (!listed) return null;
  return {
    id: listed.id,
    type: listed.type,
    title: listed.title,
    status: listed.status,
    path: `${listed.type}s/${listed.id}.md`,
    topic: listed.topic,
    body: listed.id === "video-editing-cuts" ? CUTS : listed.summary,
    data: { by: "agent-1", why: "made up", version: 1, updated: listed.updated },
    cites: listed.id === "video-editing-cuts" ? CUTS_CITES : [],
    citedBy: [],
    github: `${GITHUB}/blob/main/${listed.type}s/${listed.id}.md`,
  };
}

/** Every record whole the mocks hold by id. */
export const canonRecordsWhole = (): readonly RecordWhole[] => Object.values(RECORD);

/** A file whole, as `canon/file` answers; null when the mocks hold none. */
export const canonFile = (path: string): FileWhole | null => FILES[path] ?? null;
