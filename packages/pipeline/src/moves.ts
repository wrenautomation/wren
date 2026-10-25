/**
 * Manual and agent moves (designs/2026-10-19-business-map.md). Each builds the executor event the
 * `Journeys` service sends at `in.<node>` of a shape workflow: the workflow's own `journey.move`
 * step then writes the row. No second write path. The cause is `manual`; the operator rides in
 * `cause.ref`, because a walk's own `by` is the Restate invocation id.
 *
 * Also here: `assignJourney` (the owner), `rebuildJourney` (the row, from its events) and
 * `signDeal` (terms, once).
 */
import { randomUUID } from "node:crypto";
import { clientMembers, operators } from "@wren/core/clients";
import type { ExecutorEvent } from "@wren/core/executor";
import { UUID } from "@wren/core/ids";
import { events } from "@wren/core/schema";
import { atomic, type Queryable } from "@wren/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { entryNodes, liveSources, sourceEdge } from "./entry.js";
import { ownerOf, personOf, versionOf } from "./journeys.js";
import { type Crossing, flowEdgesFrom, nodeOf, pathOf } from "./model.js";
import { type Journey, journeys, pipelineDeals } from "./schema.js";
import { liveTerms, newestShape, Refused } from "./store.js";
import { runOf } from "./stored.js";
import { parseShapeFlow, shapeFlowId } from "./workflow.js";

/** What `Executor/emit` takes, less the workspace. */
export interface Emit {
  workflow: string;
  from: string;
  events: ExecutorEvent[];
}

const manual = (by: string, now: Date) => ({
  kind: "manual",
  ref: by,
  at: now.toISOString(),
});

/** Can `id` be a row id? Asked before the database is: it would fail the query on a bad one. */
export const isRowId = (id: string): boolean => UUID.test(id);
/** Refuse an id that cannot be one, before the database does: its error would retry forever. */
export function idOf(id: string, what: "journey" | "deal"): string {
  if (!isRowId(id)) throw new Refused([`No ${what} ${id}.`]);
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

/** The open journey a person has, if any. */
async function openOf(db: Queryable, profile: number) {
  const [open] = await db
    .select({ id: journeys.id, node: journeys.node })
    .from(journeys)
    .where(and(eq(journeys.profileId, profile), eq(journeys.status, "open")))
    .limit(1);
  return open;
}

/**
 * Open a person's journey at a node of the newest shape. `at` defaults to the first node a live
 * source feeds; `entry` names the source (it needs a flow edge to `at`). Refused: no shape, a node
 * no live source feeds, a source with no edge there, no such person, or a journey already open.
 */
export async function openEmit(
  db: Queryable,
  p: { person: string; at?: string; entry?: string; by: string; now?: Date },
): Promise<Emit> {
  const now = p.now ?? new Date();
  const newest = await newestShape(db);
  if (!newest) throw new Refused(["No shape yet."]);
  const body = runOf(newest.body);
  const nodes = entryNodes(body);
  const at = p.at ?? nodes[0];
  if (!at || !nodes.includes(at))
    throw new Refused([
      `${p.at ?? "That node"} is no opening node. Opening nodes: ${nodes.join(", ")}.`,
    ]);
  if (p.entry) {
    const live = liveSources(body).some((s) => s.id === p.entry);
    if (!live || !sourceEdge(body, p.entry, at))
      throw new Refused([`No live source ${p.entry} feeds ${at}.`]);
  }
  const profile = await personByKey(db, p.person);
  if (profile === null) throw new Refused([`No person ${p.person}.`]);
  const open = await openOf(db, profile);
  if (open) throw new Refused([`Already open at ${open.node}: ${open.id}.`]);
  return {
    workflow: shapeFlowId(newest.number),
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
 * Move a journey to a node, along its own version's edges. The shortest flow path crosses its
 * edges (nodes passed through are skipped). No path is refused, unless `reason` says why: then
 * the move is `forced` and crosses no edge. Always refused: a node already on the trail (a
 * journey never visits one twice: drop it and open a new one), a journey that is not open.
 * A loop edge from the journey's node closes it (dropped, reason `loop <edge>`) and opens a new
 * journey at `to`, with the old entry, on the newest version.
 */
export async function moveEmit(
  db: Queryable,
  p: { journey: string; to: string; by: string; reason?: string; now?: Date },
): Promise<Emit & { journey: Journey }> {
  const [j] = await db
    .select()
    .from(journeys)
    .where(eq(journeys.id, idOf(p.journey, "journey")))
    .limit(1);
  if (!j) throw new Refused([`No journey ${p.journey}.`]);
  const v = await versionOf(db, j.version);
  if (!v) throw new Refused([`Shape v${j.version} is gone.`]);
  const to = nodeOf(v.body, p.to);
  if (!to || to.kind === "source")
    throw new Refused([
      `No node ${p.to}. Nodes: ${v.body.nodes
        .filter((n) => n.kind !== "source")
        .map((n) => n.id)
        .join(", ")}.`,
    ]);
  if (j.node === p.to) throw new Refused([`It is already at ${to.name}.`]);
  const path = pathOf(v.body, j.node, p.to);
  const loop =
    path?.length === 1
      ? v.body.edges.find((e) => e.id === path[0] && e.kind === "loop")
      : undefined;
  // A loop opens a new journey, so the old trail does not matter to it.
  if (!loop && j.trail.some((c) => c.to === p.to))
    throw new Refused([
      `${to.name} is already on this journey's trail. A journey never visits a node twice: drop it and open a new one.`,
    ]);
  const reason = p.reason?.trim();
  const at = p.now ?? new Date();
  if (loop) {
    if (j.status === "done") throw new Refused(["Journey is done."]);
    if (v.newest !== j.version)
      throw new Refused([
        `Journey is on shape v${j.version}; the newest is v${v.newest}. A loop crosses on the newest.`,
      ]);
    const other = await openOf(db, j.profileId);
    if (other && other.id !== j.id)
      throw new Refused([`Already open at ${other.node}: ${other.id}.`]);
    return {
      journey: j,
      workflow: shapeFlowId(j.version),
      from: `in.${p.to}`,
      events: [
        {
          subject: `manual:${randomUUID()}`,
          kind: "journey",
          data: {
            profile: j.profileId,
            entry: j.entry,
            loop: { journey: j.id, edge: loop.id },
            cause: manual(p.by, at),
          },
        },
      ],
    };
  }
  if (j.status !== "open") throw new Refused([`Journey is ${j.status}.`]);
  if (!path && !reason)
    throw new Refused([`No path from ${j.node} to ${p.to}. Give a reason to force the move.`]);
  return {
    journey: j,
    workflow: shapeFlowId(j.version),
    from: `in.${p.to}`,
    events: [
      {
        subject: subjectOf(j.id),
        kind: "journey",
        data: {
          journey: j.id,
          profile: j.profileId,
          ...(!path && reason ? { forced: { reason } } : {}),
          cause: manual(p.by, at),
        },
      },
    ],
  };
}

/**
 * Give a journey to a team member, or to nobody (`to` null). The owner is not part of the executor:
 * a plain update of the column, never a move. `main` holds the team: Wren's operators, and for a
 * client's workspace its members too. A closed journey takes an owner as well (the record keeps
 * who worked it). Refused: no such journey, or an address that is nobody on the team here.
 */
export async function assignJourney(
  db: Queryable,
  main: Queryable,
  p: { client?: string | null; journey: string; to: string | null },
): Promise<{ journey: string; owner: string | null }> {
  const id = idOf(p.journey, "journey");
  let owner: string | null = null;
  if (p.to !== null) {
    owner = ownerOf(p.to);
    if (!owner) throw new Refused([`"${p.to}" is not an email address.`]);
    const [op] = await main
      .select({ email: operators.email })
      .from(operators)
      .where(eq(operators.email, owner))
      .limit(1);
    const [member] =
      op || !p.client
        ? []
        : await main
            .select({ email: clientMembers.email })
            .from(clientMembers)
            .where(and(eq(clientMembers.clientId, p.client), eq(clientMembers.email, owner)))
            .limit(1);
    if (!op && !member) throw new Refused([`${owner} is not on the team here.`]);
  }
  const done = await db
    .update(journeys)
    .set({ owner })
    .where(eq(journeys.id, id))
    .returning({ id: journeys.id });
  if (!done.length) throw new Refused([`No journey ${id}.`]);
  return { journey: id, owner };
}

type RebuiltFields = Pick<Journey, "version" | "node" | "status" | "dropReason" | "trail">;
export interface Rebuilt {
  before: RebuiltFields;
  after: RebuiltFields;
  changed: boolean;
}

/**
 * Recompute a journey row from its executor events (subject `journey:<id>`): its version, node and
 * trail from the arrivals (a version carry counts, and its trail seeds), dropped from a drop or a
 * loop out, done from a node with no way on. What events cannot tell (person, entry, opened time, owner)
 * stays. Refused with no events.
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
      .where(and(eq(events.subject, subjectOf(id)), sql`${events.workflow} like 'shape.%'`))
      .orderBy(asc(events.at), asc(events.id));
    let version = j.version;
    let node: string | null = null;
    let trail: Crossing[] = [];
    let status: Journey["status"] = "open";
    let reason: string | null = null;
    let movedAt: Date | null = null;
    let closedAt: Date | null = null;
    const bodies = new Map<number, Awaited<ReturnType<typeof versionOf>>>();
    for (const r of rows) {
      const flow = parseShapeFlow(r.workflow);
      if (!flow) continue;
      if (r.node === "dropped") {
        status = "dropped";
        const why = (r.data as { reason?: unknown } | null)?.reason;
        reason = typeof why === "string" ? why : null;
        closedAt = r.at;
        continue;
      }
      if (!r.node.startsWith("s_")) continue;
      if (!bodies.has(flow.version)) bodies.set(flow.version, await versionOf(tx, flow.version));
      const body = bodies.get(flow.version)?.body;
      const data = (r.data ?? {}) as Record<string, unknown>;
      const cause = (data.cause ?? {}) as { kind?: unknown };
      version = flow.version;
      node = r.node.slice(2);
      movedAt = r.at;
      status = "open";
      reason = null;
      closedAt = null;
      if (cause.kind === "version") {
        // A carry holds the trail so far; one without it leaves the trail as it was.
        if (Array.isArray(data.trail)) trail = data.trail as Crossing[];
        continue;
      }
      const edges = Array.isArray(data.edges) ? data.edges.map(String) : [];
      const crossed = edges.flatMap((e) => body?.edges.find((x) => x.id === e) ?? []);
      if (crossed.length > 0) {
        trail.push(
          ...crossed.map((e) => ({ edge: e.id, from: e.from, to: e.to, at: r.at.toISOString() })),
        );
      } else {
        const from = typeof data.from === "string" ? data.from : null;
        trail.push({ edge: null, from, to: node, at: r.at.toISOString() });
      }
    }
    if (node === null) throw new Refused([`No arrivals for journey ${id}.`]);
    // A journey that left through a loop edge was dropped by it: its successor says so. One a drop
    // event closed first keeps that reason.
    const [next] = await tx
      .select({ trail: journeys.trail })
      .from(journeys)
      .where(sql`${journeys.entryRef}->>'loop' = ${id}`)
      .limit(1);
    if (next && status !== "dropped") {
      status = "dropped";
      reason = `loop ${next.trail[0]?.edge ?? ""}`.trim();
      closedAt = next.trail[0] ? new Date(next.trail[0].at) : movedAt;
    }
    if (status === "open") {
      const body = (await versionOf(tx, version ?? 0))?.body;
      if (body && flowEdgesFrom(body, node).length === 0) {
        status = "done";
        closedAt = movedAt;
      }
    }
    const before = pick(j);
    const after = { version, node, status, dropReason: reason, trail };
    // Times differ by the milliseconds between a step and its event: compare the path only.
    const path = (x: RebuiltFields) => ({
      ...x,
      trail: x.trail.map((c) => [c.edge, c.from, c.to]),
    });
    const changed = JSON.stringify(path(before)) !== JSON.stringify(path(after));
    if (changed)
      await tx
        .update(journeys)
        .set({ ...after, movedAt: movedAt ?? j.movedAt, closedAt })
        .where(eq(journeys.id, id));
    return { before, after, changed };
  });
}

const pick = (j: Journey): RebuiltFields => ({
  version: j.version,
  node: j.node,
  status: j.status,
  dropReason: j.dropReason,
  trail: j.trail,
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
