/**
 * Fold the old Opportunities deals into journeys (designs/2026-10-18-journeys.md, "Folding
 * `@wren/deals`"). `wren pipeline fold-deals` runs it. Safe to repeat: a deal with a journey
 * (`legacy_deal`) is skipped, a pipeline with a funnel (version 1's reason names it) is reused.
 *
 * The old tables are in main, one `client` column for the owner. The journeys go where the owner
 * works: main for Wren, the client's own database for a client. Reads use plain SQL, because the
 * old tables have no schema file any more.
 *
 * - A pipeline becomes a funnel, version 1: every stage but `lost`, the `won` stage as the sale.
 *   The default pipeline with no deals in it makes nothing.
 * - A deal becomes a journey. The person comes from the contact's email or phone (made if none).
 * - A move becomes a spine event at `s_<to>`, cause `import`, by `fold`. They are inserted
 *   direct, so no step runs and history fires no trigger.
 * - A deal at the sale stage gets an open deal row, with no terms, when the offer has a version.
 * - Everything else the old deal held rides in the journey's `entry_ref.legacy`: the old tables
 *   go, and nothing is lost.
 * - A client's folded deal rows leave main, so the guard migration can tell what is left.
 */
import { randomUUID } from "node:crypto";
import { keyOf, profileOf, resolveProfile } from "@wren/core/profiles";
import { events } from "@wren/core/schema";
import { atomic, type Db, type Queryable, snapshot } from "@wren/db";
import type { SQL } from "drizzle-orm";
import { and, desc, eq, sql } from "drizzle-orm";
import { DROPPED, type FunnelBody } from "./model.js";
import { funnels, funnelVersions, journeys, offerVersions, pipelineDeals } from "./schema.js";
import { addFunnel, Refused } from "./store.js";
import { funnelFlowId } from "./workflow.js";

/** The `by` of the events the fold writes. */
export const FOLD_BY = "fold";
const SOURCE = "deals-fold";

// --- the old rows ---------------------------------------------------------------------------

export type OldKind = "open" | "won" | "lost";
export interface OldStage {
  key: string;
  label: string;
  kind: OldKind;
}
export interface OldPipeline {
  id: string;
  name: string;
  stages: OldStage[];
}
export interface OldDeal {
  id: string;
  pipeline: string;
  stage: string;
  status: OldKind;
  name: string;
  valueCents: number | null;
  currency: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  source: string;
  sourceRef: string | null;
  owner: string | null;
  note: string | null;
  nextOn: string | null;
  movedAt: Date;
  closedAt: Date | null;
  createdAt: Date;
  createdBy: string;
}
export interface OldMove {
  deal: string;
  from: string | null;
  to: string;
  at: Date;
  by: string;
}

/** The pipeline every owner got on its first read. One of these with no deals maps to nothing. */
const DEFAULT_NAME = "Sales";
const DEFAULT_SHAPE = "new:open,contacted:open,booked:open,quoted:open,won:won,lost:lost";
const shapeOf = (stages: readonly OldStage[]) => stages.map((s) => `${s.key}:${s.kind}`).join(",");
export const isDefaultPipeline = (p: OldPipeline) =>
  p.name === DEFAULT_NAME && shapeOf(p.stages) === DEFAULT_SHAPE;

// --- the pure mapping -----------------------------------------------------------------------

/** A funnel id from a pipeline's name: a lowercase slug of 40 characters or fewer. */
export function funnelIdOf(name: string, taken: ReadonlySet<string>): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const root = !slug
    ? "pipeline"
    : (/^[a-z]/.test(slug) ? slug : `p-${slug}`).slice(0, 36).replace(/-+$/, "");
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) {
    const id = `${root.slice(0, 36 - String(n).length)}-${n}`.replace(/--/g, "-");
    if (!taken.has(id)) return id;
  }
}

/** The funnel stage key for each old stage key: a valid key, none twice, never `dropped`. */
export function stageKeys(stages: readonly OldStage[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const s of stages) {
    const clean = s.key.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    let key = (/^[a-z]/.test(clean) ? clean : `s_${clean}`).slice(0, 40);
    if (key === DROPPED) key = "dropped_stage";
    for (let n = 2; used.has(key); n++) key = `${key.slice(0, 37)}_${n}`;
    used.add(key);
    out.set(s.key, key);
  }
  return out;
}

export interface Mapped {
  body: FunnelBody;
  /** Old stage key to funnel stage key; the `lost` stage has none. */
  keys: Map<string, string>;
  sale: string;
}

/** The funnel a pipeline becomes. A string is why it cannot. */
export function funnelOf(p: OldPipeline, offer: string): Mapped | string {
  const won = p.stages.find((s) => s.kind === "won");
  if (!won) return `Pipeline "${p.name}" has no won stage, so it has no sale stage.`;
  const keys = stageKeys(p.stages);
  const kept = p.stages.filter((s) => s.kind !== "lost");
  const sale = keys.get(won.key) as string;
  const keptKeys = new Map(
    [...keys].filter(([k]) => p.stages.find((s) => s.key === k)?.kind !== "lost"),
  );
  return {
    body: {
      name: p.name,
      offer,
      stages: kept.map((s) => ({
        key: keys.get(s.key) as string,
        label: s.label,
        ...(s.key === won.key ? { sale: true as const } : {}),
        on: [],
      })),
      entries: [{ id: "manual", kind: "manual" }],
    },
    keys: keptKeys,
    sale,
  };
}

export interface Arrival {
  at: Date;
  from: string | null;
  to: string;
}
export interface Plan {
  stage: string;
  status: "open" | "done" | "dropped";
  reason: string | null;
  openedAt: Date;
  movedAt: Date;
  closedAt: Date | null;
  arrivals: Arrival[];
  dropped: { at: Date; stage: string; reason: string } | null;
  /** When the journey reached the sale stage, if it did. */
  sale: Date | null;
  warnings: string[];
}

const byTime = (a: OldMove, b: OldMove) => a.at.getTime() - b.at.getTime();

/**
 * What a deal and its moves become: the arrivals, the drop, the row. The row follows the deal's
 * own stage. The events keep each stage's first visit only (a journey moves forward and enters a
 * stage once), and a warning says where the history held more.
 */
export function planJourney(
  deal: OldDeal,
  moves: readonly OldMove[],
  pipe: OldPipeline,
  map: Mapped,
): Plan | string {
  const old = new Map(pipe.stages.map((s) => [s.key, s] as const));
  const here = old.get(deal.stage);
  if (!here)
    return `Deal ${deal.id} is in stage "${deal.stage}", which its pipeline does not have.`;
  const warnings: string[] = [];
  const first = map.body.stages[0]?.key as string;
  const last = map.body.stages.at(-1)?.key as string;
  const timeline = moves.length
    ? [...moves].sort(byTime)
    : [{ deal: deal.id, from: null, to: deal.stage, at: deal.createdAt, by: deal.createdBy }];

  const arrivals: Arrival[] = [];
  const seen = new Set<string>();
  let lostAt: Date | null = null;
  let lostLabel: string | null = null;
  for (const m of timeline) {
    const s = old.get(m.to);
    if (!s) {
      warnings.push(`A move went to stage "${m.to}", which the pipeline does not have.`);
      continue;
    }
    if (s.kind === "lost") {
      lostAt = m.at;
      lostLabel = s.label;
      continue;
    }
    const key = map.keys.get(m.to) as string;
    if (seen.has(key)) {
      warnings.push(`Moved back to "${s.label}". The history keeps the first visit.`);
      continue;
    }
    seen.add(key);
    arrivals.push({ at: m.at, from: arrivals.at(-1)?.to ?? null, to: key });
  }

  const lost = deal.status === "lost";
  if (lost && arrivals.length === 0) {
    // Born lost: it rested nowhere, so it opens at the first stage.
    arrivals.push({ at: deal.createdAt, from: null, to: first });
    seen.add(first);
  }
  const stage = lost ? (arrivals.at(-1)?.to as string) : (map.keys.get(deal.stage) as string);
  if (!lost && !seen.has(stage)) {
    arrivals.push({ at: deal.movedAt, from: arrivals.at(-1)?.to ?? null, to: stage });
    seen.add(stage);
  }
  if (!lost && arrivals.at(-1)?.to !== stage)
    warnings.push(
      `The deal is at "${here.label}", but its history ends elsewhere. The row follows the deal.`,
    );

  const rested = arrivals.at(-1)?.at ?? deal.movedAt;
  // The row is the deal's truth: it moved when the deal moved.
  const movedAt = lost ? rested : deal.movedAt;
  const reason = lost ? (lostLabel ?? here.label) : null;
  const dropAt = lost ? (lostAt ?? deal.closedAt ?? deal.movedAt) : null;
  const status: Plan["status"] = lost ? "dropped" : stage === last ? "done" : "open";
  return {
    stage,
    status,
    reason,
    openedAt: deal.createdAt,
    movedAt,
    closedAt: lost ? (dropAt as Date) : status === "done" ? movedAt : null,
    arrivals,
    dropped: lost ? { at: dropAt as Date, stage, reason: reason as string } : null,
    sale: arrivals.find((a) => a.to === map.sale)?.at ?? null,
    warnings,
  };
}

// --- reading the old tables -----------------------------------------------------------------

const rows = async <T>(db: Queryable, q: SQL): Promise<T[]> =>
  (await db.execute(q)) as unknown as T[];

const date = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const dateOrNull = (v: unknown): Date | null => (v === null || v === undefined ? null : date(v));

/** Do the old tables exist? After the drop migration they do not, and there is nothing to fold. */
export async function oldTablesExist(db: Queryable): Promise<boolean> {
  const [r] = await rows<{ ok: boolean }>(
    db,
    sql`select (to_regclass('public.deals') is not null
      and to_regclass('public.deal_pipelines') is not null
      and to_regclass('public.deal_moves') is not null) as ok`,
  );
  return r?.ok === true;
}

/** Every owner with an old pipeline or deal: null is Wren. */
export async function oldOwners(db: Queryable): Promise<(string | null)[]> {
  const found = await rows<{ client: string | null }>(
    db,
    sql`select distinct client from (
      select client from deal_pipelines union all select client from deals) t order by client nulls first`,
  );
  return found.map((r) => r.client);
}

interface Old {
  pipelines: OldPipeline[];
  deals: OldDeal[];
  moves: Map<string, OldMove[]>;
}

async function readOld(main: Db, owner: string | null): Promise<Old> {
  const who = sql`client is not distinct from ${owner}::varchar`;
  return snapshot(main, async (tx) => {
    const pipelines = (
      await rows<{ id: string; name: string; stages: OldStage[] }>(
        tx,
        sql`select id::text id, name, stages from deal_pipelines where ${who} order by created_at, id`,
      )
    ).map((p) => ({ id: p.id, name: p.name, stages: p.stages }));
    const deals = (
      await rows<Record<string, unknown>>(
        tx,
        sql`select id::text id, pipeline::text pipeline, stage, status, name, value_cents, currency,
          contact_name, contact_email, contact_phone, source, source_ref, owner, note,
          next_on::text next_on, moved_at, closed_at, created_at, created_by
          from deals where ${who} order by created_at, id`,
      )
    ).map(
      (d): OldDeal => ({
        id: String(d.id),
        pipeline: String(d.pipeline),
        stage: String(d.stage),
        status: d.status as OldKind,
        name: String(d.name),
        valueCents: d.value_cents === null ? null : Number(d.value_cents),
        currency: String(d.currency),
        contactName: (d.contact_name as string | null) ?? null,
        contactEmail: (d.contact_email as string | null) ?? null,
        contactPhone: (d.contact_phone as string | null) ?? null,
        source: String(d.source),
        sourceRef: (d.source_ref as string | null) ?? null,
        owner: (d.owner as string | null) ?? null,
        note: (d.note as string | null) ?? null,
        nextOn: (d.next_on as string | null) ?? null,
        movedAt: date(d.moved_at),
        closedAt: dateOrNull(d.closed_at),
        createdAt: date(d.created_at),
        createdBy: String(d.created_by),
      }),
    );
    const moves = new Map<string, OldMove[]>();
    const all = await rows<Record<string, unknown>>(
      tx,
      sql`select m.deal::text deal, m."from" "from", m."to" "to", m.at, m.by
        from deal_moves m join deals d on d.id = m.deal
        where d.client is not distinct from ${owner}::varchar order by m.deal, m.at, m.id`,
    );
    for (const m of all) {
      const list = moves.get(String(m.deal)) ?? [];
      list.push({
        deal: String(m.deal),
        from: (m.from as string | null) ?? null,
        to: String(m.to),
        at: date(m.at),
        by: String(m.by),
      });
      moves.set(String(m.deal), list);
    }
    return { pipelines, deals, moves };
  });
}

// --- the fold --------------------------------------------------------------------------------

export interface FoldDeps {
  /** Main: the old tables, and Wren's own workspace. */
  main: Db;
  /** Run `fn` in an owner's workspace database: main for null, the client's own else. */
  workspace<T>(owner: string | null, fn: (db: Db) => Promise<T>): Promise<T>;
}

export interface FoldOptions {
  /** Only these owners (null is Wren). Left out: every owner with old rows. */
  owners?: readonly (string | null)[];
  /** Say what would happen; write nothing. */
  dry?: boolean;
  /** The registry offer a new funnel sells. Needed only when a funnel is made. */
  offer?: string;
  /** Who the funnel versions name. */
  by: string;
  /** Trigger component ids a stage may name. */
  triggers: ReadonlySet<string>;
}

export interface FoldFunnel {
  pipeline: string;
  funnel: string;
  /** False when the funnel was there already. */
  made: boolean;
}
export interface OwnerReport {
  owner: string | null;
  funnels: FoldFunnel[];
  /** Pipelines that map to nothing, with the reason. */
  skipped: string[];
  journeys: { made: number; had: number };
  events: number;
  /** Deal rows made for deals that reached the sale stage. */
  deals: number;
  /** Folded rows taken out of main (a client's only). */
  removed: number;
  /** Things a person must fix; the guard migration waits on them. */
  conflicts: string[];
  warnings: string[];
}
export interface FoldReport {
  /** False once the old tables are gone. */
  tables: boolean;
  dry: boolean;
  owners: OwnerReport[];
}

const nameOf = (d: OldDeal) => d.contactName?.trim() || d.name;

/** The newest version of an offer in this workspace, if the offer has one. */
async function offerVersionOf(db: Queryable, offer: string): Promise<number | null> {
  const [v] = await db
    .select({ number: offerVersions.number })
    .from(offerVersions)
    .where(eq(offerVersions.offer, offer))
    .orderBy(desc(offerVersions.number))
    .limit(1);
  return v?.number ?? null;
}

const whyOf = (pipeline: string) => `Folded from deal pipeline ${pipeline}`;

export async function foldDeals(deps: FoldDeps, o: FoldOptions): Promise<FoldReport> {
  const dry = o.dry === true;
  if (!(await oldTablesExist(deps.main))) return { tables: false, dry, owners: [] };
  const owners = o.owners ?? (await oldOwners(deps.main));
  const out: OwnerReport[] = [];
  for (const owner of owners) out.push(await foldOwner(deps, owner, o));
  return { tables: true, dry, owners: out };
}

async function foldOwner(
  deps: FoldDeps,
  owner: string | null,
  o: FoldOptions,
): Promise<OwnerReport> {
  const dry = o.dry === true;
  const old = await readOld(deps.main, owner);
  const r: OwnerReport = {
    owner,
    funnels: [],
    skipped: [],
    journeys: { made: 0, had: 0 },
    events: 0,
    deals: 0,
    removed: 0,
    conflicts: [],
    warnings: [],
  };
  const folded: string[] = [];
  /** A dry run's open journeys so far: contact and funnel. */
  const planned = new Set<string>();
  await deps.workspace(owner, async (db) => {
    const taken = new Set((await db.select({ id: funnels.id }).from(funnels)).map((f) => f.id));
    for (const p of old.pipelines) {
      const mine = old.deals.filter((d) => d.pipeline === p.id);
      if (isDefaultPipeline(p) && !mine.length) {
        r.skipped.push(`${p.name}: the default pipeline, no deals`);
        continue;
      }
      const [have] = await db
        .select({ funnel: funnelVersions.funnel, body: funnelVersions.body })
        .from(funnelVersions)
        .where(and(eq(funnelVersions.number, 1), eq(funnelVersions.why, whyOf(p.id))));
      // A funnel there already keeps its own offer; the keys come from the same stages.
      const offer = have?.body.offer ?? o.offer;
      if (!offer) {
        throw new Refused([
          `Pipeline "${p.name}" needs a funnel. Say which offer it sells: --offer <id>.`,
        ]);
      }
      const mapped = funnelOf(p, offer);
      if (typeof mapped === "string") {
        r.conflicts.push(mapped);
        continue;
      }
      let funnel = have?.funnel;
      if (!funnel) {
        funnel = funnelIdOf(p.name, taken);
        taken.add(funnel);
        if (!dry)
          await addFunnel(db, {
            id: funnel,
            name: p.name,
            body: mapped.body,
            why: whyOf(p.id),
            by: o.by,
            triggers: o.triggers,
          });
      }
      r.funnels.push({ pipeline: p.name, funnel, made: !have });

      for (const d of mine) {
        const [done] = await db
          .select({ id: journeys.id })
          .from(journeys)
          .where(eq(journeys.legacyDeal, d.id));
        if (done) {
          r.journeys.had += 1;
          folded.push(d.id);
          continue;
        }
        const plan = planJourney(d, old.moves.get(d.id) ?? [], p, mapped);
        if (typeof plan === "string") {
          r.conflicts.push(plan);
          continue;
        }
        for (const w of plan.warnings) r.warnings.push(`Deal ${d.id}: ${w}`);
        if (dry) {
          if (plan.status === "open" && (await holdsOpen(db, d, funnel, planned))) {
            r.conflicts.push(conflictOf(d, funnel));
            continue;
          }
          r.journeys.made += 1;
          r.events += plan.arrivals.length + (plan.dropped ? 1 : 0);
          continue;
        }
        const made = await writeJourney(db, { deal: d, plan, funnel, body: mapped.body });
        if (made === null) {
          r.conflicts.push(conflictOf(d, funnel));
          continue;
        }
        if (made === "had") r.journeys.had += 1;
        else {
          r.journeys.made += 1;
          r.events += made.events;
          if (made.deal) r.deals += 1;
          else if (plan.sale)
            r.warnings.push(`Deal ${d.id}: no offer version for ${offer} here, so no deal row.`);
        }
        folded.push(d.id);
      }
    }
    // A deal in a pipeline that did not fold has no journey. The guard migration will say so.
    const known = new Set(old.pipelines.map((p) => p.id));
    for (const d of old.deals)
      if (!known.has(d.pipeline)) r.conflicts.push(`Deal ${d.id} has no pipeline.`);
  });

  // A client's journeys live in its own database, which main's guard cannot see. So its folded
  // rows leave main; whatever stays there is what the fold has not done.
  if (!dry && owner !== null && folded.length) {
    const ids = sql.join(
      folded.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    await atomic(deps.main, async (tx) => {
      await tx.execute(sql`delete from deals where client = ${owner} and id in (${ids})`);
    });
    r.removed = folded.length;
  }
  return r;
}

const conflictOf = (d: OldDeal, funnel: string) =>
  `Deal ${d.id} (${d.name}): the person already has an open journey in ${funnel}. Close one deal and run again.`;

/**
 * Dry run only: would this deal's open journey meet another for the same person and funnel? A
 * person with no address is their own, so never.
 */
async function holdsOpen(
  db: Db,
  d: OldDeal,
  funnel: string,
  planned: Set<string>,
): Promise<boolean> {
  const keys = [
    keyOf({ kind: "email", value: d.contactEmail }),
    keyOf({ kind: "phone", value: d.contactPhone }),
  ].filter((k) => k !== null);
  if (!keys.length) return false;
  const marks = keys.map((k) => `${funnel}|${k.kind}:${k.value}`);
  const clash = marks.some((m) => planned.has(m));
  for (const m of marks) planned.add(m);
  if (clash) return true;
  for (const k of keys) {
    const id = await profileOf(db, k);
    if (id === null) continue;
    const [open] = await db
      .select({ id: journeys.id })
      .from(journeys)
      .where(
        and(eq(journeys.profileId, id), eq(journeys.funnel, funnel), eq(journeys.status, "open")),
      );
    if (open) return true;
  }
  return false;
}

interface Written {
  events: number;
  deal: boolean;
}

/**
 * One deal: the person, the journey, its events and, at the sale stage, its deal row, in one
 * transaction. "had": another run got there first. Null: the person holds an open journey in this
 * funnel already, from another deal.
 */
async function writeJourney(
  db: Db,
  p: { deal: OldDeal; plan: Plan; funnel: string; body: FunnelBody },
): Promise<Written | "had" | null> {
  const { deal, plan, funnel, body } = p;
  return atomic(db, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`fold:${deal.id}`}))`);
    const [again] = await tx
      .select({ id: journeys.id })
      .from(journeys)
      .where(eq(journeys.legacyDeal, deal.id));
    if (again) return "had" as const;
    const keys = [
      { kind: "email", value: deal.contactEmail },
      { kind: "phone", value: deal.contactPhone },
    ];
    let person = await resolveProfile(tx, keys, SOURCE, {
      name: nameOf(deal),
      at: deal.createdAt,
    });
    // No usable address: the deal is its own person, found again by its id.
    person ??= await resolveProfile(tx, [{ kind: "crm:deal", value: deal.id }], SOURCE, {
      name: nameOf(deal),
      at: deal.createdAt,
    });
    if (!person) throw new Error(`deal ${deal.id}: no person could be made`);
    const id = randomUUID();
    const [row] = await tx
      .insert(journeys)
      .values({
        id,
        profileId: person.id,
        funnel,
        version: 1,
        stage: plan.stage,
        status: plan.status,
        dropReason: plan.reason,
        entry: "manual",
        entryRef: { legacy: legacyOf(deal) },
        openedAt: plan.openedAt,
        movedAt: plan.movedAt,
        closedAt: plan.closedAt,
        legacyDeal: deal.id,
      })
      .onConflictDoNothing()
      .returning({ id: journeys.id });
    if (!row) return null;

    const workflow = funnelFlowId(funnel, 1);
    const cause = (at: Date) => ({ kind: "import", ref: deal.id, at: at.toISOString() });
    const base = { journey: id, profile: person.id, funnel, version: 1 };
    const arrivals = plan.arrivals.map((a) => ({
      workflow,
      node: `s_${a.to}`,
      port: "in",
      subject: `journey:${id}`,
      kind: "journey" as const,
      data: { ...base, from: a.from, to: a.to, skipped: [], cause: cause(a.at) },
      at: a.at,
      by: FOLD_BY,
      sent: [],
      sentAt: a.at,
    }));
    const drop = plan.dropped
      ? [
          {
            workflow,
            node: DROPPED,
            port: "in",
            subject: `journey:${id}`,
            kind: "journey" as const,
            data: {
              ...base,
              stage: plan.dropped.stage,
              reason: plan.dropped.reason,
              cause: cause(plan.dropped.at),
            },
            at: plan.dropped.at,
            by: FOLD_BY,
            sent: [],
            sentAt: plan.dropped.at,
          },
        ]
      : [];
    const made = await tx
      .insert(events)
      .values([...arrivals, ...drop])
      .onConflictDoNothing()
      .returning({ id: events.id });

    let dealRow = false;
    if (plan.sale) {
      const version = await offerVersionOf(tx, body.offer);
      if (version !== null) {
        await tx
          .insert(pipelineDeals)
          .values({
            journey: id,
            profileId: person.id,
            offer: body.offer,
            offerVersion: version,
            signedAt: plan.sale,
            status: "open",
            currency: deal.currency.toUpperCase().slice(0, 3),
          })
          .onConflictDoNothing({ target: pipelineDeals.journey });
        dealRow = true;
      }
    }
    return { events: made.length, deal: dealRow };
  });
}

/** What the old deal held that a journey has no column for. */
function legacyOf(d: OldDeal): Record<string, unknown> {
  return {
    deal: d.id,
    name: d.name,
    value_cents: d.valueCents,
    currency: d.currency,
    contact_name: d.contactName,
    email: d.contactEmail,
    phone: d.contactPhone,
    source: d.source,
    source_ref: d.sourceRef,
    owner: d.owner,
    note: d.note,
    next_on: d.nextOn,
    created_by: d.createdBy,
  };
}

/** The report in plain lines, for the CLI. */
export function foldLines(r: FoldReport): string[] {
  if (!r.tables) return ["The old deals tables are gone. Nothing to fold."];
  const out: string[] = [];
  const dry = r.dry ? "would " : "";
  for (const o of r.owners) {
    const who = o.owner ?? "wren";
    for (const f of o.funnels)
      out.push(
        `${who}: pipeline "${f.pipeline}" ${f.made ? `${dry}make` : "has"} funnel ${f.funnel}`,
      );
    for (const s of o.skipped) out.push(`${who}: skipped ${s}`);
    out.push(
      `${who}: ${o.journeys.made} journeys ${r.dry ? "to make" : "made"}, ${o.journeys.had} there already, ${o.events} events, ${o.deals} deal rows${o.removed ? `, ${o.removed} rows out of main` : ""}`,
    );
    for (const w of o.warnings) out.push(`${who}: note: ${w}`);
    for (const c of o.conflicts) out.push(`${who}: CONFLICT: ${c}`);
  }
  if (!r.owners.length) out.push("No old deals or pipelines. Nothing to fold.");
  return out;
}
