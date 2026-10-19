/**
 * Manual and agent moves (designs/2026-10-18-journeys.md, "Manual and agent moves"). Each builds
 * the spine event the `Journeys` service sends at `in.<stage>` of a funnel workflow: the funnel's
 * own `journey.move` step then writes the row. No second write path. The cause is `manual`; the
 * operator rides in `cause.ref`, because a walk's own `by` is the Restate invocation id.
 *
 * Also here: `rebuildJourney` (the row, from its events) and `signDeal` (terms, once).
 */
import { randomUUID } from "node:crypto";
import { events } from "@wren/core/schema";
import type { SpineEvent } from "@wren/core/spine";
import { atomic, type Queryable } from "@wren/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { entryStages } from "./entry.js";
import { personOf, versionOf } from "./journeys.js";
import { funnelVersions, type Journey, journeys, pipelineDeals } from "./schema.js";
import { nextStage } from "./stages.js";
import { liveTerms, Refused } from "./store.js";
import { funnelFlowId, parseFunnelFlow } from "./workflow.js";

/** What `Spine/emit` takes, less the workspace. */
export interface Emit {
  workflow: string;
  from: string;
  events: SpineEvent[];
}

const manual = (by: string, now: Date) => ({
  kind: "manual",
  ref: by,
  at: now.toISOString(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Refuse an id that cannot be one, before the database does: its error would retry forever. */
export function idOf(id: string, what: "journey" | "deal"): string {
  if (!UUID.test(id)) throw new Refused([`No ${what} ${id}.`]);
  return id;
}

/** A journey id as it is in the events' subject. */
export const subjectOf = (journey: string) => `journey:${journey}`;

/**
 * A person as a caller names them: a profile id, an email, a phone (`+...`), or `<kind>:<value>`
 * (`handle:x:name`, `visitor:abc`). Null when it names no one.
 */
export async function personByKey(db: Queryable, key: string): Promise<number | null> {
  const k = key.trim();
  if (!k) return null;
  if (/^[0-9]+$/.test(k)) return personOf(db, { profile: Number(k) });
  if (k.includes("@") && !k.startsWith("handle:")) return personOf(db, { email: k });
  if (k.startsWith("+")) return personOf(db, { phone: k });
  const cut = k.startsWith("handle:") ? k.indexOf(":", 7) : k.indexOf(":");
  if (cut > 0) return personOf(db, { [k.slice(0, cut)]: k.slice(cut + 1) });
  return null;
}

/**
 * Open a person's journey in a funnel at an entry stage of its newest version. `at` defaults to
 * the first entry stage. Refused: funnel off or unknown, no such person, a stage that is no entry,
 * or a journey already open.
 */
export async function openEmit(
  db: Queryable,
  p: { funnel: string; person: string; at?: string; entry?: string; by: string; now?: Date },
): Promise<Emit> {
  const now = p.now ?? new Date();
  const [top] = await db
    .select({ number: funnelVersions.number })
    .from(funnelVersions)
    .where(eq(funnelVersions.funnel, p.funnel))
    .orderBy(desc(funnelVersions.number))
    .limit(1);
  if (!top) throw new Refused([`No funnel ${p.funnel}.`]);
  const loaded = await versionOf(db, p.funnel, top.number);
  if (!loaded) throw new Refused([`No funnel ${p.funnel}.`]);
  if (loaded.status !== "live") throw new Refused([`Funnel ${p.funnel} is off.`]);
  const stages = entryStages(loaded.body);
  const at = p.at ?? stages[0];
  if (!at || !stages.includes(at))
    throw new Refused([
      `${p.at ?? "That stage"} is no entry stage. Entry stages: ${stages.join(", ")}.`,
    ]);
  if (p.entry && !loaded.body.entries.some((e) => e.id === p.entry))
    throw new Refused([`Funnel ${p.funnel} has no entry ${p.entry}.`]);
  const profile = await personByKey(db, p.person);
  if (profile === null) throw new Refused([`No person ${p.person}.`]);
  const [open] = await db
    .select({ id: journeys.id, stage: journeys.stage })
    .from(journeys)
    .where(
      and(
        eq(journeys.profileId, profile),
        eq(journeys.funnel, p.funnel),
        eq(journeys.status, "open"),
      ),
    )
    .limit(1);
  if (open) throw new Refused([`Already open at ${open.stage}: ${open.id}.`]);
  return {
    workflow: funnelFlowId(p.funnel, top.number),
    from: `in.${at}`,
    events: [
      {
        // One subject per open: a repeat after a drop is a new arrival, not a copy of the old one.
        subject: `manual:${randomUUID()}`,
        kind: "journey",
        data: { profile, ...(p.entry ? { entry: p.entry } : {}), cause: manual(p.by, now) },
      },
    ],
  };
}

/**
 * Move an open journey forward to a later stage. It leaves from the journey's own version, so the
 * version's move step owns it. Refused: not open, no such stage, or a stage that is not later.
 */
export async function moveEmit(
  db: Queryable,
  p: { journey: string; to: string; by: string; now?: Date },
): Promise<Emit & { journey: Journey }> {
  const [j] = await db
    .select()
    .from(journeys)
    .where(eq(journeys.id, idOf(p.journey, "journey")))
    .limit(1);
  if (!j) throw new Refused([`No journey ${p.journey}.`]);
  if (j.status !== "open") throw new Refused([`Journey is ${j.status}.`]);
  const v = await versionOf(db, j.funnel, j.version);
  if (!v) throw new Refused([`Funnel ${j.funnel} v${j.version} is gone.`]);
  const keys = v.body.stages.map((s) => s.key);
  if (!keys.includes(p.to)) throw new Refused([`No stage ${p.to}. Stages: ${keys.join(", ")}.`]);
  if (!nextStage(v.body.stages, j.stage, p.to, j.status))
    throw new Refused([`A journey only moves forward. It is at ${j.stage}.`]);
  return {
    journey: j,
    workflow: funnelFlowId(j.funnel, j.version),
    from: `in.${p.to}`,
    events: [
      {
        subject: subjectOf(j.id),
        kind: "journey",
        data: { journey: j.id, profile: j.profileId, cause: manual(p.by, p.now ?? new Date()) },
      },
    ],
  };
}

export interface Rebuilt {
  before: Pick<Journey, "version" | "stage" | "status" | "dropReason">;
  after: Pick<Journey, "version" | "stage" | "status" | "dropReason">;
  changed: boolean;
}

/**
 * Recompute a journey row from its spine events (subject `journey:<id>`): its version and stage
 * from the newest arrival (a version carry counts), dropped from a drop, done from the last
 * stage. What events cannot tell (person, funnel, entry, opened time) stays. Refused with no events.
 */
export async function rebuildJourney(db: Queryable, id: string): Promise<Rebuilt> {
  return atomic(db, async (tx) => {
    const [j] = await tx
      .select()
      .from(journeys)
      .where(eq(journeys.id, idOf(id, "journey")))
      .for("update");
    if (!j) throw new Refused([`No journey ${id}.`]);
    const rows = await tx
      .select({ workflow: events.workflow, node: events.node, data: events.data, at: events.at })
      .from(events)
      .where(and(eq(events.subject, subjectOf(id)), sql`${events.workflow} like 'funnel.%'`))
      .orderBy(asc(events.at), asc(events.id));
    let version = j.version;
    let stage: string | null = null;
    let status: Journey["status"] = "open";
    let reason: string | null = null;
    let movedAt: Date | null = null;
    let closedAt: Date | null = null;
    for (const r of rows) {
      const flow = parseFunnelFlow(r.workflow);
      if (!flow || flow.funnel !== j.funnel) continue;
      if (r.node === "dropped") {
        status = "dropped";
        const why = (r.data as { reason?: unknown } | null)?.reason;
        reason = typeof why === "string" ? why : null;
        closedAt = r.at;
        continue;
      }
      if (!r.node.startsWith("s_")) continue;
      version = flow.version;
      stage = r.node.slice(2);
      movedAt = r.at;
      status = "open";
      reason = null;
      closedAt = null;
    }
    if (stage === null) throw new Refused([`No arrivals for journey ${id}.`]);
    if (status === "open") {
      const v = await versionOf(tx, j.funnel, version);
      if (v && v.body.stages.at(-1)?.key === stage) {
        status = "done";
        closedAt = movedAt;
      }
    }
    const before = pick(j);
    const after = { version, stage, status, dropReason: reason };
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    if (changed)
      await tx
        .update(journeys)
        .set({ ...after, movedAt: movedAt ?? j.movedAt, closedAt })
        .where(eq(journeys.id, id));
    return { before, after, changed };
  });
}

const pick = (j: Journey): Rebuilt["before"] => ({
  version: j.version,
  stage: j.stage,
  status: j.status,
  dropReason: j.dropReason,
});

/**
 * Set a deal's terms: the plan's live terms version today. Terms are set once. A change is
 * refused unless `force`; the audit trigger on `pipeline.deals` records a forced one.
 */
export async function signDeal(
  db: Queryable,
  p: { deal: string; plan: string; force?: boolean; now?: Date },
): Promise<{ deal: string; termsVersion: number; changed: boolean }> {
  return atomic(db, async (tx) => {
    const [d] = await tx
      .select()
      .from(pipelineDeals)
      .where(eq(pipelineDeals.id, idOf(p.deal, "deal")))
      .for("update");
    if (!d) throw new Refused([`No deal ${p.deal}.`]);
    const terms = await liveTerms(tx, d.offer, p.plan, p.now ?? new Date());
    if (!terms) throw new Refused([`No live ${p.plan} terms for ${d.offer}.`]);
    if (d.termsVersion === terms.id) return { deal: d.id, termsVersion: terms.id, changed: false };
    if (d.termsVersion !== null && !p.force)
      throw new Refused(["Terms are set once. Pass force to change them. The change is audited."]);
    await tx
      .update(pipelineDeals)
      .set({ termsVersion: terms.id })
      .where(eq(pipelineDeals.id, d.id));
    return { deal: d.id, termsVersion: terms.id, changed: true };
  });
}
