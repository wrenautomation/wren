/**
 * Canon as a tree (designs/2026-11-12-explorer.md D4): `canon/topics/<topic>/<layer>/…`, a set's
 * lines under it, `canon/references/<id>`, `canon/records/<type>/<id>`, `canon/files/<path>`.
 * A set another topic borrows shows there as an alias; `backs`, `cites` and `used-by` are
 * relation folders. Reads only through a `CanonSource`: the index on a server (`canon.ts`), or
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
  type Page,
  PathError,
  relationRow,
  segments,
  sizeLabel,
  type Whole,
} from "@wren/core/paths";
import type { Reference, ReferenceWhole } from "@wren/research/canon-console";
import type {
  FileRef,
  FileWhole,
  Home,
  Link as RecordLink,
  RecordWhole,
  RuleSet,
  TopicWhole,
} from "@wren/research/canon-library";

const ROOT = "canon";
export const CANON_PAGE = 50;

/** A record with what its home needs. */
export type Placed = {
  id: string;
  type: string | null;
  title: string | null;
  status: string;
  topic?: string | null;
  kind?: string | null;
};

/** Where a find looks: one topic, one type, or the references. */
export interface FindUnder {
  topic?: string;
  type?: string;
  references?: boolean;
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
  /** references, newest saved first */
  references(after: number, limit: number): Promise<{ rows: Reference[]; next: number | null }>;
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
  /** records whose title or id holds every word, live first */
  findRecords(words: readonly string[], under: FindUnder, limit: number): Promise<Placed[]>;
  /** the Canon commit the index holds */
  head(): Promise<string | null>;
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
   */
  const recordHome = (r: Placed): string => {
    const live = r.status === "live";
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
  /** a source under a topic as a row: a reference (poster) or plain evidence */
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
    for (const e of t.evidence) m.set(e.id, recordRow({ ...e, type: "source", kind: e.kind }));
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
      if (t.evidence.length)
        rows.push({
          path: join(base, "evidence"),
          name: "Evidence",
          kind: "layer",
          count: t.evidence.length,
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
    if (under.length && ["skill", "notes", "references", "evidence", "conflicts"].includes(layer))
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
      case "evidence": {
        const rows = sourceRows(t);
        const ids =
          layer === "references" ? t.references.map((r) => r.id) : t.evidence.map((e) => e.id);
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
    if (!deeper.length) return relationRow(lineHome, "backed-by", backers);
    if (deeper[0] === "backed-by") return relation(lineHome, "backed-by", backers);
    throw new PathError("unknown-path", `${seg} has no ${deeper[0]}`);
  };

  const backsOf = async (id: string): Promise<Item[]> =>
    (await reference(id)).backs.map((b) => ({
      path: join(ROOT, "topics", b.topic ?? "", "sets", b.set, b.line),
      name: b.line,
      sub: b.text,
      kind: "line",
    }));
  const citedBy = async (id: string) => rowsOf((await record(id)).citedBy);

  const children = async (path: string, after?: string): Promise<Page> => {
    await indexed();
    const [root, area, ...rest] = segments(path);
    if (root !== ROOT) throw new PathError("unknown-path", `not a Canon path: ${path}`);
    const offset = Number(after ?? 0) || 0;
    switch (area) {
      case undefined: {
        const [n, files] = await Promise.all([src.counts(), rootFiles()]);
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
          const p = await src.references(offset, CANON_PAGE);
          return {
            items: p.rows.map((r) => ({
              path: join(ROOT, "references", r.id),
              name: r.title,
              sub: [r.platform, r.handle ? `@${r.handle}` : null].filter(Boolean).join(" · "),
              kind: "reference",
              ...(r.poster ? { poster: r.poster } : {}),
            })),
            ...(p.next != null ? { next: String(p.next) } : {}),
          };
        }
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
          const { rows, total } = await src.ofType(type, offset, CANON_PAGE);
          const items = rows.map((r) => {
            const row = recordRow(r);
            return row.path === join(base, r.id) ? row : aliasOf(base, row);
          });
          const next = offset + rows.length;
          return { items, ...(next < total ? { next: String(next) } : {}) };
        }
        const home = join(base, id);
        const r = await record(id);
        const into = async () => {
          const to = await movedTo(id);
          return to ? [recordRow(to)] : [];
        };
        if (!rel)
          return {
            items: [
              ...relationRow(home, "into", await into()),
              ...relationRow(home, "cites", await rowsOf(r.cites)),
              ...relationRow(home, "cited-by", await rowsOf(r.citedBy)),
            ],
          };
        if (rel === "into") return { items: relation(home, rel, await into()) };
        if (rel === "cites") return { items: relation(home, rel, await rowsOf(r.cites)) };
        if (rel === "cited-by") return { items: relation(home, rel, await rowsOf(r.citedBy)) };
        throw new PathError("unknown-path", `${id} has no ${rel}`);
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

  const adapter: Adapter = {
    root: ROOT,
    children,
    item: async (path) => {
      await indexed();
      const segs = segments(path);
      const [root, area, a, b] = segs;
      if (root !== ROOT) throw new PathError("unknown-path", `not a Canon path: ${path}`);
      if (!area) return { path: ROOT, name: "Canon", kind: "root" };
      if (segs.length === 2) {
        if (!["topics", "references", "records", "files"].includes(area))
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
      // a record by id, straight: no list to page through
      if (
        (area === "references" && a && segs.length === 3) ||
        (area === "records" && b && segs.length === 4)
      ) {
        const id = (area === "references" ? a : b) as string;
        const r = (await placed([id])).get(id);
        if (!r || (area === "records" && r.type !== a))
          throw new PathError("unknown-path", `no ${area === "records" ? a : "reference"} ${id}`);
        return recordRow(r);
      }
      if (area === "records" && a && segs.length === 3) return { path, name: a, kind: "type" };
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
      if (area === "references" && a) {
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
      const where: FindUnder =
        area === "topics" && a
          ? { topic: a }
          : area === "records" && a
            ? { type: a }
            : area === "references"
              ? { references: true }
              : {};
      const records = area === "files" ? [] : await src.findRecords(words, where, CANON_PAGE);
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
      return [...topics, ...records.map(recordRow), ...files];
    },
    stamp: async () => {
      await indexed();
      return { root: ROOT, head: await src.head() };
    },
  };
  return adapter;
}
