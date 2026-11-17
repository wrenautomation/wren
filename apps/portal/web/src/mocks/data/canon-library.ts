/**
 * Canon's whole brain answers: Overview, a topic, the Library, a record, a file. Synthetic: made-up
 * topics, rule lines and sources. The records answer filters like the server (`canon-library.ts`).
 */
import type { Reference } from "@wren/research/canon-console";
import type {
  ClientWhole,
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
/** the base's name in the client facet, as the server's `BASE` */
const BASE = "base";
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
          overrides: [],
        },
        {
          id: "VC-2",
          text: "Hold the first frame for a third of a second. [notes]",
          backing: "human",
          sources: ["web-example-editing-guide"],
          overrides: [
            {
              client: "client-a",
              set: "client-a-video-editing-cuts",
              topic: "video-editing",
              line: "CA-1",
              text: "Hold the first frame for half a second: their viewers read the logo.",
              stale: false,
            },
            {
              client: "client-b",
              set: "client-b-video-editing",
              topic: "video-editing",
              line: "CB-2",
              text: "Open on the product, no held frame.",
              stale: true,
            },
          ],
        },
        {
          id: "VC-3",
          text: "Never cut away from the speaker mid-word. [3]",
          backing: "agent",
          sources: ["youtube-fakeVideo01"],
          overrides: [],
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
          overrides: [],
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
        {
          id: "WC-1",
          text: "One idea per line on screen.",
          backing: "none",
          sources: [],
          overrides: [],
        },
        {
          id: "WC-2",
          text: "No word the viewer must look up.",
          backing: "none",
          sources: [],
          overrides: [],
        },
      ],
      usedBy: [{ topic: "content-principles", title: "Content principles" }],
    },
  ],
  skill: SKILL,
  notes: NOTES,
  clients: [
    {
      client: "client-a",
      sets: [link("client-a-video-editing-cuts", "rule", "Client A: Cuts")],
      notes: "# Notes\n\n- Their logo shows in the first frame. (2026-11-16)\n",
    },
    {
      client: "client-b",
      sets: [link("client-b-video-editing", "rule", "Client B: Video")],
      notes: null,
    },
  ],
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
    // shots filed as pictures: wide and phone, posters shown whole
    {
      ...(CANON_ROWS[4] as Reference),
      id: "image-fakeshotwide1",
      title: "A list app: left nav, search, filter chips, rows with tags",
      url: "https://example.com/app",
      kind: "image",
      platform: "image",
      handle: null,
      length: null,
      poster: "/canon/shot-wide.svg",
      video: null,
      backs: ["VC-2"],
    },
    {
      ...(CANON_ROWS[4] as Reference),
      id: "image-fakeshotphone",
      title: "The same app at 390: chips scroll, tab bar at the foot",
      url: "https://example.com/app",
      kind: "image",
      platform: "image",
      handle: null,
      length: null,
      poster: "/canon/shot-phone.svg",
      video: null,
      backs: ["VC-3"],
    },
  ],
  sources: [
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
  clients: [
    { client: "client-a", records: 3, sets: 1, overrides: 1, stale: 0 },
    { client: "client-b", records: 1, sets: 1, overrides: 2, stale: 2 },
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
  client: null,
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
  row({
    id: "client-a-video-editing-cuts",
    type: "rule",
    title: "Client A: Cuts",
    topic: "video-editing",
    client: "client-a",
    summary: "Client A's own cuts: the logo holds the first frame.",
  }),
  row({
    id: "client-a-video-editing",
    type: "guide",
    title: "Client A: Video editing",
    topic: "video-editing",
    client: "client-a",
    summary: "How Client A's videos are cut.",
  }),
  row({
    id: "web-client-a-brand-sheet",
    type: "source",
    title: "Client A brand sheet",
    client: "client-a",
    summary: "Their colors, logo and words to avoid.",
  }),
  row({
    id: "client-b-video-editing",
    type: "rule",
    title: "Client B: Video",
    topic: "video-editing",
    client: "client-b",
    summary: "Client B opens on the product.",
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
    client: null,
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
    picture: null,
    cites: [CUTS_CITES[1] as Link, link("youtube-goneVideo99", null, null, "missing")],
    citedBy: [link("video-editing-cuts", "rule", "Video editing: Cuts")],
    github: `${GITHUB}/blob/main/findings/cuts-land-on-the-kick-fake01.md`,
  },
  "web-example-editing-guide": {
    id: "web-example-editing-guide",
    type: "source",
    title: "An editing guide on a made-up site",
    client: null,
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
    picture: null,
    cites: [],
    citedBy: [],
    github: `${GITHUB}/blob/main/sources/web-example-editing-guide.md`,
  },
};

const CLIENT_A_NOTES = "clients/client-a/topics/video-editing/notes.md";

const FILES: Record<string, FileWhole> = {
  [CLIENT_A_NOTES]: {
    path: CLIENT_A_NOTES,
    size: 64,
    text: true,
    body: "# Notes\n\n- Their logo shows in the first frame. (2026-11-16)\n",
    github: `${GITHUB}/blob/main/${CLIENT_A_NOTES}`,
  },
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
      (skip === "client" || !s("client") || (r.client ?? BASE) === s("client")) &&
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
        client: counted(
          CANON_RECORDS.filter((r) => keep(r, "client")),
          (r) => r.client ?? BASE,
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
  clients: () => canonClients(),
  client: (b) => {
    const c = canonClient(String(b.id));
    if (!c) throw new Error("no such client");
    return c;
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
    client: listed.client,
    type: listed.type,
    title: listed.title,
    status: listed.status,
    path: `${listed.type}s/${listed.id}.md`,
    topic: listed.topic,
    body: listed.id === "video-editing-cuts" ? CUTS : listed.summary,
    data: { by: "agent-1", why: "made up", version: 1, updated: listed.updated },
    picture: null,
    cites: listed.id === "video-editing-cuts" ? CUTS_CITES : [],
    citedBy: [],
    github: `${GITHUB}/blob/main/${listed.type}s/${listed.id}.md`,
  };
}

/** Every record whole the mocks hold by id. */
export const canonRecordsWhole = (): readonly RecordWhole[] => Object.values(RECORD);

/** A file whole, as `canon/file` answers; null when the mocks hold none. */
export const canonFile = (path: string): FileWhole | null => FILES[path] ?? null;

const clientRecords = (client: string) =>
  CANON_RECORDS.filter((r) => r.client === client).map(({ id, type, title, status, topic }) => ({
    id,
    type,
    title,
    status,
    topic,
    kind: type === "source" ? "web" : null,
  }));

/** Each client's overlay whole, as `canon/client` answers: a fresh override, a stale one, a gone one. */
const CLIENTS: Record<string, ClientWhole> = {
  "client-a": {
    client: "client-a",
    summary: CANON_HOME.clients[0] as ClientWhole["summary"],
    records: clientRecords("client-a"),
    sets: [
      {
        id: "client-a-video-editing-cuts",
        title: "Client A: Cuts",
        topic: "video-editing",
        prefix: "CA",
        body: "# Client A: Cuts\n\n- **CA-1** Hold the first frame for half a second: their viewers read the logo.\n- **CA-2** Never cut on the logo sting.\n",
        lines: 2,
        rules: [
          {
            id: "CA-1",
            text: "Hold the first frame for half a second: their viewers read the logo.",
            replaces: {
              set: "video-editing-cuts",
              topic: "video-editing",
              line: "VC-2",
              text: "Hold the first frame for a third of a second.",
              stale: false,
              gone: false,
            },
          },
          { id: "CA-2", text: "Never cut on the logo sting.", replaces: null },
        ],
        cites: [link("video-editing-cuts", "rule", "Video editing: Cuts")],
      },
    ],
    files: [{ path: CLIENT_A_NOTES, size: 64, text: true }],
  },
  "client-b": {
    client: "client-b",
    summary: CANON_HOME.clients[1] as ClientWhole["summary"],
    records: clientRecords("client-b"),
    sets: [
      {
        id: "client-b-video-editing",
        title: "Client B: Video",
        topic: "video-editing",
        prefix: "CB",
        body: "# Client B: Video\n\n- **CB-1** Show the price in the first three seconds.\n- **CB-2** Open on the product, no held frame.\n- **CB-3** Cut every two seconds at most.\n",
        lines: 3,
        rules: [
          { id: "CB-1", text: "Show the price in the first three seconds.", replaces: null },
          {
            id: "CB-2",
            text: "Open on the product, no held frame.",
            replaces: {
              set: "video-editing-cuts",
              topic: "video-editing",
              line: "VC-2",
              text: "Hold the first frame for a third of a second.",
              stale: true,
              gone: false,
            },
          },
          {
            id: "CB-3",
            text: "Cut every two seconds at most.",
            replaces: {
              set: "video-editing-cuts",
              topic: "video-editing",
              line: "VC-4",
              text: null,
              stale: true,
              gone: true,
            },
          },
        ],
        cites: [link("video-editing-cuts", "rule", "Video editing: Cuts")],
      },
    ],
    files: [],
  },
};

/** Each client at a glance, as `canon/clients` answers. */
export function canonClients() {
  return CANON_HOME.clients;
}

/** A client whole, as `canon/client` answers; null when the mocks hold none. */
export function canonClient(id: string): ClientWhole | null {
  return CLIENTS[id] ?? null;
}
