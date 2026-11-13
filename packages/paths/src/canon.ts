/**
 * Canon's tree on a server: `canonTree` (canon-tree.ts) over schema `canon`, read through the
 * library, never the repo. One adapter per request: topics and records load once; edges once per head.
 */

import { PathError } from "@wren/core/paths";
import { PortalRefusal } from "@wren/core/portal";
import type { Db } from "@wren/db";
import {
  canonConsoleApi,
  type Media,
  referenceOf,
  VIDEO_KINDS,
} from "@wren/research/canon-console";
import { canonEdges, canonLibraryApi, type FileRef } from "@wren/research/canon-library";
import { type SQL, sql } from "drizzle-orm";
import { type CanonSource, canonTree, type Placed } from "./canon-tree.js";

const REPO = "canon";
const PLACED = sql`id, type, title, status, coalesce(topic, data->>'topic') as topic, data->>'kind' as kind`;
const VIDEO = sql.join(
  VIDEO_KINDS.map((k) => sql`${k}`),
  sql`, `,
);

// a refusal from the library is a path that isn't there
const missing = (what: string) => (e: unknown) => {
  if (e instanceof PortalRefusal) throw new PathError("unknown-path", `no ${what}`);
  throw e;
};

type Edges = ReturnType<typeof canonEdges>;
/** Edges move only with a sync: one read per database and head, kept across requests (Map folds). */
const EDGES = new WeakMap<Db, { head: string; edges: Edges }>();

/** Canon's index as the tree's source. */
function canonSource(db: Db, remote: string, media: Media | null): CanonSource {
  const library = canonLibraryApi(db, remote, (rows) =>
    Promise.all(rows.map((r) => referenceOf(r, media))),
  );
  const console = canonConsoleApi(db, media);
  const count = async (q: SQL) => (await db.execute<{ n: number }>(q))[0]?.n ?? 0;
  const head = async () => {
    const [h] = await db.execute<{ value: string }>(
      sql`select value from canon.knowledge_meta where repo = ${REPO} and key = 'head'`,
    );
    return h?.value ?? null;
  };
  return {
    videoKinds: VIDEO_KINDS,
    indexed: async () => {
      const [r] = await db.execute<{ t: string | null }>(
        sql`select to_regclass('canon.knowledge_files')::text as t`,
      );
      return !!r?.t;
    },
    home: () => library.home(),
    topic: (name) => library.topic(name).catch(missing(`topic ${name}`)),
    record: (id) => library.record(id).catch(missing(`record ${id}`)),
    reference: (id) => console.reference(id).catch(missing(`reference ${id}`)),
    file: (path) => library.file(path).catch(missing("file")),
    references: (after, limit) => console.references({ after, limit }),
    rootFiles: () =>
      db.execute<FileRef>(
        sql`select path, size, body is not null as text from canon.knowledge_files where repo = ${REPO} and path not like 'topics/%' order by path`,
      ),
    placed: async (ids) =>
      !ids.length
        ? []
        : await db.execute<Placed>(
            sql`select ${PLACED} from canon.knowledge_records where repo = ${REPO} and id in (${sql.join(
              ids.map((i) => sql`${i}`),
              sql`, `,
            )})`,
          ),
    into: async (id) => {
      const [r] = await db.execute<Placed & { into: string | null }>(
        sql`select ${PLACED}, data->>'into' as into from canon.knowledge_records where repo = ${REPO} and id = ${id}`,
      );
      return r ?? null;
    },
    foldedGuide: async (name) => {
      const [g] = await db.execute<{ id: string }>(
        sql`select id from canon.knowledge_records where repo = ${REPO} and type = 'guide' and status = 'retired' and data ? 'into' and (id = ${name} or topic = ${name}) order by (id = ${name}) desc limit 1`,
      );
      return g?.id ?? null;
    },
    counts: async () => {
      const [references, records, topics] = await Promise.all([
        count(
          sql`select count(*)::int as n from canon.knowledge_records where repo = ${REPO} and type = 'source' and status = 'live' and data->>'kind' in (${VIDEO})`,
        ),
        count(sql`select count(*)::int as n from canon.knowledge_records where repo = ${REPO}`),
        count(
          sql`select count(*)::int as n from (
                select topic as t from canon.knowledge_records where repo = ${REPO} and status = 'live' and type in ('guide', 'rule') and topic is not null
                union
                select split_part(path, '/', 2) from canon.knowledge_files where repo = ${REPO} and path like 'topics/%/%'
              ) x`,
        ),
      ]);
      return { topics, references, records };
    },
    types: () =>
      db.execute<{ type: string; n: number }>(
        sql`select type, count(*)::int as n from canon.knowledge_records where repo = ${REPO} group by type order by n desc, type`,
      ),
    ofType: async (type, offset, limit) => {
      const [rows, total] = await Promise.all([
        db.execute<Placed>(
          sql`select ${PLACED} from canon.knowledge_records where repo = ${REPO} and type = ${type} order by updated desc, id limit ${limit} offset ${offset}`,
        ),
        count(
          sql`select count(*)::int as n from canon.knowledge_records where repo = ${REPO} and type = ${type}`,
        ),
      ]);
      return { rows, total };
    },
    findRecords: (words, under, limit) => {
      const like = (w: string) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const w: SQL[] = [sql`repo = ${REPO}`];
      for (const word of words) w.push(sql`(title ilike ${like(word)} or id ilike ${like(word)})`);
      if (under.topic) w.push(sql`coalesce(topic, data->>'topic') = ${under.topic}`);
      if (under.type) w.push(sql`type = ${under.type}`);
      if (under.references) w.push(sql`type = 'source' and data->>'kind' in (${VIDEO})`);
      return db.execute<Placed>(
        sql`select ${PLACED} from canon.knowledge_records where ${sql.join(w, sql` and `)} order by (status = 'live') desc, updated desc, id limit ${limit}`,
      );
    },
    edges: async () => {
      const at = await head();
      const kept = EDGES.get(db);
      if (at && kept?.head === at) return kept.edges;
      const edges = canonEdges(db);
      if (at) EDGES.set(db, { head: at, edges });
      // a failed read is not kept
      edges.catch(() => EDGES.get(db)?.edges === edges && EDGES.delete(db));
      return edges;
    },
    head,
  };
}

export function canonPaths(db: Db, remote: string, media: Media | null) {
  return canonTree(canonSource(db, remote, media));
}
