/**
 * Explorer fixtures: a synthetic Canon-shaped tree (a cooking school's notes) behind the real
 * contract (`columns`, `childrenAt`), so stories walk routes the way the server does: aliases,
 * relation folders, a moved path, pages, a branch that is offline.
 */
import {
  type Adapter,
  aliasOf,
  childrenAt,
  columns,
  homeAt,
  type Item,
  itemFromParent,
  join,
  linksOf,
  mapAt,
  type PathEdge,
  PathError,
  type PathMap,
  parentOf,
  relationRow,
  segments,
  type Whole,
} from "@wren/core/paths";
import type { TagTone } from "../controls.js";
import type { ExplorerRead } from "../explorer.js";
import { fails, later, pending } from "./load.js";
import { WORST } from "./worst.js";

const ROOT = "canon";
const PAGE = 24;

interface Node {
  item: Item;
  rows: Item[];
  body?: string;
}

/** A still as a data URI: a tinted field, a play mark. */
const still = (h: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200"><rect width="160" height="200" fill="hsl(${h} 30% 60%)"/><path d="M68 86v28l24-14z" fill="#fff"/></svg>`,
  )}`;

const FINDINGS = ["Rye needs less water", "Steam lifts the ear", "Cold proof wins blind tests"];
const PLATFORMS = ["YouTube", "Instagram", "TikTok", "Web"];
const REF_TITLES = [
  "Shaping a tight boule in under a minute",
  "Why your crumb is gummy",
  "Scoring patterns for a high ear",
  "Knife grip: pinch, not point",
  "Plating with negative space",
  "Color on the plate: three rules",
  "Proofing by the poke test",
  "Steam in a home oven",
  "Julienne without a mandoline",
  "Sauce dots and swooshes",
];

/** The tree: home path → its item, its rows and its body. */
function buildTree(o: { worst?: boolean; refs?: number }): Map<string, Node> {
  const t = new Map<string, Node>();
  const put = (item: Item, rows: Item[] = [], body?: string) => {
    t.set(item.path, { item, rows, ...(body ? { body } : {}) });
  };

  // references: each one a home under canon/references
  const nRefs = o.refs ?? 30;
  const refs: Item[] = Array.from({ length: nRefs }, (_, n) => ({
    path: join(ROOT, "references", `ref-${n + 1}`),
    name: REF_TITLES[n % REF_TITLES.length] ?? `Reference ${n + 1}`,
    sub: `${PLATFORMS[n % PLATFORMS.length]} · @chef${(n % 7) + 1}`,
    kind: "reference",
    ...(n % 5 === 4 ? {} : { poster: still((n * 37) % 360) }),
  }));
  const ref = (n: number) => refs[n % refs.length] as Item;

  // topics, each with its layers
  const topics: Item[] = [];
  const topic = (
    name: string,
    sub: string,
    sets: { id: string; title: string; lines: [string, string][] }[],
    refIdx: number[],
    o2: { borrowed?: Item[]; notes?: string; guide?: string } = {},
  ) => {
    const home = join(ROOT, "topics", name);
    const setRows: Item[] = sets.map((s) => ({
      path: join(home, "sets", s.id),
      name: s.id,
      sub: s.title,
      kind: "set",
      count: s.lines.length,
    }));
    const borrowed = (o2.borrowed ?? []).map((b) => aliasOf(join(home, "sets"), b, "plating"));
    const topRef = refIdx.map(ref);
    const rows: Item[] = [];
    if (o2.guide)
      rows.push({ path: join(home, "guide"), name: "Procedure", sub: o2.guide, kind: "guide" });
    rows.push({
      path: join(home, "sets"),
      name: "Rule sets",
      kind: "layer",
      count: setRows.length + borrowed.length,
    });
    if (topRef.length)
      rows.push({
        path: join(home, "references"),
        name: "References",
        kind: "layer",
        count: topRef.length,
      });
    if (o2.notes != null)
      rows.push({
        path: join(home, "notes"),
        name: "Notes",
        sub: "notes.md",
        kind: "notes",
        leaf: true,
      });
    const item: Item = { path: home, name, sub, kind: "topic", count: sets.length };
    topics.push(item);
    put(item, rows, `${sub}.`);
    if (o2.guide) {
      const cites = join(home, "guide", "cites");
      put(
        { path: join(home, "guide"), name: "Procedure", sub: o2.guide, kind: "guide" },
        relationRow(join(home, "guide"), "cites", setRows),
        `1. Read the rule sets.\n2. Weigh the dough; note the room's heat.\n3. Shape, proof, score and bake.\n4. Write what changed in the notes.`,
      );
      put(
        { path: cites, name: "Cites", kind: "relation", count: setRows.length },
        setRows.map((s) => aliasOf(cites, s)),
      );
    }
    put(
      {
        path: join(home, "sets"),
        name: "Rule sets",
        kind: "layer",
        count: setRows.length + borrowed.length,
      },
      [...setRows, ...borrowed],
    );
    if (topRef.length)
      put(
        { path: join(home, "references"), name: "References", kind: "layer", count: topRef.length },
        topRef.map((r) => aliasOf(join(home, "references"), r)),
      );
    if (o2.notes != null)
      put(
        { path: join(home, "notes"), name: "Notes", sub: "notes.md", kind: "notes", leaf: true },
        [],
        o2.notes,
      );
    sets.forEach((s, si) => {
      const sh = join(home, "sets", s.id);
      const lineRows: Item[] = s.lines.map(([id, text], li) => ({
        path: join(sh, id),
        name: id,
        sub: text,
        kind: "line",
        mark: li % 4 === 3 ? "none" : li % 3 === 0 ? "human" : "agent",
      }));
      const usedBy: Item[] =
        name === "plating"
          ? []
          : [
              {
                path: join(ROOT, "topics", "plating"),
                name: "plating",
                sub: "Plating",
                kind: "topic",
              },
            ];
      put(
        setRows[si] as Item,
        [...lineRows, ...relationRow(sh, "used-by", usedBy)],
        `${s.title}. One rule per line; ids are fixed.`,
      );
      if (usedBy.length)
        put(
          { path: join(sh, "used-by"), name: "Used by", kind: "relation", count: usedBy.length },
          usedBy.map((u) => aliasOf(join(sh, "used-by"), u)),
        );
      s.lines.forEach(([id, text], li) => {
        const lh = join(sh, id);
        const backers = li % 4 === 3 ? [] : [ref(si * 3 + li), ref(si * 3 + li + 1)];
        put(lineRows[li] as Item, relationRow(lh, "backed-by", backers), text);
        if (backers.length)
          put(
            {
              path: join(lh, "backed-by"),
              name: "Backed by",
              kind: "relation",
              count: backers.length,
            },
            backers.map((b) => aliasOf(join(lh, "backed-by"), b)),
          );
      });
    });
    return setRows;
  };

  const platingSets = topic(
    "plating",
    "Plating",
    [
      {
        id: "plating-color",
        title: "Color on the plate",
        lines: [
          ["PC-1", "One bright color per plate; the rest stays quiet."],
          ["PC-2", "Green goes last, so it stays green."],
          ["PC-3", "A white plate for a brown dish."],
        ],
      },
    ],
    [4, 5, 9],
  );
  topic(
    "bread-baking",
    "Bread baking",
    [
      {
        id: "bread-baking-proofing",
        title: "Proofing",
        lines: [
          ["BP-1", "Proof by the poke test, never by the clock."],
          ["BP-2", "A cold proof overnight gives a deeper taste."],
          ["BP-3", "Cover the dough so its skin stays soft."],
          ["BP-4", "Over-proofed dough spreads; shape it again."],
          ["BP-5", "Warm the room to 24 °C in winter."],
        ],
      },
      {
        id: "bread-baking-scoring",
        title: "Scoring",
        lines: [
          ["BS-1", "Score at a 30° angle for an ear."],
          ["BS-2", "One quick stroke; never saw."],
        ],
      },
    ],
    [0, 1, 2, 6, 7],
    {
      borrowed: platingSets,
      guide: "Bake a country loaf",
      notes: "Hydration above 78% needs a stronger shape. Test with rye next.",
    },
  );
  topic(
    "knife-skills",
    "Knife skills",
    [
      {
        id: "knife-skills-cuts",
        title: "Cuts",
        lines: [
          ["KC-1", "Pinch the blade; the index finger never points."],
          ["KC-2", "Claw the guiding hand."],
        ],
      },
    ],
    [3, 8],
  );
  topic("kitchen-safety", "Kitchen safety", [], []);
  if (o.worst)
    topic(
      WORST.longLabel.toLowerCase().replaceAll(" ", "-"),
      WORST.longText,
      [
        {
          id: "worst-set",
          title: WORST.longLabel,
          lines: [
            ["W-1", WORST.longText],
            ["W-2", WORST.nonLatin],
            ["W-3", WORST.emoji],
            ["W-4", WORST.url],
          ],
        },
      ],
      [0, 1],
      { guide: WORST.longLabel, notes: WORST.longText },
    );

  // reference homes: what each backs and who cites it
  refs.forEach((r) => {
    const backs = [...t.values()]
      .filter((n) => n.item.kind === "line" && n.rows.some((x) => x.kind === "relation"))
      .filter((n) => t.get(join(n.item.path, "backed-by"))?.rows.some((x) => x.original === r.path))
      .map((n) => n.item);
    put(r, relationRow(r.path, "backs", backs), `A short video. ${r.sub}.`);
    if (backs.length)
      put(
        { path: join(r.path, "backs"), name: "Backs", kind: "relation", count: backs.length },
        backs.map((b) => aliasOf(join(r.path, "backs"), b)),
      );
  });

  // records by type
  const findings: Item[] = Array.from({ length: 6 }, (_, n) => ({
    path: join(ROOT, "records", "finding", `finding-${n + 1}`),
    name: `finding-${n + 1}`,
    sub: FINDINGS[n % FINDINGS.length] ?? "",
    kind: "finding",
    ...(n === 5 ? { mark: "retired" } : {}),
  }));
  for (const f of findings) put(f, [], `${f.sub}. Found in three sources.`);
  const types: Item[] = [
    { path: join(ROOT, "records", "source"), name: "source", kind: "type", count: refs.length },
    {
      path: join(ROOT, "records", "finding"),
      name: "finding",
      kind: "type",
      count: findings.length,
    },
    { path: join(ROOT, "records", "guide"), name: "guide", kind: "type", count: 0 },
  ];
  put(
    types[0] as Item,
    refs.map((r) => aliasOf(join(ROOT, "records", "source"), r)),
  );
  put(types[1] as Item, findings);
  put(types[2] as Item, []);

  // files
  const files: Item[] = [
    {
      path: join(ROOT, "files", "README.md"),
      name: "README.md",
      kind: "file",
      sub: "1.2 KB",
      leaf: true,
    },
    {
      path: join(ROOT, "files", "knowledge.json"),
      name: "knowledge.json",
      kind: "file",
      sub: "310 B",
      leaf: true,
    },
  ];
  for (const f of files)
    put(
      f,
      [],
      f.name === "README.md" ? "# Canon\n\nThe school's notes, as files." : '{ "root": "canon" }',
    );

  // areas
  const areas: Item[] = [
    { path: join(ROOT, "topics"), name: "Topics", kind: "area", count: topics.length },
    { path: join(ROOT, "references"), name: "References", kind: "area", count: refs.length },
    {
      path: join(ROOT, "records"),
      name: "Records",
      kind: "area",
      count: refs.length + findings.length,
    },
    { path: join(ROOT, "files"), name: "Files", kind: "area", count: files.length },
  ];
  put(areas[0] as Item, topics);
  put(areas[1] as Item, refs);
  put(areas[2] as Item, types);
  put(areas[3] as Item, files);
  put({ path: ROOT, name: ROOT, kind: "root" }, areas);
  return t;
}

/** How a row's mark reads; a human-backed line needs none. */
export const EXPLORER_MARKS: Readonly<Record<string, { label: string; tone?: TagTone }>> = {
  none: { label: "No source", tone: "warn" },
  agent: { label: "Agent source" },
  retired: { label: "Retired" },
};

/** What an adapter shows beside its root: what needs a look. */
export const EXPLORER_ROOT_PAGE = {
  title: "Needs a look",
  lines: [
    "BP-4 has no source yet.",
    "Two lines cite a reference that was retired.",
    "plating-color is loaded by 2 topics: a change reaches both.",
  ],
} as const;

/** Old paths and where each moved to. */
const MOVED: Record<string, string> = {
  [join(ROOT, "topics", "sourdough")]: join(ROOT, "topics", "bread-baking"),
};

export interface ExplorerFixture {
  /** long names, a long topic and its lines */
  worst?: boolean;
  /** how many references (24 to a page) */
  refs?: number;
  /** a home whose rows fail as offline */
  offline?: string;
  /** an adapter with no `edges`: the Map draws boxes only */
  noEdges?: boolean;
}

/** Worst case: links out to another root (the Map's "N links to vireo"). */
const OUT_EDGES: PathEdge[] = ["BP-1", "BP-2", "BS-1"].map((id, n) => ({
  id: `tests:${id}`,
  from: join(
    ROOT,
    "topics",
    "bread-baking",
    "sets",
    n < 2 ? "bread-baking-proofing" : "bread-baking-scoring",
    id,
  ),
  to: "vireo/subjects/rye-loaf",
  rel: "tested-by",
}));

/** The fixture tree as an adapter. */
export function explorerAdapter(o: ExplorerFixture = {}): Adapter {
  const tree = buildTree(o);
  const within = (outer: string, inner: string) => inner === outer || inner.startsWith(`${outer}/`);
  const a: Adapter = {
    root: ROOT,
    async children(home, after) {
      if (o.offline && within(o.offline, home))
        throw new PathError("offline", `${home}: no answer`);
      const n = tree.get(home);
      if (!n) throw new PathError("unknown-path", `nothing at ${home}`);
      const from = Number(after ?? 0) || 0;
      const next = from + PAGE < n.rows.length ? String(from + PAGE) : undefined;
      return { items: n.rows.slice(from, from + PAGE), ...(next ? { next } : {}) };
    },
    async item(path) {
      const to = MOVED[path];
      const moved = to ? tree.get(to) : undefined;
      if (moved) return { ...moved.item, was: path };
      const n = tree.get(path);
      return n ? n.item : itemFromParent(a, path);
    },
    async whole(home): Promise<Whole> {
      const n = tree.get(home);
      if (!n) throw new PathError("unknown-path", `nothing at ${home}`);
      return { ...n.item, ...(n.body ? { body: n.body } : {}), links: await linksOf(a, n.item) };
    },
    // Canon's three: an alias places its item, a guide cites, a reference backs; one way per pair
    async edges(at) {
      const out: PathEdge[] = o.worst ? [...OUT_EDGES] : [];
      for (const n of tree.values()) {
        const rel = n.item.kind === "relation" ? segments(n.item.path).at(-1) : "places";
        if (rel !== "places" && rel !== "cites" && rel !== "backs") continue;
        const from = rel === "places" ? n.item.path : parentOf(n.item.path);
        for (const r of n.rows)
          if (r.original && r.kind !== "relation")
            out.push({ id: `${rel}:${from}>${r.original}`, from, to: r.original, rel });
      }
      return out.filter((e) => within(at, e.from) || within(at, e.to));
    },
    async find(q, under = ROOT) {
      const s = q.toLowerCase();
      return [...tree.values()]
        .map((n) => n.item)
        .filter((i) => within(under, i.path) && i.kind !== "relation")
        .filter((i) => `${i.name} ${i.sub ?? ""}`.toLowerCase().includes(s))
        .slice(0, 50);
    },
  };
  if (!o.noEdges) return a;
  const { edges: _, ...bare } = a;
  return bare;
}

/** Explorer's reads over the fixture, each answer `ms` late. */
export function explorerRead(o: ExplorerFixture & { ms?: number } = {}): ExplorerRead {
  const a = explorerAdapter(o);
  const ms = o.ms ?? 120;
  return {
    columns: async (route) => later(await columns(a, route), ms),
    children: async (path, after) => later(await childrenAt(a, path, after), ms),
    find: async (q, under) => later(await a.find(q, await homeAt(a, under)), ms),
  };
}

/** The Map under a fold, through core's own `mapAt`: what `paths/map` answers. */
export const explorerMap = (
  fold: { depth: number; open: Record<string, boolean> },
  o: ExplorerFixture = {},
): Promise<PathMap> => mapAt(explorerAdapter(o), fold);

/** Reads that never answer: the first skeleton, held. */
export const explorerPending = (): ExplorerRead => ({
  columns: pending(),
  children: pending(),
  find: pending(),
});

/** Reads that fail the way a down server does. */
export const explorerFails = (): ExplorerRead => ({
  columns: fails(),
  children: fails(),
  find: fails(),
});
