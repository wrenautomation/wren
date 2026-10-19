/**
 * The journey rows the spine steps and the Journeys service share (designs/2026-10-18-journeys.md):
 * who a cause is about, the funnel workflows a workspace lists, and a drop. All DB reads and
 * writes here; the pure rules are in `entry.ts`, `stages.ts` and `workflow.ts`.
 */

import type { Component } from "@wren/core/components";
import { profileOf } from "@wren/core/profiles";
import { profiles } from "@wren/core/profiles-schema";
import type { SpineEvent } from "@wren/core/spine";
import { checkWorkflows, type Workflow } from "@wren/core/workflows";
import { atomic, type Queryable } from "@wren/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { DROPPED, type FunnelBody } from "./model.js";
import { funnels, funnelVersions, type Journey, journeys } from "./schema.js";
import { funnelFlowId, funnelWorkflow, type Scope } from "./workflow.js";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A string or number as text; anything else is nothing. */
export const textOf = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined;

/** A profile id to its live profile: a merged one points at what it became. */
async function liveProfile(db: Queryable, id: number): Promise<number | null> {
  let at = id;
  for (let hops = 0; hops < 8; hops++) {
    const [row] = await db
      .select({ id: profiles.id, mergedInto: profiles.mergedInto })
      .from(profiles)
      .where(eq(profiles.id, at))
      .limit(1);
    if (!row) return null;
    if (row.mergedInto === null) return row.id;
    at = row.mergedInto;
  }
  return null;
}

/**
 * The person a cause is about: `profile`, then email, phone, visitor and `handle:<platform>`
 * keys on the event data, then the same on `data.lead` (a hook's lead). Null when it names no one.
 */
export async function personOf(
  db: Queryable,
  data: Record<string, unknown>,
): Promise<number | null> {
  const pools = [data, ...(isRecord(data.lead) ? [data.lead] : [])];
  for (const p of pools) {
    const id = Number(p.profile);
    if (Number.isInteger(id) && id > 0) {
      const live = await liveProfile(db, id);
      if (live) return live;
    }
    const keys = [
      ...["email", "phone", "visitor"].map((kind) => ({ kind, value: textOf(p[kind]) })),
      ...Object.keys(p)
        .filter((k) => k.startsWith("handle:"))
        .map((kind) => ({ kind, value: textOf(p[kind]) })),
    ];
    for (const k of keys) {
      const found = await profileOf(db, k);
      if (found) return found;
    }
  }
  return null;
}

/** One funnel version's body, the funnel's newest number and its status; null when it has none. */
export async function versionOf(db: Queryable, funnel: string, version: number) {
  const [row] = await db
    .select({ body: funnelVersions.body })
    .from(funnelVersions)
    .where(and(eq(funnelVersions.funnel, funnel), eq(funnelVersions.number, version)))
    .limit(1);
  if (!row) return null;
  const [top] = await db
    .select({ number: funnelVersions.number })
    .from(funnelVersions)
    .where(eq(funnelVersions.funnel, funnel))
    .orderBy(desc(funnelVersions.number))
    .limit(1);
  const [head] = await db
    .select({ status: funnels.status })
    .from(funnels)
    .where(eq(funnels.id, funnel))
    .limit(1);
  return { body: row.body, newest: top?.number ?? version, status: head?.status ?? "live" };
}

/** The stage that makes the deal. */
export const saleStageOf = (body: FunnelBody) => body.stages.find((s) => s.sale)?.key;

/**
 * The funnel workflows of one workspace: per funnel the newest version, and any older one that
 * still holds an open journey. A version that will not generate is left out and logged, so one
 * bad body cannot stop the rest. `scope` is `client` in a client's database, else `wren`.
 */
export async function funnelWorkflowsOf(
  db: Queryable,
  scope: Scope,
  log: (msg: string) => void = console.warn,
): Promise<Workflow[]> {
  const v = funnelVersions;
  const rows = await db
    .select({ funnel: v.funnel, number: v.number, body: v.body })
    .from(v)
    .where(
      sql`${v.number} = (select max(m.number) from pipeline.funnel_versions m where m.funnel = ${v.funnel})
        or exists (select 1 from pipeline.journeys j where j.funnel = ${v.funnel}
          and j.version = ${v.number} and j.status = 'open')`,
    )
    .orderBy(v.funnel, v.number);
  const sales = new Map<string, string | undefined>();
  const top = new Map<string, number>();
  for (const r of rows) {
    if (r.number >= (top.get(r.funnel) ?? 0)) {
      top.set(r.funnel, r.number);
      sales.set(r.funnel, saleStageOf(r.body));
    }
  }
  const out: Workflow[] = [];
  for (const r of rows) {
    try {
      out.push(funnelWorkflow(r.funnel, r.number, r.body, scope, (id) => sales.get(id)));
    } catch (err) {
      log(`funnel ${r.funnel} v${r.number}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

/**
 * The funnel workflows that pass the same check every workflow passes, against the code's own.
 * One that fails is left out and logged: `flowsWith` checks every base workflow whenever a
 * client has a saved edit, so one bad funnel would stop that client's workflows.
 */
export function soundFunnels(
  funnels: readonly Workflow[],
  base: readonly Workflow[],
  components: readonly Component[],
  log: (msg: string) => void = console.warn,
): Workflow[] {
  const problems = checkWorkflows([...base, ...funnels], components);
  return funnels.filter((f) => {
    const mine = problems.filter((p) => p.startsWith(`${f.id}.`) || p.startsWith(`${f.id}:`));
    if (mine.length) log(`${f.id} left out: ${mine.join("; ")}`);
    return mine.length === 0;
  });
}

/** Where a drop leaves, for `Spine/emit`: the funnel's newest workflow, whatever the journey's version. */
export interface DropEmit {
  workflow: string;
  from: string;
  events: SpineEvent[];
}

/**
 * Close an open journey as dropped and give back the event that tells the spine
 * (`Journeys/drop` sends it at the funnel's `in.dropped`). Null when it is not open. The event
 * leaves from the newest version's workflow: the journey's own may have left the list.
 */
export async function dropJourney(
  db: Queryable,
  p: { journey: string; reason: string; by?: string },
): Promise<DropEmit | null> {
  return atomic(db, async (tx) => {
    const [j] = await tx
      .select()
      .from(journeys)
      .where(and(eq(journeys.id, p.journey), eq(journeys.status, "open")))
      .for("update");
    if (!j) return null;
    await tx
      .update(journeys)
      .set({ status: "dropped", dropReason: p.reason, closedAt: new Date() })
      .where(eq(journeys.id, j.id));
    const [top] = await tx
      .select({ number: funnelVersions.number })
      .from(funnelVersions)
      .where(eq(funnelVersions.funnel, j.funnel))
      .orderBy(desc(funnelVersions.number))
      .limit(1);
    return {
      workflow: funnelFlowId(j.funnel, top?.number ?? j.version),
      from: `in.${DROPPED}`,
      events: [
        {
          subject: `journey:${j.id}`,
          kind: "journey",
          data: {
            journey: j.id,
            profile: j.profileId,
            funnel: j.funnel,
            version: j.version,
            stage: j.stage,
            reason: p.reason,
            cause: { kind: "manual", ref: p.by ?? "operator", at: new Date().toISOString() },
          },
        },
      ],
    };
  });
}

/** A person's open journey in a funnel, locked for the caller's transaction. */
export async function openJourney(
  tx: Queryable,
  profile: number,
  funnel: string,
): Promise<Journey | null> {
  const [j] = await tx
    .select()
    .from(journeys)
    .where(
      and(
        eq(journeys.profileId, profile),
        eq(journeys.funnel, funnel),
        eq(journeys.status, "open"),
      ),
    )
    .for("update");
  return j ?? null;
}
