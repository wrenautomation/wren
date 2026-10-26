/**
 * The content lines' feed (designs/2026-10-25-ingestion-engine.md). What a line finds and what
 * its stations' jobs end comes in outside Restate: the hunt and his saves tag Learn items, and the
 * readers, the breakdowns and his calls write their own rows. A pass reads those rows and tells
 * the executor: `trigger.found` for a document new to a line, `trigger.station` for one whose job
 * ended at the station it is at. A document at a line's last station closes there when that job
 * ends: nothing moves, so no event says it.
 *
 * A job ends when its row is there:
 *   read     a Wren item on the document is read (`read_at`)
 *   extract  the document has a fact finding
 *   call     his console or CLI call on the whole document (`doc:<id>`): a mark (star, save, SOP
 *            add) is no call, and a fact call tunes the standard only
 *   measure  never yet
 *
 * Wren's workspace only: Learn items, their documents and his calls are Wren's for now.
 * Pure of Restate: the worker's `LineFeed` loop sends the fires.
 */

import { WREN } from "@wren/core/access";
import type { Fired } from "@wren/core/executor";
import type { Db } from "@wren/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { liveSources } from "./entry.js";
import { versionOf } from "./journeys.js";
import { isEnd, nodeOf, type ShapeBody } from "./model.js";
import { instances, shapeVersions } from "./schema.js";
import { runOf } from "./stored.js";
import { shapeFlowId } from "./workflow.js";

interface LinePass {
  fires: Fired[];
  /** Documents new to a line. */
  found: number;
  /** Documents whose job ended where they are. */
  done: number;
  /** Instances closed at their line's last station. */
  closed: number;
  /** A find had `limit` documents to tell: more may follow. */
  more: boolean;
}

const docSubject = (document: number) => `doc:${document}`;

/**
 * The documents a find takes that its line has not had: Wren items tagged with the SOP or asked
 * into it. Neither an instance for this SOP (any status: a line takes a document once) nor an
 * arrival at the find's targets in this version, so a refused move is not told again.
 */
async function newDocuments(
  db: Db,
  p: { sop: string; workflow: string; moveNodes: string[]; limit: number },
): Promise<number[]> {
  const nodes = sql.join(
    p.moveNodes.map((n) => sql`${n}`),
    sql`, `,
  );
  const rows = (await db.execute(sql`
    select distinct i.document_id as document
    from learn.items i
    where i.client = ${WREN}
      and (exists (select 1 from learn.item_tags t where t.item_id = i.id and t.tag = ${p.sop})
        or exists (select 1 from learn.sop_sources x where x.item_id = i.id and x.sop = ${p.sop}))
      and not exists (select 1 from pipeline.instances j where j.subject_kind = 'document'
        and j.document_id = i.document_id and j.entry_ref->>'sop' = ${p.sop})
      and not exists (select 1 from events e where e.subject = 'doc:' || i.document_id
        and e.workflow = ${p.workflow} and e.node in (${nodes}))
    order by 1
    limit ${p.limit}`)) as unknown as { document: number }[];
  return rows.map((r) => Number(r.document));
}

/** Of `docs`, the ones whose job has ended. */
async function ended(db: Db, job: string, docs: number[]): Promise<Set<number>> {
  if (docs.length === 0) return new Set();
  const ids = sql`array[${sql.join(
    docs.map((d) => sql`${d}`),
    sql`, `,
  )}]::int[]`;
  let q: ReturnType<typeof sql> | null = null;
  if (job === "read")
    q = sql`select distinct i.document_id as document from learn.items i
      where i.client = ${WREN} and i.read_at is not null and i.document_id = any(${ids})`;
  else if (job === "extract")
    q = sql`select distinct f.document_id as document from findings f
      where f.kind = 'fact' and f.document_id = any(${ids})`;
  else if (job === "call")
    q = sql`select distinct substr(c.subject, 5)::int as document from decision_calls c
      where c.kind = 'document' and c.source in ('console', 'cli') and c.subject = any(
        select 'doc:' || d from unnest(${ids}) d)`;
  if (!q) return new Set();
  const rows = (await db.execute(q)) as unknown as { document: number }[];
  return new Set(rows.map((r) => Number(r.document)));
}

/** One pass over Wren's content lines: the fires to send, and the instances it closed. */
export async function linePass(db: Db, now: Date, limit = 200): Promise<LinePass> {
  const fires: Fired[] = [];
  const at = now.toISOString();
  let found = 0;
  let more = false;

  const [newest] = await db
    .select({ number: shapeVersions.number, body: shapeVersions.body })
    .from(shapeVersions)
    .orderBy(desc(shapeVersions.number))
    .limit(1);
  if (newest) {
    const body = runOf(newest.body);
    const workflow = shapeFlowId(newest.number);
    for (const s of liveSources(body)) {
      if (s.via !== "found" || !s.sop) continue;
      const moveNodes = body.edges
        .filter((e) => e.kind === "flow" && e.from === s.id)
        .map((e) => `m_${e.to}`);
      if (moveNodes.length === 0) continue;
      const docs = await newDocuments(db, { sop: s.sop, workflow, moveNodes, limit });
      if (docs.length === limit) more = true;
      for (const document of docs) {
        found++;
        fires.push({
          client: null,
          facts: { trigger: "trigger.found", sop: s.sop },
          event: {
            subject: docSubject(document),
            kind: "doc",
            data: { document, sop: s.sop, cause: { kind: "found", ref: s.sop, at } },
          },
        });
      }
    }
  }

  const open = await db
    .select({
      id: instances.id,
      version: instances.version,
      node: instances.node,
      document: instances.documentId,
    })
    .from(instances)
    .where(and(eq(instances.subjectKind, "document"), eq(instances.status, "open")));
  const bodies = new Map<number, ShapeBody | null>();
  const byJob = new Map<string, typeof open>();
  for (const j of open) {
    if (j.node === null || j.document === null) continue;
    if (!bodies.has(j.version))
      bodies.set(j.version, (await versionOf(db, j.version))?.body ?? null);
    const body = bodies.get(j.version);
    const n = body ? nodeOf(body, j.node) : undefined;
    if (n?.kind !== "job") continue;
    byJob.set(n.job, [...(byJob.get(n.job) ?? []), j]);
  }
  let done = 0;
  let closed = 0;
  for (const [job, js] of byJob) {
    const over = await ended(
      db,
      job,
      js.map((j) => j.document ?? 0),
    );
    for (const j of js) {
      if (j.document === null || j.node === null || !over.has(j.document)) continue;
      const body = bodies.get(j.version);
      if (body && isEnd(body, j.node)) {
        const shut = await db
          .update(instances)
          .set({ status: "done", closedAt: now })
          .where(and(eq(instances.id, j.id), eq(instances.status, "open")))
          .returning({ id: instances.id });
        closed += shut.length;
        continue;
      }
      done++;
      fires.push({
        client: null,
        facts: { trigger: "trigger.station", station: j.node },
        event: {
          subject: docSubject(j.document),
          kind: "doc",
          data: {
            document: j.document,
            journey: j.id,
            station: j.node,
            cause: { kind: "station", ref: j.node, at },
          },
        },
      });
    }
  }
  return { fires, found, done, closed, more };
}
