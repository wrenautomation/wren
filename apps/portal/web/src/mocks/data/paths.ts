/**
 * Explorer's answers (`paths/*`): the server's own Canon tree (`canonTree`) and walk over the
 * Canon mocks, so a page story reads the shapes and errors prod reads. Synthetic data only.
 */
import { childrenAt, columns, homeAt, PathError, wholeAt } from "@wren/core/paths";
import { type CanonSource, canonTree, type Placed } from "@wren/paths/canon-tree";
import { PATH_ERROR_STATUS } from "@wren/paths/console-routes";
import type { PathsConsoleApi } from "@wren/paths/restate";
import type {
  FileRef,
  FileWhole,
  Link,
  RecordWhole,
  TopicWhole,
} from "@wren/research/canon-library";
import { type Refusal, refuse, serve } from "../api.js";
import { CANON_ROWS, referenceWhole } from "./canon.js";
import {
  CANON_HOME,
  CANON_RECORDS,
  CANON_TOPIC,
  canonFile,
  canonRecord,
  canonRecordsWhole,
} from "./canon-library.js";

// the server's VIDEO_KINDS (canon-console.ts): its module holds the database, so not imported here
const VIDEO_KINDS = ["reel", "video"];
const missing = (what: string) => new PathError("unknown-path", `no ${what}`);

/** Every record the mocks name, by id: the most specific source last. */
const PLACED = new Map<string, Placed>();
const place = (r: Placed) => PLACED.set(r.id, r);
for (const r of [...CANON_ROWS, ...CANON_TOPIC.references])
  place({ id: r.id, type: "source", title: r.title, status: "live", kind: r.kind });
for (const e of CANON_TOPIC.evidence)
  place({ id: e.id, type: "source", title: e.title, status: e.status, kind: e.kind });
for (const s of [...CANON_TOPIC.sets, ...CANON_TOPIC.borrowed])
  place({ id: s.id, type: "rule", title: s.title, status: "live", topic: s.topic });
for (const c of CANON_TOPIC.conflicts)
  place({ id: c.id, type: "conflict", title: c.title, status: "live", topic: CANON_TOPIC.name });
for (const r of CANON_RECORDS)
  place({ id: r.id, type: r.type, title: r.title, status: r.status, topic: r.topic });
for (const r of canonRecordsWhole())
  place({
    id: r.id,
    type: r.type,
    title: r.title,
    status: r.status,
    topic: r.topic,
    kind: typeof r.data.kind === "string" ? r.data.kind : null,
  });

const ROOT_FILES: FileRef[] = [...CANON_HOME.direction, ...CANON_HOME.other].map(
  ({ path, size, text }) => ({ path, size, text }),
);

/** A topic the mocks hold no whole for: its home row, and any set another topic borrows from it. */
function thinTopic(name: string): TopicWhole | null {
  const row = CANON_HOME.topics.find((t) => t.name === name);
  // the home names a shared set's owner too
  const owns = new Set(CANON_HOME.shared.filter((s) => s.owner === name).map((s) => s.id));
  const sets = CANON_TOPIC.borrowed.filter((s) => s.topic === name || owns.has(s.id));
  if (!row && !sets.length) return null;
  return {
    name,
    title: row?.title ?? name,
    description: row?.description ?? null,
    guide: null,
    sets,
    borrowed: [],
    skill: null,
    notes: null,
    files: [],
    conflicts: [],
    references: [],
    evidence: [],
    github: CANON_TOPIC.github,
  };
}

/** A reference as its source record (prod's records hold every source); cited by the records that cite it. */
function sourceRecord(id: string): RecordWhole | null {
  const r = CANON_ROWS.find((x) => x.id === id);
  if (!r) return null;
  const by = new Map<string, Link>();
  for (const x of [...CANON_RECORDS.map((l) => canonRecord(l.id)), ...canonRecordsWhole()])
    if (x?.cites.some((c) => c.id === id))
      by.set(x.id, { id: x.id, type: x.type, title: x.title, status: x.status });
  return {
    id,
    type: "source",
    title: r.title,
    status: "live",
    path: `sources/${id}.md`,
    topic: null,
    body: r.note?.text ?? "",
    data: { kind: r.kind, url: r.url, by: "agent-1" },
    cites: [],
    citedBy: [...by.values()],
    github: `${CANON_TOPIC.github}/blob/main/sources/${id}.md`,
  };
}

/** A file the mocks list but hold no body for: a short one of its own. */
function fileOf(path: string): FileWhole | null {
  const f = canonFile(path);
  if (f) return f;
  const ref = [...ROOT_FILES, ...CANON_TOPIC.files].find((x) => x.path === path);
  if (!ref) return null;
  return {
    ...ref,
    body: ref.text ? `# ${path}\n\nA made-up file.` : null,
    github: `${CANON_TOPIC.github}/blob/main/${path}`,
  };
}

export const CANON_SOURCE: CanonSource = {
  videoKinds: VIDEO_KINDS,
  indexed: async () => CANON_HOME.indexed,
  home: async () => CANON_HOME,
  topic: async (name) => {
    const t = name === CANON_TOPIC.name ? CANON_TOPIC : thinTopic(name);
    if (!t) throw missing(`topic ${name}`);
    return t;
  },
  record: async (id) => {
    const r = canonRecord(id) ?? sourceRecord(id);
    if (!r) throw missing(`record ${id}`);
    return r;
  },
  reference: async (id) => {
    const r = CANON_ROWS.find((x) => x.id === id);
    if (!r) throw missing(`reference ${id}`);
    return referenceWhole(r);
  },
  file: async (path) => {
    const f = fileOf(path);
    if (!f) throw missing("file");
    return f;
  },
  references: async (after, limit) => ({
    rows: CANON_ROWS.slice(after, after + limit),
    next: after + limit < CANON_ROWS.length ? after + limit : null,
  }),
  rootFiles: async () => ROOT_FILES,
  placed: async (ids) => ids.flatMap((i) => PLACED.get(i) ?? []),
  into: async (id) => {
    const r = PLACED.get(id);
    return r ? { ...r, into: null } : null;
  },
  foldedGuide: async () => null,
  // counts as the home says them (one table in prod); a type's rows are the few the mocks hold
  counts: async () => ({
    topics: CANON_HOME.topics.length,
    references: CANON_ROWS.length,
    records: CANON_HOME.types.reduce((s, t) => s + t.n, 0),
  }),
  types: async () => CANON_HOME.types.map((t) => ({ type: t.value, n: t.n })),
  ofType: async (type, offset, limit) => {
    const rows = [...PLACED.values()].filter((r) => r.type === type);
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  },
  findRecords: async (words, under, limit) =>
    [...PLACED.values()]
      .filter(
        (r) =>
          words.every((w) => `${r.title ?? ""} ${r.id}`.toLowerCase().includes(w.toLowerCase())) &&
          (!under.topic || r.topic === under.topic) &&
          (!under.type || r.type === under.type) &&
          (!under.references || (r.type === "source" && !!r.kind && VIDEO_KINDS.includes(r.kind))),
      )
      .sort((a, b) => Number(b.status === "live") - Number(a.status === "live"))
      .slice(0, limit),
  head: async () => CANON_HOME.head,
};

/** A path error as the server refuses it (`PathsConsole`). */
async function refused<T>(read: () => Promise<T>): Promise<T | Refusal> {
  try {
    return await read();
  } catch (e) {
    if (e instanceof PathError) return refuse(PATH_ERROR_STATUS[e.code], `${e.code}: ${e.message}`);
    throw e;
  }
}

// a fresh tree per call, as the server makes one per request
const tree = () => canonTree(CANON_SOURCE);

export const PATHS_ANSWERS = serve<PathsConsoleApi>("paths", {
  columns: (b) => refused(() => columns(tree(), String(b.route))),
  children: (b) =>
    refused(() =>
      childrenAt(tree(), String(b.path), typeof b.after === "string" ? b.after : undefined),
    ),
  whole: (b) => refused(() => wholeAt(tree(), String(b.path))),
  find: (b) =>
    refused(async () => {
      const a = tree();
      const under = typeof b.under === "string" ? b.under : "canon";
      return { items: await a.find(String(b.q), await homeAt(a, under)) };
    }),
});
