/**
 * Funnels to the shape (designs/2026-10-19-business-map.md, "Decisions (planner)"). The one file
 * that still reads old funnel bodies, so it owns private copies of their types.
 *
 * `shapeFromFunnels` is pure: the newest body of each funnel in, one shape out, with the maps that
 * place old stages and entries on it. `migrateShape` writes it: v1 when no shape exists, then every
 * journey that has no node yet. Safe to repeat. `dry` writes nothing and works on a database
 * without migration 0306.
 */
import { events } from "@wren/core/schema";
import { atomic, type Queryable } from "@wren/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { carryJourneys } from "./carry.js";
import { lockPerson, versionOf } from "./journeys.js";
import {
  ACTIONS,
  type Action,
  type Advance,
  type Crossing,
  edgeIdOf,
  type HoldNode,
  NODE_ID_MAX,
  type ShapeBody,
  type ShapeEdge,
  type SourceNode,
  VIAS,
  type Via,
} from "./model.js";
import { funnels, funnelVersions, type Journey, journeys, pipelineDeals } from "./schema.js";
import { canonicalJson, newestShape, saveShape } from "./store.js";
import { shapeFlowId } from "./workflow.js";

// --- the old funnel body (private copy) -----------------------------------------------------

interface OldStage {
  key: string;
  label: string;
  sale?: true;
  on: Advance[];
  research?: "none" | "light" | "full";
  idleDays?: number;
}

interface OldEntry {
  id: string;
  kind: Via | "funnel";
  channel?: string;
  campaign?: string;
  funnel?: { id: string; at?: string };
  source?: string;
  group?: string;
  to?: string;
}

export interface FunnelBody {
  name: string;
  offer: string;
  stages: OldStage[];
  entries: OldEntry[];
}

/** One funnel as `shapeFromFunnels` reads it: its newest body and whether it is live. */
export interface FunnelInput {
  id: string;
  status: "live" | "off";
  body: FunnelBody;
}

/** The `by` of the rows migrate writes. */
export const MIGRATE_BY = "migrate";
/** Why a person's second open journey closes. */
export const ONE_PER_PERSON = "one journey per person";

// --- the pure part --------------------------------------------------------------------------

/** What `shapeFromFunnels` gives back. */
export interface Plan {
  body: ShapeBody;
  /** funnel id, then stage key, to node id. */
  nodes: Record<string, Record<string, string>>;
  /** funnel id, then entry id, to source node id. */
  sources: Record<string, Record<string, string>>;
  /** funnel id to its offer node id. */
  offers: Record<string, string>;
  /** Things left out or changed, in plain English. */
  notes: string[];
}

const slug = (s: string) => {
  const t = s.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return /^[a-z]/.test(t) ? t : `n${t}`;
};

const titleOf = (id: string) => {
  const t = id.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

const LEVEL = { none: 0, light: 1, full: 2 } as const;

/** Is there a flow path `from` to `to`? Also true when they are the same node. */
function reaches(edges: readonly ShapeEdge[], from: string, to: string): boolean {
  const seen = new Set<string>();
  const walk = (id: string): boolean => {
    if (id === to) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return edges.some((e) => e.kind === "flow" && e.from === id && walk(e.to));
  };
  return walk(from);
}

/**
 * One shape from the newest body of every funnel, or null when there are none. One node per stage
 * key; the same key in two funnels is one node when label and kind (and offer) agree, else
 * `<key>_<funnel>`. A merge that would close a loop of flow edges is not made. A feed edge that
 * would close one becomes a loop edge.
 */
export function shapeFromFunnels(inputs: readonly FunnelInput[]): Plan | null {
  if (inputs.length === 0) return null;
  const notes: string[] = [];
  const sources: SourceNode[] = [];
  const holds: HoldNode[] = [];
  const edges: ShapeEdge[] = [];
  const nodes: Plan["nodes"] = {};
  const entryIds: Plan["sources"] = {};
  const offers: Plan["offers"] = {};

  const taken = () => new Set([...sources, ...holds].map((n) => n.id));
  const free = (base: string): string => {
    const ids = taken();
    let id = slug(base).slice(0, NODE_ID_MAX);
    for (let n = 2; ids.has(id); n++) {
      const tail = `_${n}`;
      id = `${slug(base).slice(0, NODE_ID_MAX - tail.length)}${tail}`;
    }
    return id;
  };
  const link = (from: string, to: string, kind: ShapeEdge["kind"]) => {
    if (edges.some((e) => e.from === from && e.to === to && e.kind === kind)) return;
    edges.push({ id: edgeIdOf(from, to), from, to, kind });
  };

  // Stages, one funnel at a time.
  for (const f of inputs) {
    const place = (merge: boolean) => {
      const draft = { holds: holds.map((h) => structuredClone(h)), edges: [...edges] };
      const ids: Record<string, string> = {};
      const prior = new Map(draft.holds.map((h) => [h.id, h]));
      for (const s of f.body.stages) {
        const kind = s.sale ? "offer" : "step";
        const have = prior.get(s.key);
        const agrees =
          have !== undefined &&
          have.name === s.label &&
          have.kind === kind &&
          (have.kind !== "offer" || have.offer === f.body.offer);
        if (merge && agrees && have) {
          have.advance = [
            ...have.advance,
            ...s.on.filter((a) => !have.advance.some((b) => same(a, b))),
          ];
          const level = s.research;
          if (level && LEVEL[level] > LEVEL[have.research ?? "none"]) have.research = level;
          if (have.idleDays === undefined && s.idleDays !== undefined) have.idleDays = s.idleDays;
          ids[s.key] = have.id;
          continue;
        }
        const taken = new Set([...draft.holds.map((h) => h.id), ...sources.map((x) => x.id)]);
        let id = s.key;
        if (taken.has(id)) id = `${slug(s.key)}_${slug(f.id)}`.slice(0, NODE_ID_MAX);
        for (let n = 2; taken.has(id); n++) id = `${id.slice(0, NODE_ID_MAX - 2)}_${n}`;
        const base = {
          id,
          name: s.label,
          advance: s.on.map((a) => structuredClone(a)),
          ...(s.research ? { research: s.research } : {}),
          ...(s.idleDays !== undefined ? { idleDays: s.idleDays } : {}),
        };
        const node: HoldNode = s.sale
          ? { ...base, kind: "offer", offer: f.body.offer }
          : {
              ...base,
              kind: "step",
              action: (ACTIONS as readonly string[]).includes(s.key) ? (s.key as Action) : "other",
            };
        draft.holds.push(node);
        prior.set(id, node);
        ids[s.key] = id;
      }
      const chain: ShapeEdge[] = [];
      let closes = false;
      const keys = f.body.stages.map((s) => s.key);
      for (const [i, key] of keys.entries()) {
        const next = keys[i + 1];
        if (next === undefined) continue;
        const from = ids[key] as string;
        const to = ids[next] as string;
        if (reaches([...draft.edges, ...chain], to, from)) closes = true;
        chain.push({ id: edgeIdOf(from, to), from, to, kind: "flow" });
      }
      return { ids, chain, holds: draft.holds, closes };
    };
    let placed = place(true);
    if (placed.closes) {
      notes.push(`Funnel ${f.id}: shared stage keys would close a loop, so its stages stay apart.`);
      placed = place(false);
    }
    holds.splice(0, holds.length, ...placed.holds);
    for (const e of placed.chain) link(e.from, e.to, "flow");
    nodes[f.id] = placed.ids;
    const sale = f.body.stages.find((s) => s.sale);
    const saleNode = sale ? placed.ids[sale.key] : undefined;
    if (saleNode) offers[f.id] = saleNode;
  }

  // Entries, once every funnel has its nodes.
  const byId = new Map(inputs.map((f) => [f.id, f] as const));
  const twins = new Map<string, SourceNode>();
  for (const f of inputs) {
    const mine: Record<string, string> = {};
    entryIds[f.id] = mine;
    const first = f.body.stages[0]?.key;
    for (const e of f.body.entries) {
      const toKey = e.to ?? first;
      const to = toKey === undefined ? undefined : nodes[f.id]?.[toKey];
      if (!to) {
        notes.push(`Funnel ${f.id}: entry ${e.id} opens at ${toKey ?? "nothing"}, left out.`);
        continue;
      }
      if (e.kind === "funnel") {
        const feeder = e.funnel ? byId.get(e.funnel.id) : undefined;
        const at = e.funnel?.at ?? feeder?.body.stages.find((s) => s.sale)?.key;
        const from = feeder && at ? nodes[feeder.id]?.[at] : undefined;
        if (!from || from === to) {
          notes.push(`Funnel ${f.id}: entry ${e.id} follows ${e.funnel?.id ?? "?"}, left out.`);
          continue;
        }
        link(from, to, reaches(edges, to, from) ? "loop" : "flow");
        continue;
      }
      if (!(VIAS as readonly string[]).includes(e.kind)) {
        notes.push(`Funnel ${f.id}: entry ${e.id} has kind ${e.kind}, left out.`);
        continue;
      }
      const parked = f.status === "off";
      const sig = {
        via: e.kind as Via,
        ...(e.channel !== undefined ? { channel: e.channel } : {}),
        ...(e.campaign !== undefined ? { campaign: e.campaign } : {}),
        ...(e.source !== undefined ? { source: e.source } : {}),
        ...(e.group !== undefined ? { group: e.group } : {}),
        ...(parked ? { parked: true as const } : {}),
      };
      // Identical entries (same id, same settings) are one source.
      const key = canonicalJson({ id: e.id, ...sig });
      let node = twins.get(key);
      if (!node) {
        const id = free(taken().has(slug(e.id)) ? `${e.id}_${f.id}` : e.id);
        node = { id, kind: "source", name: titleOf(e.id), ...sig };
        sources.push(node);
        twins.set(key, node);
      }
      mine[e.id] = node.id;
      link(node.id, to, "flow");
    }
  }

  // A node nothing flows into opens by hand.
  const fed = new Set(edges.filter((e) => e.kind === "flow").map((e) => e.to));
  const orphans = holds.filter((h) => !fed.has(h.id));
  if (orphans.length > 0) {
    const id = free("manual");
    sources.push({ id, kind: "source", name: "Manual", via: "manual" });
    for (const h of orphans) link(id, h.id, "flow");
  }

  return {
    body: {
      name: inputs.length === 1 ? (inputs[0]?.body.name ?? "Business") : "Business",
      nodes: [...sources, ...holds],
      edges,
    },
    nodes,
    sources: entryIds,
    offers,
    notes,
  };
}

// --- the writer -----------------------------------------------------------------------------

export interface MigrateReport {
  funnels: string[];
  /** `none`: no funnels. `exists`: a shape was there. `planned`: dry run. `written`: v1 saved. */
  shape: "none" | "exists" | "planned" | "written";
  /** v1 as planned, or the newest shape when one exists. Null when there are no funnels. */
  body: ShapeBody | null;
  journeys: {
    /** Placed on the shape this run. */
    moved: number;
    open: number;
    done: number;
    dropped: number;
    /** Second open journeys of a person, dropped. */
    duplicates: number;
    /** On a stage the funnel no longer has: left as they were. */
    unplaced: number;
  };
  /** Deals set on an offer node. */
  deals: number;
  notes: string[];
}

const empty = (): MigrateReport["journeys"] => ({
  moved: 0,
  open: 0,
  done: 0,
  dropped: 0,
  duplicates: 0,
  unplaced: 0,
});

/** The newest body of each funnel, oldest funnel first. */
async function funnelsOf(db: Queryable): Promise<FunnelInput[]> {
  const rows = await db.select().from(funnels).orderBy(asc(funnels.createdAt), asc(funnels.id));
  const newest = await db
    .selectDistinctOn([funnelVersions.funnel], {
      funnel: funnelVersions.funnel,
      body: funnelVersions.body,
    })
    .from(funnelVersions)
    .orderBy(funnelVersions.funnel, desc(funnelVersions.number));
  const bodies = new Map(newest.map((r) => [r.funnel, r.body as unknown as FunnelBody] as const));
  return rows.flatMap((f) => {
    const body = bodies.get(f.id);
    return body ? [{ id: f.id, status: f.status, body }] : [];
  });
}

const exists = async (db: Queryable, rel: string) =>
  ((await db.execute(sql`select to_regclass(${rel}) as r`)) as unknown as { r: string | null }[])[0]
    ?.r != null;

const hasNode = async (db: Queryable) =>
  (
    (await db.execute(
      sql`select 1 as x from information_schema.columns
      where table_schema = 'pipeline' and table_name = 'journeys' and column_name = 'node'`,
    )) as unknown as unknown[]
  ).length > 0;

/**
 * Build shape v1 from the funnels (when no shape exists) and place every journey with no node on
 * it. `dry` reads only: no shape table, no new column. Safe to repeat.
 */
export async function migrateShape(
  db: Queryable,
  opts: { triggers: ReadonlySet<string>; dry?: boolean; now?: Date },
): Promise<MigrateReport> {
  const now = opts.now ?? new Date();
  const inputs = await funnelsOf(db);
  const plan = shapeFromFunnels(inputs);
  const report: MigrateReport = {
    funnels: inputs.map((f) => f.id),
    shape: "none",
    body: plan?.body ?? null,
    journeys: empty(),
    deals: 0,
    notes: plan?.notes ?? [],
  };
  if (!plan) return report;

  if (opts.dry) {
    const has = await exists(db, "pipeline.shape_versions");
    const newest = has ? await newestShape(db) : null;
    report.shape = newest ? "exists" : "planned";
    if (newest) report.body = newest.body;
    const moved = (await hasNode(db)) ? sql`where node is null` : sql``;
    const rows = (await db.execute(
      sql`select funnel, stage, status from pipeline.journeys ${moved}`,
    )) as unknown as { funnel: string | null; stage: string | null; status: Journey["status"] }[];
    for (const r of rows) {
      if (!plan.nodes[r.funnel ?? ""]?.[r.stage ?? ""]) report.journeys.unplaced++;
      else {
        report.journeys.moved++;
        report.journeys[r.status]++;
      }
    }
    const dup = (await db.execute(
      sql`select count(*)::int as n from (select profile_id from pipeline.journeys
        where status = 'open' group by profile_id having count(*) > 1) t`,
    )) as unknown as { n: number }[];
    report.journeys.duplicates = dup[0]?.n ?? 0;
    report.journeys.open -= report.journeys.duplicates;
    report.journeys.dropped += report.journeys.duplicates;
    const deals = (await db.execute(
      sql`select count(*)::int as n from pipeline.deals ${moved}`,
    )) as unknown as { n: number }[];
    report.deals = deals[0]?.n ?? 0;
    return report;
  }

  let newest = await newestShape(db);
  if (newest) {
    report.shape = "exists";
    report.body = newest.body;
  } else {
    newest = await saveShape(db, {
      body: plan.body,
      note: `From funnels: ${report.funnels.join(", ")}`,
      by: MIGRATE_BY,
      triggers: opts.triggers,
    });
    report.shape = "written";
  }

  const v1 = await versionOf(db, 1);
  if (!v1) return report;
  const placed = await place(db, plan, v1.body, v1.depths, now, report);
  // Later versions exist: the placed journeys follow to the newest.
  if (placed > 0 && newest.number > 1) await carryJourneys(db, newest.number);
  return report;
}

/** Place the journeys with no node on v1. Gives back how many it placed. */
async function place(
  db: Queryable,
  plan: Plan,
  body: ShapeBody,
  depths: Record<string, number>,
  now: Date,
  report: MigrateReport,
): Promise<number> {
  const inBody = new Set(body.nodes.map((n) => n.id));
  return atomic(db, async (tx) => {
    const todo = await tx
      .select()
      .from(journeys)
      .where(isNull(journeys.node))
      .orderBy(asc(journeys.openedAt), asc(journeys.id))
      .for("update");
    if (todo.length === 0) return 0;
    const people = [...new Set(todo.map((j) => j.profileId))].sort((a, b) => a - b);
    for (const p of people) await lockPerson(tx, p);

    // Each journey's node, or null when its stage is gone.
    const nodeOf = (j: Journey) => {
      const n = plan.nodes[j.funnel ?? ""]?.[j.stage ?? ""];
      return n && inBody.has(n) ? n : null;
    };

    // One open journey per person: the deepest stays, then the newest.
    const open = await tx
      .select()
      .from(journeys)
      .where(and(eq(journeys.status, "open"), inArray(journeys.profileId, people)))
      .for("update");
    const versionDepths = new Map<number, Record<string, number>>([[1, depths]]);
    const depthOf = async (j: Journey): Promise<number> => {
      if (j.node === null) {
        const n = nodeOf(j);
        return n === null ? -1 : (depths[n] ?? 0);
      }
      const v = j.version ?? 1;
      if (!versionDepths.has(v)) versionDepths.set(v, (await versionOf(tx, v))?.depths ?? {});
      return versionDepths.get(v)?.[j.node] ?? 0;
    };
    const losers = new Set<string>();
    for (const p of people) {
      const mine = open.filter((j) => j.profileId === p);
      if (mine.length < 2) continue;
      const ranked = await Promise.all(mine.map(async (j) => ({ j, d: await depthOf(j) })));
      ranked.sort((a, b) => b.d - a.d || b.j.openedAt.getTime() - a.j.openedAt.getTime());
      for (const r of ranked.slice(1)) losers.add(r.j.id);
    }

    // The old arrivals, in order, for the journeys that move.
    const arrivals = new Map<string, { stage: string; at: Date }[]>();
    const subjects = todo.map((j) => `journey:${j.id}`);
    for (let i = 0; i < subjects.length; i += 500) {
      const rows = await tx
        .select({
          subject: events.subject,
          workflow: events.workflow,
          node: events.node,
          at: events.at,
        })
        .from(events)
        .where(
          and(
            inArray(events.subject, subjects.slice(i, i + 500)),
            sql`${events.workflow} like 'funnel.%' and ${events.node} like 's\\_%'`,
          ),
        )
        .orderBy(asc(events.at), asc(events.id));
      for (const r of rows) {
        const funnel = /^funnel\.(.+)\.v\d+$/.exec(r.workflow)?.[1];
        const list = arrivals.get(r.subject) ?? [];
        list.push({ stage: `${funnel}|${r.node.slice(2)}`, at: r.at });
        arrivals.set(r.subject, list);
      }
    }

    let placed = 0;
    const touched = new Set<string>();
    for (const j of todo) {
      const node = nodeOf(j);
      if (node === null) {
        report.journeys.unplaced++;
        report.notes.push(`Journey ${j.id} sits on ${j.funnel}/${j.stage}, which the shape lacks.`);
        continue;
      }
      const entry = plan.sources[j.funnel ?? ""]?.[j.entry] ?? j.entry;
      const trail = trailOf(
        body,
        entry,
        node,
        j,
        (arrivals.get(`journey:${j.id}`) ?? [])
          .filter((a) => a.stage.startsWith(`${j.funnel}|`))
          .map((a) => ({
            node: plan.nodes[j.funnel ?? ""]?.[a.stage.slice((j.funnel ?? "").length + 1)],
            at: a.at,
          })),
      );
      const loser = losers.has(j.id);
      await tx
        .update(journeys)
        .set({
          node,
          version: 1,
          entry,
          trail,
          ...(loser
            ? { status: "dropped" as const, dropReason: ONE_PER_PERSON, closedAt: now }
            : {}),
        })
        .where(eq(journeys.id, j.id));
      const status = loser ? "dropped" : j.status;
      if (status === "open" || loser) {
        await arrive(tx, j, node, trail, j.movedAt);
        if (loser) await dropped(tx, j, node, now);
      }
      if (loser) report.journeys.duplicates++;
      report.journeys[status]++;
      report.journeys.moved++;
      placed++;
      touched.add(j.id);
      const offer = plan.offers[j.funnel ?? ""];
      if (offer) {
        const set = await tx
          .update(pipelineDeals)
          .set({ node: offer })
          .where(and(eq(pipelineDeals.journey, j.id), isNull(pipelineDeals.node)))
          .returning({ id: pipelineDeals.id });
        report.deals += set.length;
      }
    }

    // A second open journey that is already on the shape (opened by new code during a deploy).
    for (const j of open) {
      if (!losers.has(j.id) || touched.has(j.id) || j.node === null) continue;
      await tx
        .update(journeys)
        .set({ status: "dropped", dropReason: ONE_PER_PERSON, closedAt: now })
        .where(eq(journeys.id, j.id));
      await dropped(tx, j, j.node, now);
      report.journeys.duplicates++;
    }
    return placed;
  });
}

type Tx = Parameters<Parameters<typeof atomic>[1]>[0];

/** The version-cause arrival at `shape.v1` that holds a journey's trail (`rebuildJourney` seeds from it). */
async function arrive(tx: Tx, j: Journey, node: string, trail: Crossing[], at: Date) {
  await tx
    .insert(events)
    .values({
      workflow: shapeFlowId(1),
      node: `s_${node}`,
      port: "in",
      subject: `journey:${j.id}`,
      kind: "journey",
      data: {
        journey: j.id,
        profile: j.profileId,
        version: 1,
        from: null,
        to: node,
        edges: [],
        skipped: [],
        trail,
        cause: { kind: "version", ref: "funnels", at: at.toISOString() },
      },
      at,
      by: MIGRATE_BY,
    })
    .onConflictDoNothing();
}

/** The drop event `rebuildJourney` reads, so a rebuild keeps the journey dropped. */
async function dropped(tx: Tx, j: Journey, node: string, at: Date) {
  await tx
    .insert(events)
    .values({
      workflow: shapeFlowId(1),
      node: "dropped",
      port: "in",
      subject: `journey:${j.id}`,
      kind: "journey",
      data: {
        journey: j.id,
        profile: j.profileId,
        node,
        version: 1,
        reason: ONE_PER_PERSON,
        cause: { kind: "manual", ref: MIGRATE_BY, at: at.toISOString() },
      },
      at: new Date(Math.max(at.getTime(), j.movedAt.getTime() + 1)),
      by: MIGRATE_BY,
    })
    .onConflictDoNothing();
}

/**
 * The trail of an old journey: the opening from its source, then each arrival in order. An edge is
 * the flow edge between the two nodes, else null. It always ends at the journey's node.
 */
function trailOf(
  body: ShapeBody,
  entry: string,
  node: string,
  j: Journey,
  arrivals: { node: string | undefined; at: Date }[],
): Crossing[] {
  const trail: Crossing[] = [];
  const edge = (from: string, to: string) =>
    body.edges.find((e) => e.kind === "flow" && e.from === from && e.to === to)?.id ?? null;
  const known = new Set(body.nodes.map((n) => n.id));
  const push = (to: string, at: Date) => {
    const last = trail.at(-1);
    if (last?.to === to) return;
    const from = last?.to ?? (known.has(entry) ? entry : null);
    trail.push({ edge: from === null ? null : edge(from, to), from, to, at: at.toISOString() });
  };
  for (const a of arrivals) if (a.node && known.has(a.node)) push(a.node, a.at);
  if (trail.length === 0) push(node, j.openedAt);
  else if (trail.at(-1)?.to !== node) push(node, j.movedAt);
  return trail;
}
