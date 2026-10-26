/**
 * The content lines' feed (designs/2026-10-25-ingestion-engine.md). What a line finds and what
 * its stations' jobs end comes in outside Restate: the hunt and his saves tag Learn items, and the
 * readers, the breakdowns and his calls write their own rows. A pass reads those rows and tells
 * the executor: `trigger.found` for a document new to a line, `trigger.station` for one whose job
 * ended at the station it is at. A document at a line's last station closes there when that job
 * ends: nothing moves, so no event says it.
 *
 * A line is an SOP's (its find takes Learn items tagged with it or asked into it) or a study's (its
 * find takes the pages the study read). A job ends when its row is there:
 *   read     SOP: a Wren item on the document is read (`read_at`). Study: the study read it, so
 *            its pages arrive with read ended.
 *   extract  SOP: the document has a breakdown's fact finding. Study: the study's claims step on
 *            the page is final (no claims is an answer).
 *   call     his console or CLI call on the whole document (`doc:<id>`): a mark (star, save, SOP
 *            add) is no call, and a fact call tunes the standard only. Study: also when every
 *            claim of the study on the page has his call; a page with no claims has nothing to
 *            call and ends at once.
 *   measure  never yet
 *
 * Wren's workspace only: Learn items, studies, their documents and his calls are Wren's for now.
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

/** What a line is: an SOP's or a study's. The instance keeps it in `entry_ref`. */
type Line = { sop: string } | { study: string };

const lineOf = (ref: Record<string, unknown> | null): Line | null => {
  if (typeof ref?.study === "string") return { study: ref.study };
  if (typeof ref?.sop === "string") return { sop: ref.sop };
  return null;
};
const lineKey = (l: Line) => ("study" in l ? `study:${l.study}` : `sop:${l.sop}`);

/**
 * The documents a find takes that its line has not had: Wren items tagged with the SOP or asked
 * into it, or the pages the study read. Neither an instance for this line (any status: a line
 * takes a document once) nor an arrival at the find's targets in this version, so a refused move
 * is not told again.
 */
async function newDocuments(
  db: Db,
  p: { line: Line; workflow: string; moveNodes: string[]; limit: number },
): Promise<number[]> {
  const nodes = sql.join(
    p.moveNodes.map((n) => sql`${n}`),
    sql`, `,
  );
  const { line } = p;
  const found =
    "study" in line
      ? sql`select distinct s.document_id as document from study_steps s
          join studies y on y.id = s.study_id
          where y.slug = ${line.study} and s.step = 'read' and s.outcome = 'ok'
            and s.document_id is not null`
      : sql`select distinct i.document_id as document from learn.items i
          where i.client = ${WREN}
            and (exists (select 1 from learn.item_tags t where t.item_id = i.id and t.tag = ${line.sop})
              or exists (select 1 from learn.sop_sources x where x.item_id = i.id
                and x.sop = ${line.sop}))`;
  const [field, name] = "study" in line ? ["study", line.study] : ["sop", line.sop];
  const rows = (await db.execute(sql`
    select f.document from (${found}) f
    where not exists (select 1 from pipeline.instances j where j.subject_kind = 'document'
        and j.document_id = f.document and j.entry_ref->>${field} = ${name})
      and not exists (select 1 from events e where e.subject = 'doc:' || f.document
        and e.workflow = ${p.workflow} and e.node in (${nodes}))
    order by 1
    limit ${p.limit}`)) as unknown as { document: number }[];
  return rows.map((r) => Number(r.document));
}

/** Of `docs` on `line`, the ones whose job has ended. */
async function ended(db: Db, line: Line, job: string, docs: number[]): Promise<Set<number>> {
  if (docs.length === 0) return new Set();
  const ids = sql`array[${sql.join(
    docs.map((d) => sql`${d}`),
    sql`, `,
  )}]::int[]`;
  const study = "study" in line ? line.study : null;
  // His call on the whole document ends the call on either kind of line.
  const docCall = sql`select substr(c.subject, 5)::int as document from decision_calls c
    where c.kind = 'document' and c.source in ('console', 'cli') and c.subject = any(
      select 'doc:' || d from unnest(${ids}) d)`;
  let q: ReturnType<typeof sql> | null = null;
  if (job === "read")
    q = study
      ? sql`select unnest(${ids}) as document`
      : sql`select distinct i.document_id as document from learn.items i
          where i.client = ${WREN} and i.read_at is not null and i.document_id = any(${ids})`;
  else if (job === "extract")
    q = study
      ? sql`select distinct s.document_id as document from study_steps s
          join studies y on y.id = s.study_id
          where y.slug = ${study} and s.step = 'claims' and s.outcome <> 'failed'
            and s.document_id = any(${ids})`
      : sql`select distinct f.document_id as document from findings f
          where f.kind = 'fact' and f.fact_key not like 'doc:%/study:%'
            and f.document_id = any(${ids})`;
  else if (job === "call")
    q = study
      ? sql`${docCall} union
          select s.document_id from study_steps s join studies y on y.id = s.study_id
          where y.slug = ${study} and s.step = 'claims' and s.outcome <> 'failed'
            and s.document_id = any(${ids})
            and not exists (select 1 from findings f where f.kind = 'fact'
              and f.document_id = s.document_id
              and f.fact_key like 'doc:' || s.document_id || '/study:' || ${study} || '/%'
              and not exists (select 1 from decision_calls c
                where c.kind = 'finding' and c.subject = f.fact_key))`
      : docCall;
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
      const line: Line | null =
        s.via !== "found" ? null : s.study ? { study: s.study } : s.sop ? { sop: s.sop } : null;
      if (!line) continue;
      const moveNodes = body.edges
        .filter((e) => e.kind === "flow" && e.from === s.id)
        .map((e) => `m_${e.to}`);
      if (moveNodes.length === 0) continue;
      const docs = await newDocuments(db, { line, workflow, moveNodes, limit });
      if (docs.length === limit) more = true;
      const ref = "study" in line ? line.study : line.sop;
      for (const document of docs) {
        found++;
        fires.push({
          client: null,
          facts: { trigger: "trigger.found", ...line },
          event: {
            subject: docSubject(document),
            kind: "doc",
            data: { document, ...line, cause: { kind: "found", ref, at } },
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
      ref: instances.entryRef,
    })
    .from(instances)
    .where(and(eq(instances.subjectKind, "document"), eq(instances.status, "open")));
  const bodies = new Map<number, ShapeBody | null>();
  // One read per line and job: a job ends by the line's own rows.
  const byJob = new Map<string, { line: Line; job: string; js: typeof open }>();
  for (const j of open) {
    const line = lineOf(j.ref);
    if (j.node === null || j.document === null || !line) continue;
    if (!bodies.has(j.version))
      bodies.set(j.version, (await versionOf(db, j.version))?.body ?? null);
    const body = bodies.get(j.version);
    const n = body ? nodeOf(body, j.node) : undefined;
    if (n?.kind !== "job") continue;
    const key = `${lineKey(line)} ${n.job}`;
    const group = byJob.get(key) ?? { line, job: n.job, js: [] };
    group.js.push(j);
    byJob.set(key, group);
  }
  let done = 0;
  let closed = 0;
  for (const { line, job, js } of byJob.values()) {
    const over = await ended(
      db,
      line,
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
