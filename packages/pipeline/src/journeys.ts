/**
 * The journey rows the executor steps and the Journeys service share (designs/2026-10-19-business-map.md):
 * who a cause is about, the shape workflows a workspace lists, and a drop. All DB reads and
 * writes here; the pure rules are in `entry.ts`, `model.ts` and `workflow.ts`.
 */

import type { Component } from "@wren/core/components";
import type { ExecutorEvent } from "@wren/core/executor";
import { profileOf } from "@wren/core/profiles";
import { profiles } from "@wren/core/profiles-schema";
import { checkWorkflows, type Workflow } from "@wren/core/workflows";
import { atomic, type Queryable } from "@wren/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { DROPPED, type ShapeBody } from "./model.js";
import { type Instance, instances, shapeVersions } from "./schema.js";
import { runOf } from "./stored.js";
import { type Scope, shapeFlowId, shapeWorkflow } from "./workflow.js";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** What an instance is about: a person (a journey) or a document on a content line. */
export type Subject = { kind: "person"; profile: number } | { kind: "document"; document: number };

/** The instance's subject. `ck_instances_subject` holds the id that matches its kind. */
export function instanceSubject(
  j: Pick<Instance, "id" | "subjectKind" | "profileId" | "documentId">,
): Subject {
  if (j.subjectKind === "person" && j.profileId !== null)
    return { kind: "person", profile: j.profileId };
  if (j.subjectKind === "document" && j.documentId !== null)
    return { kind: "document", document: j.documentId };
  throw new Error(`Instance ${j.id} has no ${j.subjectKind}.`);
}

/** A string or number as text; anything else is nothing. */
export const textOf = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined;

/**
 * A person on the team as a journey stores them: their address, lowercased, the form the `mine`
 * view compares with the signed-in person. Null for anything that is not an address (an agent's
 * name, a shell user): such a hand open has no owner.
 */
export const ownerOf = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
};

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

/**
 * One shape version as the runtime runs it, and the newest number; null when there is no such
 * version. The body is a graph (`runOf`: a metro body is lowered). The depths are graph depths
 * (the `depths` column holds them for both models).
 */
export async function versionOf(db: Queryable, version: number) {
  const [row] = await db
    .select({ body: shapeVersions.body, depths: shapeVersions.depths })
    .from(shapeVersions)
    .where(eq(shapeVersions.number, version))
    .limit(1);
  if (!row) return null;
  const [top] = await db
    .select({ number: shapeVersions.number })
    .from(shapeVersions)
    .orderBy(desc(shapeVersions.number))
    .limit(1);
  return {
    body: runOf(row.body),
    depths: row.depths,
    newest: top?.number ?? version,
  };
}

/**
 * The shape workflows of one workspace: the newest version, and any older one that still holds
 * an open journey. A version that will not generate is left out and logged, so one bad body
 * cannot stop the rest. `scope` is `client` in a client's database, else `wren`.
 */
export async function shapeWorkflowsOf(
  db: Queryable,
  scope: Scope,
  log: (msg: string) => void = console.warn,
): Promise<Workflow[]> {
  const v = shapeVersions;
  const rows = await db
    .select({ number: v.number, body: v.body })
    .from(v)
    .where(
      sql`${v.number} = (select max(m.number) from pipeline.shape_versions m)
        or exists (select 1 from pipeline.instances j
          where j.version = ${v.number} and j.status = 'open')`,
    )
    .orderBy(v.number);
  const out: Workflow[] = [];
  for (const r of rows) {
    try {
      out.push(shapeWorkflow(r.number, runOf(r.body), scope));
    } catch (err) {
      log(`shape v${r.number}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

/**
 * The shape workflows that pass the same check every workflow passes, against the code's own.
 * One that fails is left out and logged: `flowsWith` checks every base workflow whenever a
 * client has a saved edit, so one bad version would stop that client's workflows.
 */
export function soundShapes(
  shapes: readonly Workflow[],
  base: readonly Workflow[],
  components: readonly Component[],
  log: (msg: string) => void = console.warn,
): Workflow[] {
  const problems = checkWorkflows([...base, ...shapes], components);
  return shapes.filter((f) => {
    const mine = problems.filter((p) => p.startsWith(`${f.id}.`) || p.startsWith(`${f.id}:`));
    if (mine.length) log(`${f.id} left out: ${mine.join("; ")}`);
    return mine.length === 0;
  });
}

/** Where a drop leaves, for `Executor/emit`: the newest version's workflow, whatever the journey's version. */
interface DropEmit {
  workflow: string;
  from: string;
  events: ExecutorEvent[];
}

/**
 * One writer at a time per person, until the transaction ends. Every path that opens a journey
 * takes it first: one open journey per person is held in code until M3 adds the index.
 */
const lockPerson = (tx: Queryable, profile: number) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`journey:${profile}`}))`);

/**
 * Close an open journey as dropped and give back the event that tells the executor
 * (`Journeys/drop` sends it at `in.dropped`). Null when it is not open. The event leaves from the
 * newest version's workflow: the journey's own may have left the list.
 */
export async function dropJourney(
  db: Queryable,
  p: { journey: string; reason: string; by?: string },
): Promise<DropEmit | null> {
  return atomic(db, async (tx) => {
    const [j] = await tx
      .select()
      .from(instances)
      .where(and(eq(instances.id, p.journey), eq(instances.status, "open")))
      .for("update");
    if (!j) return null;
    await tx
      .update(instances)
      .set({ status: "dropped", dropReason: p.reason, closedAt: new Date() })
      .where(eq(instances.id, j.id));
    const [top] = await tx
      .select({ number: shapeVersions.number })
      .from(shapeVersions)
      .orderBy(desc(shapeVersions.number))
      .limit(1);
    return {
      workflow: shapeFlowId(top?.number ?? j.version ?? 1),
      from: `in.${DROPPED}`,
      events: [
        {
          subject: `journey:${j.id}`,
          kind: "journey",
          data: {
            journey: j.id,
            profile: j.profileId,
            node: j.node,
            version: j.version,
            reason: p.reason,
            cause: { kind: "manual", ref: p.by ?? "operator", at: new Date().toISOString() },
          },
        },
      ],
    };
  });
}

/** A person's open journey, locked for the caller's transaction. One per person. */
export async function openJourney(tx: Queryable, profile: number): Promise<Instance | null> {
  await lockPerson(tx, profile);
  const [j] = await tx
    .select()
    .from(instances)
    .where(and(eq(instances.profileId, profile), eq(instances.status, "open")))
    .orderBy(desc(instances.openedAt))
    .limit(1)
    .for("update");
  return j ?? null;
}

/** The body of a version, when only the body is wanted. */
export async function bodyOf(db: Queryable, version: number): Promise<ShapeBody | null> {
  return (await versionOf(db, version))?.body ?? null;
}
