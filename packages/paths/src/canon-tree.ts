/**
 * Canon as a tree (designs/2026-11-12-explorer.md D4): `canon/topics/<topic>/<layer>/…`, a set's
 * lines under it, `canon/references/<id>`, `canon/records/<type>/<id>`, `canon/files/<path>`.
 * References open on groups (`by-topic/<topic>`, `yours`, `by-creator/<handle>`, `all`); a row
 * in a group keeps its home, `canon/references/<id>` (WA-1375).
 * A set another topic borrows shows there as an alias; `backs`, `cites` and `used-by` are
 * relation folders. Each client's overlay (D7): `canon/clients/<c>/topics/<t>/sets/<id>/<line>`
 * (`replaces` its base line; the base line's `overridden-by` back), `…/records/<type>/<id>`,
 * `…/files/<path>`. Reads only through a `CanonSource`: the index on a server (`canon.ts`), or
 * fixtures in a story, so both walk the same tree. Browser-safe: core and types only.
 * One adapter per request: topics and records load once.
 */

import {
  type Adapter,
  aliasOf,
  type Item,
  itemFromParent,
  join,
  linksOf,
  PAGE_SIZE,
  type Page,
  type PathEdge,
  PathError,
  relationRow,
  segments,
  sizeLabel,
  type Whole,
} from "@wren/core/paths";
import type { Reference, ReferenceWhole } from "@wren/research/canon-console";
import type {
  ClientSummary,
  ClientWhole,
  canonEdges,
  FileRef,
  FileWhole,
  Home,
  Link as RecordLink,
  RecordWhole,
  RuleSet,
  TopicWhole,
} from "@wren/research/canon-library";

const ROOT = "canon";
/** the references' group segments; a reference id starts with its platform, so none collide */
const GROUP = { topic: "by-topic", yours: "yours", creator: "by-creator", all: "all" } as const;
const GROUPS: ReadonlySet<string> = new Set(Object.values(GROUP));
const GROUP_NAME: Record<string, string> = {
  [GROUP.topic]: "By topic",
  [GROUP.yours]: "Saved by you",
  [GROUP.creator]: "By creator",
  [GROUP.all]: "All",
};

/** A record with what its home needs. */
export type Placed = {
  id: string;
  type: string | null;
  title: string | null;
  status: string;
  topic?: string | null;
  kind?: string | null;
  /** null or none: the base */
  client?: string | null;
};

/** Which references a group holds: those a topic cites, his own saves, one creator's; none: all. */
export interface ReferencesBy {
  usedBy?: string;
  yours?: boolean;
  handle?: string;
}

/** The references' groups, biggest first. */
export interface ReferenceGroups {
  /** each topic that cites at least one */
  topics: { topic: string; n: number }[];
  creators: { handle: string; platform: string; n: number }[];
  /** saved by a person, not an agent */
  yours: number;
}

/** Where a find looks: one topic, one type, or the references; and whose records. */
export interface FindUnder {
  topic?: string;
  type?: string;
  references?: boolean;
  /** null: the base only; `*`: every client, not the base; a client id: that client only; none: all */
  client?: string | null;
}

/** What the tree reads. Each read of one thing rejects with PathError `unknown-path` when it is not there. */
export interface CanonSource {
  /** source kinds that are references: a poster, a player */
  videoKinds: readonly string[];
  /** false: no index here yet */
  indexed(): Promise<boolean>;
  home(): Promise<Home>;
  topic(name: string): Promise<TopicWhole>;
  record(id: string): Promise<RecordWhole>;
  reference(id: string): Promise<ReferenceWhole>;
  file(path: string): Promise<FileWhole>;
  /** references, newest saved first; `by`: one group's */
  references(
    after: number,
    limit: number,
    by?: ReferencesBy,
  ): Promise<{ rows: Reference[]; next: number | null }>;
  referenceGroups(): Promise<ReferenceGroups>;
  /** files outside topics/: direction, knowledge.json, shapes … */
  rootFiles(): Promise<FileRef[]>;
  placed(ids: readonly string[]): Promise<Placed[]>;
  /** one record and what took its place when retired (`retire --into`) */
  into(id: string): Promise<(Placed & { into: string | null }) | null>;
  /** a retired guide with an `into`, by its id or its topic */
  foldedGuide(topic: string): Promise<string | null>;
  counts(): Promise<{ topics: number; references: number; records: number }>;
  types(): Promise<{ type: string; n: number }[]>;
  /** a page of one type's records, newest first */
  ofType(type: string, offset: number, limit: number): Promise<{ rows: Placed[]; total: number }>;
  /** each client's overlay at a glance; none: no Clients area */
  clients(): Promise<ClientSummary[]>;
  /** one client's overlay whole */
  client(id: string): Promise<ClientWhole>;
  /** records whose title or id holds every word, live first */
  findRecords(words: readonly string[], under: FindUnder, limit: number): Promise<Placed[]>;
  /** the Canon commit the index holds */
  head(): Promise<string | null>;
  /** every link, narrow (Map); none: the Map draws no lines */
  edges?(): ReturnType<typeof canonEdges>;
}

/** A folder of files: the next level under `prefix`, folders first. */
function fileTree(base: string, prefix: string, files: readonly FileRef[]): Item[] {
  const dirs = new Map<string, number>();
  const leaves: Item[] = [];
  for (const f of files) {
    if (!f.path.startsWith(prefix)) continue;
    const [head = "", ...more] = f.path.slice(prefix.length).split("/");
    if (more.length) dirs.set(head, (dirs.get(head) ?? 0) + 1);
    else
      leaves.push({
        path: join(base, head),
        name: head,
        kind: "file",
        sub: f.text ? sizeLabel(f.size) : `${sizeLabel(f.size)}, binary`,
        leaf: true,
      });
  }
  return [
    ...[...dirs]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, n]): Item => ({ path: join(base, d), name: d, kind: "folder", count: n })),
    ...leaves.sort((a, b) => a.name.localeCompare(b.name)),
  ];
}

const once = <V>(load: () => Promise<V>) => {
  let p: Promise<V> | undefined;
  return () => {
    p ??= load();
    return p;
  };
};
const memo = <K, V>(load: (k: K) => Promise<V>) => {
  const m = new Map<K, Promise<V>>();
  return (k: K) => {
    let p = m.get(k);
    if (!p) {
      p = load(k);
      m.set(k, p);
    }
    return p;
  };
};

export function canonTree(src: CanonSource): Adapter {
  /**
   * A record's home: live guides and sets under their topic, video sources under references. A
   * retired record leaves its topic (the topic shows live ones): it sits under records/.
   * A client's (D7): its live sets under `clients/<c>/topics/<t>/sets`, the rest under
   * `clients/<c>/records/<type>` (a client guide too: two on one topic would share a home).
   */
  const recordHome = (r: Placed): string => {
    const live = r.status === "live";
    if (r.client) {
      const at = join(ROOT, "clients", r.client);
      if (live && r.type === "rule" && r.topic) return join(at, "topics", r.topic, "sets", r.id);
      return join(at, "records", r.type ?? "missing", r.id);
    }
    if (live && r.type === "guide" && r.topic) return join(ROOT, "topics", r.topic, "guide");
    if (live && r.type === "rule" && r.topic) return join(ROOT, "topics", r.topic, "sets", r.id);
    if (r.type === "source" && r.kind && src.videoKinds.includes(r.kind))
      return join(ROOT, "references", r.id);
    return join(ROOT, "records", r.type ?? "missing", r.id);
  };
  const recordRow = (r: Placed): Item => ({
    path: recordHome(r),
    name: r.title ?? r.id,
    sub: r.id,
    kind: r.type ?? "record",
    ...(r.status !== "live" ? { mark: r.status } : {}),
    ...(r.type ? {} : { leaf: true }),
  });

  const indexed = once(async () => {
    if (!(await src.indexed()))
      throw new PathError(
        "not-indexed",
        "Canon has no index here yet: wren canon sync (this Mac: --here)",
      );
    return true;
  });
  const topic = memo(async (name: string) => {
    await indexed();
    return src.topic(name);
  });
  const record = memo(async (id: string) => {
    await indexed();
    return src.record(id);
  });
  const reference = memo(async (id: string) => {
    await indexed();
    return src.reference(id);
  });
  const rootFiles = once(async () => {
    await indexed();
    return src.rootFiles();
  });
  const clientList = once(async () => {
    await indexed();
    return src.clients();
  });
  const client = memo(async (id: string) => {
    await indexed();
    return src.client(id);
  });
  const placed = async (ids: string[]): Promise<Map<string, Placed>> =>
    ids.length ? new Map((await src.placed(ids)).map((r) => [r.id, r])) : new Map();
  /** What took a retired record's place, followed to a live one; null when none. */
  const movedTo = async (id: string): Promise<Placed | null> => {
    let at = id;
    for (let i = 0; i < 5; i++) {
      const r = await src.into(at);
      if (!r) return null;
      if (r.status === "live") return at === id ? null : r;
      if (!r.into) return null;
      at = r.into;
    }
    return null;
  };
  /** A topic folded away: its retired guide's `into`, as the topic that took it. */
  const movedTopic = async (name: string): Promise<string | null> => {
    const g = await src.foldedGuide(name);
    const to = g ? await movedTo(g) : null;
    return to?.topic ?? null;
  };
  /** Cited records as rows, in their order; one not in Canon is `missing`. */
  const rowsOf = async (links: RecordLink[]): Promise<Item[]> => {
    const by = await placed(links.map((l) => l.id));
    return links.map((l) => recordRow(by.get(l.id) ?? { ...l, status: "missing", type: null }));
  };
  const relation = (home: string, rel: string, targets: Item[]) =>
    targets.map((t) => aliasOf(join(home, rel), t));

  const setOf = async (owner: string, id: string): Promise<{ t: TopicWhole; set: RuleSet }> => {
    const t = await topic(owner);
    const set = t.sets.find((s) => s.id === id);
    if (!set) throw new PathError("unknown-path", `${owner} owns no set ${id}`);
    return { t, set };
  };
  /** a source under a topic as a row: a reference (poster) or a plain source */
  const sourceRows = (t: TopicWhole) => {
    const m = new Map<string, Item>();
    for (const r of t.references)
      m.set(r.id, {
        path: recordHome({
          id: r.id,
          type: "source",
          title: r.title,
          status: "live",
          kind: r.kind,
        }),
        name: r.title,
        sub: [r.platform, r.handle ? `@${r.handle}` : null].filter(Boolean).join(" · "),
        kind: "reference",
        ...(r.poster ? { poster: r.poster } : {}),
      });
    for (const e of t.sources) m.set(e.id, recordRow({ ...e, type: "source", kind: e.kind }));
    return m;
  };

  /** The rows under a topic, by layer. */
  const topicRows = async (name: string, rest: string[]): Promise<Item[]> => {
    const t = await topic(name);
    const base = join(ROOT, "topics", name);
    const checks = t.files.filter((f) => f.path.startsWith(`topics/${name}/checks/`));
    const others = t.files.filter((f) => !f.path.startsWith(`topics/${name}/checks/`));
    const [layer, ...under] = rest;
    if (!layer) {
      const rows: Item[] = [];
      if (t.skill)
        rows.push({
          path: join(base, "skill"),
          name: "Skill",
          sub: "SKILL.md",
          kind: "skill",
          leaf: true,
        });
      if (t.guide)
        rows.push({
          path: join(base, "guide"),
          name: "Procedure",
          sub: t.guide.title,
          kind: "guide",
        });
      rows.push({
        path: join(base, "sets"),
        name: "Rule sets",
        kind: "layer",
        count: t.sets.length + t.borrowed.length,
      });
      if (t.references.length)
        rows.push({
          path: join(base, "references"),
          name: "References",
          kind: "layer",
          count: t.references.length,
        });
      if (t.sources.length)
        rows.push({
          path: join(base, "sources"),
          name: "Sources",
          kind: "layer",
          count: t.sources.length,
        });
      if (checks.length)
        rows.push({
          path: join(base, "checks"),
          name: "Checks",
          kind: "layer",
          count: checks.length,
        });
      if (t.notes != null)
        rows.push({
          path: join(base, "notes"),
          name: "Notes",
          sub: "notes.md",
          kind: "notes",
          leaf: true,
        });
      if (t.conflicts.length)
        rows.push({
          path: join(base, "conflicts"),
          name: "Conflicts",
          kind: "layer",
          count: t.conflicts.length,
        });
      if (others.length)
        rows.push({
          path: join(base, "files"),
          name: "Files",
          kind: "layer",
          count: others.length,
        });
      return rows;
    }
    const at = join(base, layer);
    // these hold alias rows only: a row under one reads at its home
    if (under.length && ["skill", "notes", "references", "sources", "conflicts"].includes(layer))
      throw new PathError("unknown-path", `${join(at, ...under)} is an alias: read it at its home`);
    switch (layer) {
      case "skill":
      case "notes":
        return [];
      case "guide": {
        const cites = t.guide ? await rowsOf(t.guide.cites) : [];
        if (!under.length) return relationRow(at, "cites", cites);
        if (under.join("/") === "cites") return relation(at, "cites", cites);
        throw new PathError("unknown-path", `${name}'s guide has no ${under.join("/")}`);
      }
      case "sets": {
        const [id, ...deeper] = under;
        if (!id)
          return [
            ...t.sets.map((s) => ({
              path: join(at, s.id),
              name: s.id,
              sub: s.title,
              kind: "set",
              count: s.lines,
            })),
            ...t.borrowed.map((s) =>
              aliasOf(
                at,
                {
                  path: join(ROOT, "topics", s.topic ?? name, "sets", s.id),
                  name: s.id,
                  sub: s.title,
                  kind: "set",
                  count: s.lines,
                },
                s.topic ?? undefined,
              ),
            ),
          ];
        return setRows(name, id, deeper);
      }
      case "references":
      case "sources": {
        const rows = sourceRows(t);
        const ids =
          layer === "references" ? t.references.map((r) => r.id) : t.sources.map((e) => e.id);
        return ids.flatMap((i) => {
          const r = rows.get(i);
          return r ? [aliasOf(at, r)] : [];
        });
      }
      case "conflicts":
        return t.conflicts.map((c) => aliasOf(at, recordRow({ ...c, type: "conflict" })));
      case "checks":
        return fileTree(
          join(at, ...under),
          `topics/${name}/checks/${under.map((u) => `${u}/`).join("")}`,
          checks,
        );
      case "files":
        return fileTree(
          join(at, ...under),
          `topics/${name}/${under.map((u) => `${u}/`).join("")}`,
          others,
        );
      default:
        throw new PathError("unknown-path", `${name} has no ${layer}`);
    }
  };

  /** Under a set's home: its lines and relations; under a line, what backs it. */
  const setRows = async (owner: string, id: string, rest: string[]): Promise<Item[]> => {
    const { t, set } = await setOf(owner, id);
    const home = join(ROOT, "topics", owner, "sets", id);
    const usedBy = set.usedBy.map(
      (u): Item => ({
        path: join(ROOT, "topics", u.topic),
        name: u.topic,
        sub: u.title,
        kind: "topic",
      }),
    );
    const [seg, ...deeper] = rest;
    if (!seg)
      return [
        ...set.rules.map((r) => ({
          path: join(home, r.id),
          name: r.id,
          sub: r.text,
          kind: "line",
          mark: r.backing,
        })),
        ...relationRow(home, "used-by", usedBy),
        ...relationRow(home, "cites", await rowsOf(set.cites)),
      ];
    if (seg === "used-by") return relation(home, seg, usedBy);
    if (seg === "cites") return relation(home, seg, await rowsOf(set.cites));
    const line = set.rules.find((r) => r.id === seg);
    if (!line) throw new PathError("unknown-path", `${id} has no line ${seg}`);
    const sources = sourceRows(t);
    const backers = line.sources.flatMap((s) => {
      const r = sources.get(s);
      return r ? [r] : [];
    });
    const lineHome = join(home, seg);
    // each client line in its place (D7)
    const overrides = line.overrides.map(
      (o): Item => ({
        path: join(ROOT, "clients", o.client, "topics", o.topic ?? "", "sets", o.set, o.line),
        name: o.line,
        // whose: a mark reads one fixed word
        sub: `${o.client}: ${o.text}`,
        kind: "line",
        ...(o.stale ? { mark: "stale" } : {}),
      }),
    );
    if (!deeper.length)
      return [
        ...relationRow(lineHome, "backed-by", backers),
        ...relationRow(lineHome, "overridden-by", overrides),
      ];
    if (deeper.length === 1 && deeper[0] === "backed-by")
      return relation(lineHome, "backed-by", backers);
    if (deeper.length === 1 && deeper[0] === "overridden-by")
      return relation(lineHome, "overridden-by", overrides);
    throw new PathError("unknown-path", `${seg} has no ${deeper.join("/")}`);
  };

  /** Under a client (D7): its topics, sets and lines, its records, its files. */
  const clientRows = async (id: string, rest: string[], offset: number): Promise<Page> => {
    const c = await client(id);
    const at = join(ROOT, "clients", id);
    const [part, ...under] = rest;
    const topics = [
      ...new Set([
        ...c.sets.map((s) => s.topic),
        ...c.files.flatMap((f) => {
          const m = /^clients\/[^/]+\/topics\/([^/]+)\//.exec(f.path);
          return m?.[1] ? [m[1]] : [];
        }),
      ]),
    ].sort();
    const notesOf = (t: string) =>
      c.files.find((f) => f.path === `clients/${id}/topics/${t}/notes.md`);
    if (!part) {
      const rows: Item[] = [];
      if (topics.length)
        rows.push({ path: join(at, "topics"), name: "Topics", kind: "area", count: topics.length });
      rows.push({
        path: join(at, "records"),
        name: "Records",
        kind: "area",
        count: c.records.length,
      });
      if (c.files.length)
        rows.push({ path: join(at, "files"), name: "Files", kind: "area", count: c.files.length });
      return { items: rows };
    }
    switch (part) {
      case "topics": {
        const [t, layer, setId, line, rel, more] = under;
        if (!t)
          return {
            items: topics.map((name) => ({
              path: join(at, "topics", name),
              name,
              kind: "topic",
              count: c.sets.filter((s) => s.topic === name).length,
            })),
          };
        if (!topics.includes(t)) throw new PathError("unknown-path", `${id} has no topic ${t}`);
        const tAt = join(at, "topics", t);
        const sets = c.sets.filter((s) => s.topic === t);
        if (!layer) {
          const rows: Item[] = [];
          if (sets.length)
            rows.push({
              path: join(tAt, "sets"),
              name: "Rule sets",
              kind: "layer",
              count: sets.length,
            });
          if (notesOf(t))
            rows.push({
              path: join(tAt, "notes"),
              name: "Notes",
              sub: "notes.md",
              kind: "notes",
              leaf: true,
            });
          return { items: rows };
        }
        if (layer === "notes" && notesOf(t) && !setId) return { items: [] };
        if (layer !== "sets") throw new PathError("unknown-path", `${id}'s ${t} has no ${layer}`);
        if (!setId)
          return {
            items: sets.map((s) => ({
              path: join(tAt, "sets", s.id),
              name: s.id,
              sub: s.title,
              kind: "set",
              count: s.lines,
            })),
          };
        const s = sets.find((x) => x.id === setId);
        if (!s) throw new PathError("unknown-path", `${id}'s ${t} has no set ${setId}`);
        const home = join(tAt, "sets", s.id);
        if (!line)
          return {
            items: [
              ...s.rules.map((r) => ({
                path: join(home, r.id),
                name: r.id,
                sub: r.text,
                kind: "line",
                ...(r.replaces ? { mark: r.replaces.stale ? "stale" : "override" } : {}),
              })),
              ...relationRow(home, "cites", await rowsOf(s.cites)),
            ],
          };
        if (line === "cites" && !rel)
          return { items: relation(home, "cites", await rowsOf(s.cites)) };
        const r = s.rules.find((x) => x.id === line);
        if (!r) throw new PathError("unknown-path", `${s.id} has no line ${line}`);
        const rp = r.replaces;
        // a base line gone or its set retired: the preview says so; no row to open
        const target: Item[] =
          rp && !rp.gone && rp.topic
            ? [
                {
                  path: join(ROOT, "topics", rp.topic, "sets", rp.set, rp.line),
                  name: rp.line,
                  sub: rp.text ?? "",
                  kind: "line",
                  ...(rp.stale ? { mark: "stale" } : {}),
                },
              ]
            : [];
        const lineHome = join(home, r.id);
        if (!rel) return { items: relationRow(lineHome, "replaces", target) };
        if (rel === "replaces" && more === undefined)
          return { items: relation(lineHome, "replaces", target) };
        throw new PathError(
          "unknown-path",
          `${r.id} has no ${[rel, more].filter(Boolean).join("/")}`,
        );
      }
      case "records": {
        const [type, rid, rel] = under;
        if (!type) {
          const n = new Map<string, number>();
          for (const r of c.records) n.set(r.type, (n.get(r.type) ?? 0) + 1);
          return {
            items: [...n]
              .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
              .map(([t, count]) => ({
                path: join(at, "records", t),
                name: t,
                kind: "type",
                count,
              })),
          };
        }
        const base = join(at, "records", type);
        if (!rid) {
          const all = c.records.filter((r) => r.type === type);
          const items = all.slice(offset, offset + PAGE_SIZE).map((r) => {
            const row = recordRow({ ...r, client: id });
            return row.path === join(base, r.id)
              ? row
              : { ...row, path: join(base, r.id), original: row.path };
          });
          const next = offset + items.length;
          return { items, ...(next < all.length ? { next: String(next) } : {}) };
        }
        return { items: await recordRelations(join(base, rid), rid, rel) };
      }
      case "files":
        return {
          items: fileTree(
            join(at, "files", ...under),
            `clients/${id}/${under.map((u) => `${u}/`).join("")}`,
            c.files,
          ),
        };
      default:
        throw new PathError("unknown-path", `${id} has no ${part}`);
    }
  };

  const backsOf = async (id: string): Promise<Item[]> =>
    (await reference(id)).backs.map((b) => ({
      path: join(ROOT, "topics", b.topic ?? "", "sets", b.set, b.line),
      name: b.line,
      sub: b.text,
      kind: "line",
    }));
  const citedBy = async (id: string) => rowsOf((await record(id)).citedBy);

  const groups = once(() => src.referenceGroups());
  /** a page of one group's references; each row under its group (`item()` answers it at home) */
  const referenceRows = async (
    offset: number,
    by: ReferencesBy,
    group: readonly string[],
  ): Promise<Page> => {
    const p = await src.references(offset, PAGE_SIZE, by);
    return {
      items: p.rows.map((r) => ({
        path: join(ROOT, "references", ...group, r.id),
        name: r.title,
        sub: [r.platform, r.handle ? `@${r.handle}` : null].filter(Boolean).join(" · "),
        kind: "reference",
        ...(r.poster ? { poster: r.poster } : {}),
      })),
      ...(p.next != null ? { next: String(p.next) } : {}),
    };
  };
  /** a group's folder rows (`list`) or the references it holds (`by`); null: no group */
  const groupOf = (
    rest: readonly string[],
  ): {
    list?: (g: ReferenceGroups, titles: Map<string, string>) => Item[];
    by?: ReferencesBy;
  } | null => {
    const [g, key, more] = rest;
    if (more !== undefined) return null;
    const under = (...s: string[]) => join(ROOT, "references", ...s);
    if (g === GROUP.all && !key) return { by: {} };
    if (g === GROUP.yours && !key) return { by: { yours: true } };
    if (g === GROUP.topic)
      return key
        ? { by: { usedBy: key } }
        : {
            // its title the sub, as in Topics
            list: (x, titles) =>
              x.topics.map((t) => {
                const title = titles.get(t.topic);
                return {
                  path: under(GROUP.topic, t.topic),
                  name: t.topic,
                  kind: "folder",
                  count: t.n,
                  ...(title && title !== t.topic ? { sub: title } : {}),
                };
              }),
          };
    if (g === GROUP.creator)
      return key
        ? { by: { handle: key } }
        : {
            list: (x) =>
              x.creators.map((c) => ({
                path: under(GROUP.creator, c.handle),
                name: c.handle,
                sub: c.platform,
                kind: "folder",
                count: c.n,
              })),
          };
    return null;
  };

  /** A record's relation rows at `home`, or one relation's targets. */
  const recordRelations = async (home: string, id: string, rel?: string): Promise<Item[]> => {
    const r = await record(id);
    const into = async () => {
      const to = await movedTo(id);
      return to ? [recordRow(to)] : [];
    };
    if (!rel)
      return [
        ...relationRow(home, "into", await into()),
        ...relationRow(home, "cites", await rowsOf(r.cites)),
        ...relationRow(home, "cited-by", await rowsOf(r.citedBy)),
      ];
    if (rel === "into") return relation(home, rel, await into());
    if (rel === "cites") return relation(home, rel, await rowsOf(r.cites));
    if (rel === "cited-by") return relation(home, rel, await rowsOf(r.citedBy));
    throw new PathError("unknown-path", `${id} has no ${rel}`);
  };

  const children = async (path: string, after?: string): Promise<Page> => {
    await indexed();
    const [root, area, ...rest] = segments(path);
    if (root !== ROOT) throw new PathError("unknown-path", `not a Canon path: ${path}`);
    const offset = Number(after ?? 0) || 0;
    switch (area) {
      case undefined: {
        const [n, files, clients] = await Promise.all([src.counts(), rootFiles(), clientList()]);
        return {
          items: [
            { path: join(ROOT, "topics"), name: "Topics", kind: "area", count: n.topics },
            {
              path: join(ROOT, "references"),
              name: "References",
              kind: "area",
              count: n.references,
            },
            { path: join(ROOT, "records"), name: "Records", kind: "area", count: n.records },
            { path: join(ROOT, "files"), name: "Files", kind: "area", count: files.length },
            // only once a client has an overlay
            ...(clients.length
              ? [
                  {
                    path: join(ROOT, "clients"),
                    name: "Clients",
                    kind: "area",
                    count: clients.length,
                  },
                ]
              : []),
          ],
        };
      }
      case "topics": {
        const [name, ...under] = rest;
        if (!name)
          return {
            items: (await src.home()).topics.map((t) => ({
              path: join(ROOT, "topics", t.name),
              name: t.name,
              sub: t.title === t.name ? (t.description ?? undefined) : t.title,
              kind: "topic",
              count: t.sets,
            })) as Item[],
          };
        return { items: await topicRows(name, under) };
      }
      case "references": {
        const [id, rel] = rest;
        if (!id) {
          const [g, n] = await Promise.all([groups(), src.counts()]);
          const folder = (seg: string, count: number, sub?: string): Item => ({
            path: join(ROOT, "references", seg),
            name: GROUP_NAME[seg] ?? seg,
            kind: "folder",
            count,
            ...(sub ? { sub } : {}),
          });
          return {
            items: [
              folder(GROUP.topic, g.topics.length, "the topics that cite them"),
              folder(GROUP.yours, g.yours),
              folder(GROUP.creator, g.creators.length),
              folder(GROUP.all, n.references, "newest saved first"),
            ],
          };
        }
        const group = groupOf(rest);
        if (group?.list) {
          const [g, h] = await Promise.all([groups(), src.home()]);
          return { items: group.list(g, new Map(h.topics.map((t) => [t.name, t.title]))) };
        }
        if (group?.by) return referenceRows(offset, group.by, rest);
        const home = join(ROOT, "references", id);
        if (!rel)
          return {
            items: [
              ...relationRow(home, "backs", await backsOf(id)),
              ...relationRow(home, "cited-by", await citedBy(id)),
            ],
          };
        if (rel === "backs") return { items: relation(home, rel, await backsOf(id)) };
        if (rel === "cited-by") return { items: relation(home, rel, await citedBy(id)) };
        throw new PathError("unknown-path", `${id} has no ${rel}`);
      }
      case "records": {
        const [type, id, rel] = rest;
        if (!type)
          return {
            items: (await src.types()).map((t) => ({
              path: join(ROOT, "records", t.type),
              name: t.type,
              kind: "type",
              count: t.n,
            })),
          };
        const base = join(ROOT, "records", type);
        if (!id) {
          const { rows, total } = await src.ofType(type, offset, PAGE_SIZE);
          const items = rows.map((r) => {
            const row = recordRow(r);
            // named by its id: a guide's home ends in `guide`, so aliasOf would make records/guide/guide
            return row.path === join(base, r.id)
              ? row
              : { ...row, path: join(base, r.id), original: row.path };
          });
          const next = offset + rows.length;
          return { items, ...(next < total ? { next: String(next) } : {}) };
        }
        return { items: await recordRelations(join(base, id), id, rel) };
      }
      case "clients": {
        const [id, ...under] = rest;
        if (!id)
          return {
            items: (await clientList()).map((c) => ({
              path: join(ROOT, "clients", c.client),
              name: c.client,
              kind: "client",
              count: c.records,
              ...(c.overrides
                ? {
                    sub: `${c.overrides} override${c.overrides === 1 ? "" : "s"}${c.stale ? `, ${c.stale} stale` : ""}`,
                  }
                : {}),
            })),
          };
        return clientRows(id, under, offset);
      }
      case "files":
        return {
          items: fileTree(
            join(ROOT, "files", ...rest),
            rest.map((r) => `${r}/`).join(""),
            await rootFiles(),
          ),
        };
      default:
        throw new PathError("unknown-path", `Canon has no ${area}`);
    }
  };

  /** Every link between homes (designs/2026-11-12-explorer.md, Map): cites, backs, into. */
  const allEdges = once(async (): Promise<PathEdge[]> => {
    await indexed();
    if (!src.edges) return [];
    const { places, cites, backs } = await src.edges();
    // a reference's Map end sits under All, the one group that holds every reference, so a fold lifts it to a box
    const onMap = (h: string) => {
      const [, area, id, more] = segments(h);
      return area === "references" && id && more === undefined
        ? join(ROOT, "references", GROUP.all, id)
        : h;
    };
    const home = new Map(places.map((p) => [p.id, onMap(recordHome({ ...p, title: null }))]));
    const out = new Map<string, PathEdge>();
    const put = (rel: string, from: string | undefined, to: string | undefined) => {
      if (!from || !to || from === to) return;
      const id = `${rel}:${from}>${to}`;
      out.set(id, { id, from, to, rel });
    };
    for (const c of cites) put("cites", home.get(c.from), home.get(c.to));
    for (const b of backs)
      put("backs", home.get(b.source), join(ROOT, "topics", b.topic, "sets", b.set, b.line));
    for (const p of places) if (p.into) put("into", home.get(p.id), home.get(p.into));
    return [...out.values()];
  });

  const adapter: Adapter = {
    root: ROOT,
    children,
    edges: async (at) => {
      const inside = (p: string) => p === at || p.startsWith(`${at}/`);
      return (await allEdges()).filter((e) => inside(e.from) || inside(e.to));
    },
    item: async (path) => {
      await indexed();
      const segs = segments(path);
      const [root, area, a, b] = segs;
      if (root !== ROOT) throw new PathError("unknown-path", `not a Canon path: ${path}`);
      if (!area) return { path: ROOT, name: "Canon", kind: "root" };
      if (segs.length === 2) {
        if (!["topics", "references", "records", "files", "clients"].includes(area))
          throw new PathError("unknown-path", `Canon has no ${area}`);
        return { path, name: area[0]?.toUpperCase() + area.slice(1), kind: "area" };
      }
      if (area === "topics" && a && segs.length === 3) {
        // a topic folded into another answers as that one
        const to = await topic(a).then(
          (t) => ({ name: a, t }),
          async (e: unknown) => {
            const into = e instanceof PathError ? await movedTopic(a) : null;
            if (!into) throw e;
            return { name: into, t: await topic(into) };
          },
        );
        const home = join(ROOT, "topics", to.name);
        return {
          path: home,
          name: to.name,
          sub: to.t.title,
          kind: "topic",
          ...(home !== path ? { was: path } : {}),
        };
      }
      // a references group, or a reference in one: straight, at its home
      if (area === "references" && a && GROUPS.has(a)) {
        // all and yours hold references; by-topic and by-creator hold a folder each
        const flat = a === GROUP.all || a === GROUP.yours;
        if (segs.length === 3) return { path, name: GROUP_NAME[a] ?? a, kind: "folder" };
        if (!flat && b && segs.length === 4) return { path, name: b, kind: "folder" };
        const id = segs[flat ? 3 : 4];
        if (id && segs.length === (flat ? 4 : 5)) {
          const r = (await placed([id])).get(id);
          // a client's record never opens at a base path
          if (!r || r.client) throw new PathError("unknown-path", `no reference ${id}`);
          return recordRow(r);
        }
        throw new PathError("unknown-path", `nothing at ${path}`);
      }
      // a record by id, straight: no list to page through
      if (
        (area === "references" && a && segs.length === 3) ||
        (area === "records" && b && segs.length === 4)
      ) {
        const id = (area === "references" ? a : b) as string;
        const r = (await placed([id])).get(id);
        if (!r || r.client || (area === "records" && r.type !== a))
          throw new PathError("unknown-path", `no ${area === "records" ? a : "reference"} ${id}`);
        return recordRow(r);
      }
      if (area === "records" && a && segs.length === 3) return { path, name: a, kind: "type" };
      if (area === "clients" && a) {
        const c = await client(a);
        const [, , , part, x, y] = segs;
        if (segs.length === 3) return { path, name: a, kind: "client", count: c.summary.records };
        // a record by id, straight: its type's list pages
        if (part === "records" && x && y && segs.length === 6) {
          const r = (await placed([y])).get(y);
          if (!r || r.client !== a || r.type !== x)
            throw new PathError("unknown-path", `${a} has no ${x} ${y}`);
          return recordRow(r);
        }
        if (part === "files" && segs.length > 4) {
          const rel = `clients/${a}/${segs.slice(4).join("/")}`;
          if (c.files.some((f) => f.path === rel))
            return { path, name: segs.at(-1) ?? rel, kind: "file", leaf: true };
          if (c.files.some((f) => f.path.startsWith(`${rel}/`)))
            return { path, name: segs.at(-1) ?? rel, kind: "folder" };
          throw new PathError("unknown-path", `no file ${rel}`);
        }
        return itemFromParent(adapter, path);
      }
      if (area === "files") {
        const rel = segs.slice(2).join("/");
        const files = await rootFiles();
        if (files.some((f) => f.path === rel))
          return { path, name: segs.at(-1) ?? rel, kind: "file", leaf: true };
        if (files.some((f) => f.path.startsWith(`${rel}/`)))
          return { path, name: segs.at(-1) ?? rel, kind: "folder" };
        throw new PathError("unknown-path", `no file ${rel}`);
      }
      return itemFromParent(adapter, path).catch(async (e: unknown) => {
        // a set retired into another: its home now
        const set = area === "topics" && b === "sets" && segs.length === 5 ? segs[4] : undefined;
        const to = set && e instanceof PathError ? await movedTo(set) : null;
        if (to?.type !== "rule") throw e;
        return {
          ...recordRow(to),
          name: to.id,
          ...(to.title ? { sub: to.title } : {}),
          kind: "set",
          was: path,
        };
      });
    },
    whole: async (path) => {
      const it = await adapter.item(path);
      const home = it.path;
      const [, area, a, layer, set, line] = segments(home);
      const links = await linksOf(adapter, it);
      const out: Whole = { ...it, links };
      if (area === "clients" && a) {
        const c = await client(a);
        const segs = segments(home);
        const [, , , part, t, sub, setId, lineId] = segs;
        if (!part) return { ...out, data: c.summary };
        if (part === "topics" && t && sub === "notes") {
          const f = await src.file(`clients/${a}/topics/${t}/notes.md`);
          return { ...out, body: f.body ?? "", data: f };
        }
        const s =
          part === "topics" && sub === "sets"
            ? c.sets.find((x) => x.id === setId && x.topic === t)
            : undefined;
        if (s && !lineId) return { ...out, body: s.body, data: s };
        if (s && lineId) {
          const l = s.rules.find((r) => r.id === lineId);
          return { ...out, body: l?.text ?? "", data: { set: s.id, setTitle: s.title, line: l } };
        }
        if (part === "records" && sub) {
          const r = await record(sub);
          return { ...out, body: r.body, data: r };
        }
        if (part === "files" && it.kind === "file") {
          const f = await src.file(`clients/${a}/${segs.slice(4).join("/")}`);
          return { ...out, body: f.body ?? "", data: f };
        }
        return out;
      }
      if (area === "topics" && a) {
        const t = await topic(a);
        if (!layer) return { ...out, data: t };
        if (layer === "skill") return { ...out, body: t.skill ?? "" };
        if (layer === "notes") return { ...out, body: t.notes ?? "" };
        if (layer === "guide") return { ...out, body: t.guide?.body ?? "", data: t.guide };
        if (layer === "sets" && set) {
          const { set: s } = await setOf(a, set);
          if (!line) return { ...out, body: s.body, data: s };
          const l = s.rules.find((r) => r.id === line);
          return { ...out, body: l?.text ?? "", data: { set: s.id, setTitle: s.title, line: l } };
        }
        if ((layer === "checks" || layer === "files") && it.kind === "file") {
          const rest = segments(home).slice(4).join("/");
          const f = await src.file(`topics/${a}/${layer === "checks" ? "checks/" : ""}${rest}`);
          return { ...out, body: f.body ?? "", data: f };
        }
        return out;
      }
      if (area === "references" && a && !GROUPS.has(a)) {
        const r = await reference(a);
        return { ...out, body: r.transcript ?? r.caption ?? r.note?.text ?? "", data: r };
      }
      if (area === "records" && layer) {
        const r = await record(layer);
        return { ...out, body: r.body, data: r };
      }
      if (area === "files" && it.kind === "file") {
        const f = await src.file(segments(home).slice(2).join("/"));
        return { ...out, body: f.body ?? "", data: f };
      }
      return out;
    },
    find: async (q, under) => {
      await indexed();
      const words = q.split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const [, area, a] = segments(under ?? ROOT);
      // the root finds everything; a base area the base only; Clients the clients (D7)
      const where: FindUnder =
        area === "clients"
          ? { client: a ?? "*" }
          : area === "topics" && a
            ? { topic: a, client: null }
            : area === "records" && a
              ? { type: a, client: null }
              : area === "references"
                ? { references: true, client: null }
                : area
                  ? { client: null }
                  : {};
      const records = area === "files" ? [] : await src.findRecords(words, where, PAGE_SIZE);
      const has = (text: string) =>
        words.every((x) => text.toLowerCase().includes(x.toLowerCase()));
      const clientFiles =
        area === "clients" && a
          ? (await client(a)).files
              .filter((f) => has(f.path))
              .map(
                (f): Item => ({
                  path: join(ROOT, "clients", a, "files", f.path.slice(`clients/${a}/`.length)),
                  name: f.path,
                  kind: "file",
                  leaf: true,
                }),
              )
          : [];
      const topics =
        area && area !== "topics"
          ? []
          : (await src.home()).topics
              .filter(
                (t) =>
                  (!a || t.name === a) &&
                  words.every((x) =>
                    `${t.name} ${t.title}`.toLowerCase().includes(x.toLowerCase()),
                  ),
              )
              .map(
                (t): Item => ({
                  path: join(ROOT, "topics", t.name),
                  name: t.name,
                  sub: t.title,
                  kind: "topic",
                }),
              );
      const files =
        area && area !== "files"
          ? []
          : (await rootFiles())
              .filter((f) => words.every((x) => f.path.toLowerCase().includes(x.toLowerCase())))
              .map(
                (f): Item => ({
                  path: join(ROOT, "files", f.path),
                  name: f.path,
                  kind: "file",
                  leaf: true,
                }),
              );
      return [...topics, ...records.map(recordRow), ...files, ...clientFiles];
    },
    stamp: async () => {
      await indexed();
      return { root: ROOT, head: await src.head() };
    },
  };
  return adapter;
}
