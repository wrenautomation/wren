/**
 * Canon's whole brain for the portal (designs/2026-11-12-canon-references.md D5): topics with their
 * guide, rule sets, skill and notes; every record of every type; every other file. Reads schema
 * `canon` (records, cites, files), never the repo. Read only.
 */
import { PortalRefusal } from "@wren/core/portal";
import type { Db } from "@wren/db";
import { type Backing, type Frontmatter, linesOf, RULE_LINE } from "@wrenautomation/knowledge";
import { type SQL, sql } from "drizzle-orm";
import type { Reference } from "./canon-console.js";

const REPO = "canon";
const PAGE = 50;
const SUMMARY = 280;

type Data = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export type Link = {
  id: string;
  type: string | null;
  title: string | null;
  /** `missing`: cited, not in Canon */
  status: string;
};
export interface Topic {
  name: string;
  title: string;
  description: string | null;
  guide: string | null;
  sets: number;
  lines: number;
  skill: boolean;
  notes: boolean;
  conflicts: number;
}
export type FileRef = {
  path: string;
  size: number;
  /** false: binary or too big; read it on GitHub */
  text: boolean;
};
export type Counted = {
  value: string;
  n: number;
};
export interface Home {
  indexed: boolean;
  head: string | null;
  topics: Topic[];
  types: Counted[];
  direction: (FileRef & { title: string })[];
  /** knowledge.json, shapes/, hooks/: files outside topics and direction */
  other: FileRef[];
  conflicts: Link[];
  /** rule sets a guide of another topic cites: the many-to-many between topics */
  shared: { id: string; title: string; owner: string | null; users: string[] }[];
  /** live records whose evidence is missing, retired, or changed since */
  stale: { id: string; type: string; title: string; cites: string; why: string }[];
}
export interface RuleLine {
  /** `VC-1` */
  id: string;
  text: string;
  /** human: his source or notes; agent: agent sources only; none: no ref */
  backing: Backing;
  /** source ids under the line, through findings and patterns */
  sources: string[];
}
export interface RuleSet {
  id: string;
  title: string;
  prefix: string | null;
  /** the owner topic */
  topic: string | null;
  body: string;
  /** the set's `[n]` point here, in order */
  cites: Link[];
  lines: number;
  rules: RuleLine[];
  /** other topics whose guide cites the set */
  usedBy: { topic: string; title: string }[];
}
/** A source under a topic, with the line ids it backs. */
export type SourceUnder = Link & { kind: string | null; tags: string[]; backs: string[] };
/** A source record as the reference shaper takes it. */
export type SourceRow = { id: string; title: string; created: string; data: Data };
export interface TopicWhole {
  name: string;
  title: string;
  description: string | null;
  guide: { id: string; title: string; body: string; cites: Link[] } | null;
  sets: RuleSet[];
  /** sets another topic owns that this topic's guide cites */
  borrowed: RuleSet[];
  skill: string | null;
  notes: string | null;
  files: FileRef[];
  conflicts: (Link & { body: string; state: string | null; lines: string[] })[];
  /** sources tagged `reference` under the guide and sets: the examples, with posters */
  references: (Reference & { backs: string[] })[];
  /** every other source under the guide and sets, at any depth */
  evidence: SourceUnder[];
  /** the repo on GitHub, for files the index keeps as size only */
  github: string;
}
export interface RecordRow {
  id: string;
  type: string;
  title: string;
  status: string;
  topic: string | null;
  updated: string;
  summary: string;
}
export interface RecordsPage {
  indexed: boolean;
  total: number;
  rows: RecordRow[];
  next: number | null;
  facets: { type: Counted[]; status: Counted[]; topic: Counted[] };
  /** files whose path or text matches `q` */
  files: FileRef[];
}
export interface RecordWhole {
  id: string;
  type: string;
  title: string;
  status: string;
  path: string;
  topic: string | null;
  body: string;
  /** frontmatter whole, minus what has its own field */
  data: Data;
  cites: Link[];
  citedBy: Link[];
  github: string;
}
export interface FileWhole extends FileRef {
  body: string | null;
  github: string;
}
export interface RecordFilters {
  type?: string | null;
  status?: string | null;
  topic?: string | null;
  tag?: string | null;
  q?: string | null;
  after?: number | null;
}

const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Words of a body for a list row: no frontmatter-ish heads, no markdown marks. */
function summaryOf(description: unknown, body: string): string {
  const d = str(description);
  if (d) return d.length > SUMMARY ? `${d.slice(0, SUMMARY)}…` : d;
  const text = body
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .join(" ")
    .replace(/[*_`>]|\[(\d+)\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > SUMMARY ? `${text.slice(0, SUMMARY)}…` : text;
}

/** A markdown file's text without its frontmatter. */
function withoutFrontmatter(text: string): string {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  return end < 0 ? text : text.slice(end + 4).replace(/^\n+/, "");
}

/** A rule line's words: no `- **XX-n**` head, no `[n]` refs. */
export const lineText = (line: string) =>
  line
    .replace(RULE_LINE, "")
    .replace(/\[(\d+)(?: [^\]]*)?\]|\[notes\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const lineCount = (body: string) => body.split("\n").filter((l) => RULE_LINE.test(l)).length;
const titleOf = (path: string, body: string | null) =>
  /^# (.+)$/m.exec(withoutFrontmatter(body ?? ""))?.[1]?.trim() ??
  (path.split("/").pop() ?? path).replace(/\.md$/, "");

/**
 * `references` shapes source rows for the page (posters, players); the console passes its own, so
 * this module needs no media store.
 */
export function canonLibraryApi(
  db: Db,
  remote: string,
  references: (rows: SourceRow[]) => Promise<Reference[]>,
) {
  const github = remote.replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/");
  const blob = (path: string) =>
    `${github}/blob/main/${path.split("/").map(encodeURIComponent).join("/")}`;
  const indexed = async () => {
    const [r] = await db.execute<{ t: string | null }>(
      sql`select to_regclass('canon.knowledge_files')::text as t`,
    );
    return !!r?.t;
  };
  const links = async (ids: string[]): Promise<Link[]> => {
    if (!ids.length) return [];
    const rows = await db.execute<{ id: string; type: string; title: string; status: string }>(
      sql`select id, type, title, status from canon.knowledge_records where repo = ${REPO} and id in (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})`,
    );
    const by = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => {
      const r = by.get(id);
      return r
        ? { id, type: r.type, title: r.title, status: r.status }
        : { id, type: null, title: null, status: "missing" };
    });
  };
  const list = (ids: string[]) =>
    sql.join(
      ids.map((i) => sql`${i}`),
      sql`, `,
    );
  const fileRows = (where: SQL) =>
    db.execute<FileRef & { body: string | null }>(
      sql`select path, size, body is not null as text, body from canon.knowledge_files where repo = ${REPO} and ${where} order by path`,
    );

  return {
    /** Canon at a glance: topics, counts, direction, open conflicts, what needs a look. */
    home: async (): Promise<Home> => {
      const empty: Home = {
        indexed: false,
        head: null,
        topics: [],
        types: [],
        direction: [],
        other: [],
        conflicts: [],
        shared: [],
        stale: [],
      };
      if (!(await indexed())) return empty;
      const [head, owned, types, files, conflicts, stale, shared] = await Promise.all([
        db.execute<{ value: string }>(
          sql`select value from canon.knowledge_meta where repo = ${REPO} and key = 'head'`,
        ),
        db.execute<{
          id: string;
          type: string;
          title: string;
          topic: string;
          body: string;
          data: Data;
        }>(
          sql`select id, type, title, topic, body, data from canon.knowledge_records where repo = ${REPO} and status = 'live' and type in ('guide', 'rule') and topic is not null`,
        ),
        db.execute<Counted>(
          sql`select type as value, count(*)::int as n from canon.knowledge_records where repo = ${REPO} and status = 'live' group by type order by n desc`,
        ),
        fileRows(sql`path not like 'topics/%/%/%'`),
        db.execute<{ id: string; title: string; status: string; topic: string | null }>(
          sql`select id, title, status, data->>'topic' as topic from canon.knowledge_records where repo = ${REPO} and type = 'conflict' and status = 'live' and data->>'state' = 'open' order by id`,
        ),
        // narrow rows once, then hash joins: 9k cites by index lookup into wide rows took 110 ms on prod, this 62
        db.execute<Home["stale"][number]>(sql`
          with k as materialized (
            select id, type, title, status, coalesce(data->>'changed', created) as at
            from canon.knowledge_records where repo = ${REPO})
          select r.id, r.type, r.title, c."to" as cites,
            case when t.id is null then 'missing' when t.status = 'retired' then 'retired' else 'changed' end as why
          from canon.knowledge_cites c
          join k r on r.id = c."from"
          left join k t on t.id = c."to"
          where c.repo = ${REPO} and r.status = 'live'
            and (t.id is null or t.status = 'retired' or t.at > r.at)
          order by r.id, c."to" limit 300`),
        db.execute<Home["shared"][number]>(sql`
          select s.id, s.title, s.topic as owner, array_agg(distinct g.topic order by g.topic) as users
          from canon.knowledge_cites c
          join canon.knowledge_records g on g.repo = c.repo and g.id = c."from"
          join canon.knowledge_records s on s.repo = c.repo and s.id = c."to"
          where c.repo = ${REPO} and g.type = 'guide' and g.status = 'live' and g.topic is not null
            and s.type = 'rule' and s.status = 'live' and g.topic is distinct from s.topic
          group by s.id, s.title, s.topic order by s.topic, s.id`),
      ]);
      const folders = new Set<string>();
      for (const f of files) {
        const m = /^topics\/([^/]+)\//.exec(f.path);
        if (m?.[1]) folders.add(m[1]);
      }
      const names = new Set([...folders, ...owned.map((o) => o.topic)]);
      const topics: Topic[] = [...names].sort().map((name) => {
        const guide = owned.find((o) => o.type === "guide" && o.topic === name);
        const sets = owned.filter((o) => o.type === "rule" && o.topic === name);
        return {
          name,
          title: guide?.title ?? name,
          description: str(guide?.data.description),
          guide: guide?.id ?? null,
          sets: sets.length,
          lines: sets.reduce((a, s) => a + lineCount(s.body), 0),
          skill: files.some((f) => f.path === `topics/${name}/SKILL.md`),
          notes: files.some((f) => f.path === `topics/${name}/notes.md`),
          conflicts: conflicts.filter((c) => c.topic === name).length,
        };
      });
      const ref = ({ path, size, text }: FileRef) => ({ path, size, text });
      return {
        indexed: true,
        head: head[0]?.value ?? null,
        topics,
        types,
        direction: files
          .filter((f) => f.path.startsWith("direction/"))
          .map((f) => ({ ...ref(f), title: titleOf(f.path, f.body) }))
          .reverse(),
        other: files.filter((f) => !/^(topics|direction)\//.test(f.path)).map(ref),
        conflicts: conflicts.map((c) => ({
          id: c.id,
          type: "conflict",
          title: c.title,
          status: c.status,
        })),
        shared,
        stale,
      };
    },

    /** One topic whole: guide, its sets and the ones it borrows, skill, notes, files, sources. */
    topic: async (name: string): Promise<TopicWhole> => {
      if (!(await indexed())) throw new PortalRefusal("Canon has no index here yet", 404);
      const [owned, files, conflicts] = await Promise.all([
        db.execute<{ id: string; type: string; title: string; body: string; data: Data }>(
          sql`select id, type, title, body, data from canon.knowledge_records where repo = ${REPO} and status = 'live' and type in ('guide', 'rule') and topic = ${name} order by type, coalesce((data->>'order')::int, 999), id`,
        ),
        fileRows(sql`path like ${`topics/${name.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`}`),
        db.execute<{ id: string; title: string; status: string; body: string; data: Data }>(
          sql`select id, title, status, body, data from canon.knowledge_records where repo = ${REPO} and type = 'conflict' and status = 'live' and data->>'topic' = ${name} and data->>'state' = 'open' order by id`,
        ),
      ]);
      const guideRow = owned.find((o) => o.type === "guide");
      if (!guideRow && !owned.length && !files.length)
        throw new PortalRefusal("no such topic", 404);
      type SetRow = { id: string; title: string; topic: string | null; body: string; data: Data };
      const ownRows: SetRow[] = owned
        .filter((o) => o.type === "rule")
        .map((o) => ({ ...o, topic: name }));
      const own = new Set(ownRows.map((s) => s.id));
      const guideLinks = await links(strs(guideRow?.data.cites));
      const borrowedIds = guideLinks
        .filter((l) => l.type === "rule" && !own.has(l.id))
        .map((l) => l.id);
      const borrowedRows = borrowedIds.length
        ? await db.execute<SetRow>(
            sql`select id, title, topic, body, data from canon.knowledge_records where repo = ${REPO} and id in (${list(borrowedIds)})`,
          )
        : [];
      // guide order
      const lent = borrowedIds.flatMap((id) => borrowedRows.filter((b) => b.id === id));
      const setRows = [...ownRows, ...lent];
      const setIds = setRows.map((s) => s.id);
      const roots = [...setIds, ...(guideRow ? [guideRow.id] : [])];
      const [setLinks, users, under] = await Promise.all([
        Promise.all(setRows.map((s) => links(strs(s.data.cites)))),
        setIds.length
          ? db.execute<{ set: string; topic: string; title: string }>(
              sql`select c."to" as set, g.topic, g.title from canon.knowledge_cites c join canon.knowledge_records g on g.repo = c.repo and g.id = c."from" where c.repo = ${REPO} and g.type = 'guide' and g.status = 'live' and g.topic is not null and c."to" in (${list(setIds)}) order by g.topic`,
            )
          : [],
        // every record under the guide and sets, through findings and patterns
        roots.length
          ? db.execute<SourceRow & { type: string; status: string }>(
              sql`with recursive down(id) as (
                    select unnest(array[${list(roots)}]::text[])
                    union
                    select c."to" from canon.knowledge_cites c join down on c."from" = down.id
                    where c.repo = ${REPO}
                  )
                  select k.id, k.type, k.title, k.status, k.created, k.data from canon.knowledge_records k join down using (id)
                  where k.repo = ${REPO} order by k.id`,
            )
          : [],
      ]);
      const byId = new Map(under.map((u) => [u.id, u.data as unknown as Frontmatter]));
      const backs = new Map<string, string[]>();
      const sets: RuleSet[] = setRows.map((s, i) => {
        const texts = new Map<string, string>();
        for (const l of s.body.split("\n")) {
          const m = RULE_LINE.exec(l);
          if (m) texts.set(`${m[1]}-${m[2]}`, lineText(l));
        }
        const rules = linesOf({ fm: s.data as unknown as Frontmatter, body: s.body }, byId).map(
          (b) => {
            for (const src of b.sources) backs.set(src, [...(backs.get(src) ?? []), b.line]);
            return {
              id: b.line,
              text: texts.get(b.line) ?? "",
              backing: b.backing,
              sources: b.sources,
            };
          },
        );
        return {
          id: s.id,
          title: s.title,
          prefix: str(s.data.prefix),
          topic: s.topic,
          body: s.body,
          cites: setLinks[i] ?? [],
          lines: lineCount(s.body),
          rules,
          usedBy: users
            .filter((u) => u.set === s.id && u.topic !== s.topic && u.topic !== name)
            .map(({ topic, title }) => ({ topic, title })),
        };
      });
      const sources = under.filter((u) => u.type === "source");
      const isRef = (u: SourceRow) => strs(u.data.tags).includes("reference");
      const shaped = await references(sources.filter(isRef));
      const file = (p: string) => files.find((f) => f.path === `topics/${name}/${p}`)?.body ?? null;
      const notes = file("notes.md");
      return {
        name,
        title: guideRow?.title ?? name,
        description: str(guideRow?.data.description),
        guide: guideRow
          ? {
              id: guideRow.id,
              title: guideRow.title,
              body: guideRow.body,
              cites: guideLinks,
            }
          : null,
        sets: sets.filter((x) => own.has(x.id)),
        borrowed: sets.filter((x) => !own.has(x.id)),
        skill: file("SKILL.md"),
        notes: notes == null ? null : withoutFrontmatter(notes),
        files: files
          .filter((f) => !/^topics\/[^/]+\/(SKILL|notes)\.md$/.test(f.path))
          .map(({ path, size, text }) => ({ path, size, text })),
        conflicts: conflicts.map((c) => ({
          id: c.id,
          type: "conflict",
          title: c.title,
          status: c.status,
          body: c.body,
          state: str(c.data.state),
          lines: strs(c.data.lines),
        })),
        references: shaped.map((r) => ({ ...r, backs: backs.get(r.id) ?? [] })),
        evidence: sources
          .filter((u) => !isRef(u))
          .map((u) => ({
            id: u.id,
            type: "source",
            title: u.title,
            status: u.status,
            kind: str(u.data.kind),
            tags: strs(u.data.tags),
            backs: backs.get(u.id) ?? [],
          })),
        github,
      };
    },

    /** A page of records of any type, newest change first, with counts per filter value. */
    records: async (f: RecordFilters): Promise<RecordsPage> => {
      const facets = { type: [], status: [], topic: [] };
      if (!(await indexed()))
        return { indexed: false, total: 0, rows: [], next: null, facets, files: [] };
      type Facet = keyof typeof facets;
      const topicSql = sql`coalesce(r.topic, r.data->>'topic')`;
      const where = (skip?: Facet) => {
        const w: SQL[] = [sql`r.repo = ${REPO}`];
        if (f.type && skip !== "type") w.push(sql`r.type = ${f.type}`);
        if (f.status && skip !== "status") w.push(sql`r.status = ${f.status}`);
        if (f.topic && skip !== "topic") w.push(sql`${topicSql} = ${f.topic}`);
        if (f.tag) w.push(sql`r.data->'tags' ? ${f.tag}`);
        for (const word of (f.q ?? "").split(/\s+/).filter(Boolean)) {
          const like = likeOf(word);
          w.push(sql`(r.title ilike ${like} or r.id ilike ${like} or r.body ilike ${like})`);
        }
        return sql.join(w, sql` and `);
      };
      const facet = (expr: SQL, skip: Facet) =>
        db.execute<Counted>(
          sql`select ${expr} as value, count(*)::int as n from canon.knowledge_records r where ${where(skip)} and ${expr} is not null group by 1 order by n desc, 1 limit 40`,
        );
      const after = f.after ?? 0;
      const q = f.q?.trim();
      const [rows, [count], type, status, topic, files] = await Promise.all([
        db.execute<{
          id: string;
          type: string;
          title: string;
          status: string;
          topic: string | null;
          updated: string;
          body: string;
          description: string | null;
        }>(
          sql`select r.id, r.type, r.title, r.status, ${topicSql} as topic, r.updated, left(r.body, 2000) as body, r.data->>'description' as description from canon.knowledge_records r where ${where()} order by r.updated desc, r.id limit ${PAGE} offset ${after}`,
        ),
        db.execute<{ n: number }>(
          sql`select count(*)::int as n from canon.knowledge_records r where ${where()}`,
        ),
        facet(sql`r.type`, "type"),
        facet(sql`r.status`, "status"),
        facet(topicSql, "topic"),
        q
          ? fileRows(
              sql.join(
                q
                  .split(/\s+/)
                  .map((w) => sql`(path ilike ${likeOf(w)} or body ilike ${likeOf(w)})`),
                sql` and `,
              ),
            )
          : Promise.resolve([]),
      ]);
      const total = count?.n ?? 0;
      return {
        indexed: true,
        total,
        rows: rows.map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          status: r.status,
          topic: r.topic,
          updated: r.updated,
          summary: summaryOf(r.description, r.body),
        })),
        next: after + rows.length < total ? after + rows.length : null,
        facets: { type, status, topic },
        files: files.map(({ path, size, text }) => ({ path, size, text })),
      };
    },

    /** One record whole: frontmatter, body, what it cites (in order) and what cites it. */
    record: async (id: string): Promise<RecordWhole> => {
      if (!(await indexed())) throw new PortalRefusal("Canon has no index here yet", 404);
      const [r] = await db.execute<{
        id: string;
        type: string;
        title: string;
        status: string;
        path: string;
        topic: string | null;
        body: string;
        data: Data;
      }>(
        sql`select id, type, title, status, path, coalesce(topic, data->>'topic') as topic, body, data from canon.knowledge_records where repo = ${REPO} and id = ${id}`,
      );
      if (!r) throw new PortalRefusal("no such record", 404);
      const by = await db.execute<Link>(
        sql`select k.id, k.type, k.title, k.status from canon.knowledge_cites c join canon.knowledge_records k on k.repo = c.repo and k.id = c."from" where c.repo = ${REPO} and c."to" = ${id} order by k.type, k.id`,
      );
      const { id: _i, type: _t, title: _ti, status: _s, topic: _to, ...data } = r.data;
      return {
        id: r.id,
        type: r.type,
        title: r.title,
        status: r.status,
        path: r.path,
        topic: r.topic,
        body: r.body,
        data,
        cites: await links(strs(r.data.cites)),
        citedBy: by,
        github: blob(r.path),
      };
    },

    /** One non-record file: its text, or its size and a GitHub link for a binary. */
    file: async (path: string): Promise<FileWhole> => {
      if (!(await indexed())) throw new PortalRefusal("Canon has no index here yet", 404);
      const [f] = await fileRows(sql`path = ${path}`);
      if (!f) throw new PortalRefusal("no such file", 404);
      return { path: f.path, size: f.size, text: f.text, body: f.body, github: blob(f.path) };
    },
  };
}
