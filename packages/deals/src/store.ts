/**
 * Deals' reads and writes (designs/2026-10-09-opportunities.md). An owner is a client id, or null
 * for Wren. Every stage change goes through `moveDeals`, which keeps the move and says what fired.
 */

import { PortalRefusal } from "@wren/core/refusal";
import { atomic, type Db, type Queryable, serializable } from "@wren/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  DEAL_SOURCES,
  type Deal,
  type DealPipeline,
  type DealSource,
  dealMoves,
  dealPipelines,
  deals,
  type Stage,
  type StageKind,
} from "./schema.js";
import {
  DEFAULT_PIPELINE,
  DEFAULT_STAGES,
  firstStage,
  parseStages,
  StageProblem,
  stageOf,
  stageOfKind,
} from "./stages.js";

/** A refusal the person asking can act on, with its HTTP status. */
export class DealRefusal extends PortalRefusal {}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const ownerIs = (col: typeof deals.client | typeof dealPipelines.client, owner: string | null) =>
  owner === null ? isNull(col) : eq(col, owner);

const stagesOf = (raw: unknown): Stage[] => {
  try {
    return parseStages(raw);
  } catch (err) {
    if (err instanceof StageProblem) throw new DealRefusal(err.message);
    throw err;
  }
};

/** An owner's pipelines, oldest first; the default one made when it has none. */
export async function pipelinesOf(db: Db, owner: string | null, by: string) {
  const have = await db
    .select()
    .from(dealPipelines)
    .where(ownerIs(dealPipelines.client, owner))
    .orderBy(asc(dealPipelines.createdAt));
  if (have.length) return have;
  await db
    .insert(dealPipelines)
    .values({
      client: owner,
      name: DEFAULT_PIPELINE,
      stages: [...DEFAULT_STAGES],
      createdBy: by,
      updatedBy: by,
    })
    .onConflictDoNothing();
  return db
    .select()
    .from(dealPipelines)
    .where(ownerIs(dealPipelines.client, owner))
    .orderBy(asc(dealPipelines.createdAt));
}

export async function pipelineById(db: Queryable, id: string): Promise<DealPipeline | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(dealPipelines).where(eq(dealPipelines.id, id));
  return row ?? null;
}

export async function dealById(db: Queryable, id: string): Promise<Deal | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(deals).where(eq(deals.id, id));
  return row ?? null;
}

export async function dealsById(db: Queryable, ids: readonly string[]): Promise<Deal[]> {
  const ok = ids.filter((id) => UUID.test(id));
  return ok.length ? db.select().from(deals).where(inArray(deals.id, ok)) : [];
}

const nameOf = (raw: unknown, what: string, max: number) => {
  const s = String(raw ?? "").trim();
  if (!s) throw new DealRefusal(`${what} needs a name`);
  if (s.length > max) throw new DealRefusal(`${what}'s name is too long`);
  return s;
};

/** A new pipeline, or one's name and stages saved. A stage with deals in it can't go. */
export async function savePipeline(
  db: Db,
  p: { owner: string | null; id?: string | null; name: unknown; stages: unknown; by: string },
): Promise<DealPipeline> {
  const name = nameOf(p.name, "a pipeline", 80);
  const stages = stagesOf(p.stages);
  return serializable(db, async (tx) => {
    const clash = await tx
      .select({ id: dealPipelines.id })
      .from(dealPipelines)
      .where(and(ownerIs(dealPipelines.client, p.owner), eq(dealPipelines.name, name)));
    if (clash.some((c) => c.id !== p.id))
      throw new DealRefusal(`there's already a pipeline named ${name}`, 409);
    if (!p.id) {
      const [row] = await tx
        .insert(dealPipelines)
        .values({ client: p.owner, name, stages, createdBy: p.by, updatedBy: p.by })
        .returning();
      if (!row) throw new Error("insert returned nothing");
      return row;
    }
    const was = await pipelineById(tx, p.id);
    if (!was || was.client !== p.owner) throw new DealRefusal("no such pipeline", 404);
    const keys = new Set(stages.map((s) => s.key));
    const held = await tx
      .select({ stage: deals.stage, n: sql<number>`count(*)::int` })
      .from(deals)
      .where(eq(deals.pipeline, p.id))
      .groupBy(deals.stage);
    const gone = held.find((h) => !keys.has(h.stage));
    if (gone) {
      const label = stageOf(was.stages, gone.stage)?.label ?? gone.stage;
      throw new DealRefusal(`move the ${gone.n} deal(s) out of ${label} first`, 409);
    }
    const [row] = await tx
      .update(dealPipelines)
      .set({ name, stages, updatedAt: new Date(), updatedBy: p.by })
      .where(eq(dealPipelines.id, p.id))
      .returning();
    if (!row) throw new Error("update returned nothing");
    // A stage whose kind changed takes its deals' status with it.
    for (const s of stages)
      await tx
        .update(deals)
        .set({
          status: s.kind,
          closedAt: s.kind === "open" ? null : sql`coalesce(${deals.closedAt}, now())`,
        })
        .where(
          and(eq(deals.pipeline, p.id), eq(deals.stage, s.key), sql`${deals.status} <> ${s.kind}`),
        );
    return row;
  });
}

/** A pipeline with no deals in it, gone. An owner keeps at least one. */
export async function dropPipeline(db: Db, owner: string | null, id: string): Promise<void> {
  await serializable(db, async (tx) => {
    const p = await pipelineById(tx, id);
    if (!p || p.client !== owner) throw new DealRefusal("no such pipeline", 404);
    const [n] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(deals)
      .where(eq(deals.pipeline, id));
    if (n?.n) throw new DealRefusal("move or delete its deals first", 409);
    const [all] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(dealPipelines)
      .where(ownerIs(dealPipelines.client, owner));
    if ((all?.n ?? 0) <= 1) throw new DealRefusal("keep one pipeline", 409);
    await tx.delete(dealPipelines).where(eq(dealPipelines.id, id));
  });
}

/** "1,200" or "$1,200.50" as cents; empty is no value. */
export function centsOf(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) throw new DealRefusal("type the value in dollars, as 1200");
  const [whole, part = ""] = s.split(".");
  return Number(whole) * 100 + Number(part.padEnd(2, "0"));
}

const optText = (raw: unknown, max: number, what: string): string | null => {
  const s = raw === null || raw === undefined ? "" : String(raw).trim();
  if (s.length > max) throw new DealRefusal(`${what} is too long`);
  return s || null;
};
const optEmail = (raw: unknown, what: string): string | null => {
  const s = optText(raw, 200, what)?.toLowerCase() ?? null;
  if (s && !EMAIL.test(s)) throw new DealRefusal(`${what} isn't an email`);
  return s;
};
const optDay = (raw: unknown): string | null => {
  const s = optText(raw, 10, "the follow-up date");
  if (s && (!DAY.test(s) || Number.isNaN(Date.parse(s))))
    throw new DealRefusal("the follow-up date is a day, as 2026-10-20");
  return s;
};

/** The fields a person types on a deal; each left out stays as it is. */
export interface DealFields {
  name?: unknown;
  value?: unknown;
  contactName?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  owner?: unknown;
  note?: unknown;
  nextOn?: unknown;
}

function fieldsOf(f: DealFields) {
  const has = (k: keyof DealFields) => f[k] !== undefined;
  return {
    ...(has("name") ? { name: nameOf(f.name, "a deal", 200) } : {}),
    ...(has("value") ? { valueCents: centsOf(f.value) } : {}),
    ...(has("contactName") ? { contactName: optText(f.contactName, 200, "the name") } : {}),
    ...(has("contactEmail")
      ? { contactEmail: optEmail(f.contactEmail, "the contact's email") }
      : {}),
    ...(has("contactPhone") ? { contactPhone: optText(f.contactPhone, 20, "the phone") } : {}),
    ...(has("owner") ? { owner: optEmail(f.owner, "who works it") } : {}),
    ...(has("note") ? { note: optText(f.note, 4000, "the note") } : {}),
    ...(has("nextOn") ? { nextOn: optDay(f.nextOn) } : {}),
  };
}

/** A stage change as the spine hears it. */
export interface Moved {
  deal: Deal;
  from: string | null;
  stage: Stage;
}

export interface NewDeal extends DealFields {
  owner_: string | null;
  pipeline?: string | null;
  stage?: string | null;
  source?: unknown;
  sourceRef?: unknown;
  by: string;
}

/** A deal in a pipeline (the owner's first when none is named), in its first open stage. */
export async function createDeal(db: Db, d: NewDeal): Promise<Moved> {
  const source = String(d.source ?? "manual") as DealSource;
  if (!DEAL_SOURCES.includes(source)) throw new DealRefusal("no such source");
  const pipeline = d.pipeline
    ? await pipelineById(db, String(d.pipeline))
    : ((await pipelinesOf(db, d.owner_, d.by))[0] ?? null);
  if (!pipeline || pipeline.client !== d.owner_) throw new DealRefusal("no such pipeline", 404);
  const stage = d.stage ? stageOf(pipeline.stages, String(d.stage)) : firstStage(pipeline.stages);
  if (!stage) throw new DealRefusal("no such stage", 404);
  const fields = fieldsOf(d);
  if (!fields.name) throw new DealRefusal("a deal needs a name");
  return atomic(db, async (tx) => {
    const [row] = await tx
      .insert(deals)
      .values({
        ...fields,
        name: fields.name as string,
        client: d.owner_,
        pipeline: pipeline.id,
        stage: stage.key,
        status: stage.kind,
        closedAt: stage.kind === "open" ? null : new Date(),
        source,
        sourceRef: optText(d.sourceRef, 200, "the source"),
        createdBy: d.by,
        updatedBy: d.by,
      })
      .returning();
    if (!row) throw new Error("insert returned nothing");
    await tx.insert(dealMoves).values({ deal: row.id, from: null, to: stage.key, by: d.by });
    return { deal: row, from: null, stage };
  });
}

/** A deal's typed fields saved; its stage moves only by `moveDeals`. */
export async function saveDeal(db: Db, f: DealFields & { id: string; by: string }): Promise<Deal> {
  const [row] = await db
    .update(deals)
    .set({ ...fieldsOf(f), updatedAt: new Date(), updatedBy: f.by })
    .where(eq(deals.id, f.id))
    .returning();
  if (!row) throw new DealRefusal("no such deal", 404);
  return row;
}

/**
 * Deals moved to a stage by key, or to their pipeline's won or lost stage by kind. A deal already
 * there is left alone and not in the answer.
 */
export async function moveDeals(
  db: Db,
  m: { ids: readonly string[]; to: { stage: string } | { kind: StageKind }; by: string },
): Promise<Moved[]> {
  return serializable(db, async (tx) => {
    const rows = await dealsById(tx, m.ids);
    const pipes = new Map<string, DealPipeline>();
    const moved: Moved[] = [];
    const now = new Date();
    for (const d of rows) {
      const p = pipes.get(d.pipeline) ?? (await pipelineById(tx, d.pipeline));
      if (!p) continue;
      pipes.set(p.id, p);
      const stage =
        "stage" in m.to ? stageOf(p.stages, m.to.stage) : stageOfKind(p.stages, m.to.kind);
      if (!stage) throw new DealRefusal(`${p.name} has no such stage`, 404);
      if (stage.key === d.stage) continue;
      const [row] = await tx
        .update(deals)
        .set({
          stage: stage.key,
          status: stage.kind,
          movedAt: now,
          closedAt: stage.kind === "open" ? null : now,
          updatedAt: now,
          updatedBy: m.by,
        })
        .where(eq(deals.id, d.id))
        .returning();
      if (!row) continue;
      await tx
        .insert(dealMoves)
        .values({ deal: d.id, from: d.stage, to: stage.key, at: now, by: m.by });
      moved.push({ deal: row, from: d.stage, stage });
    }
    return moved;
  });
}

export async function deleteDeals(db: Db, ids: readonly string[]): Promise<number> {
  const ok = ids.filter((id) => UUID.test(id));
  if (!ok.length) return 0;
  const gone = await db.delete(deals).where(inArray(deals.id, ok)).returning({ id: deals.id });
  return gone.length;
}

/** A deal's moves, oldest first. */
export function movesOf(db: Queryable, deal: string) {
  return db
    .select()
    .from(dealMoves)
    .where(eq(dealMoves.deal, deal))
    .orderBy(asc(dealMoves.at), asc(dealMoves.id));
}
