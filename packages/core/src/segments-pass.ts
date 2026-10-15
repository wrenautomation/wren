/**
 * The segments pass (designs/2026-10-14-customerio-audit.md, B5), one per workspace:
 *
 * 1. Every active live segment recomputed, dependencies first; entries and exits kept.
 * 2. What uses each segment written on its row (workflows' Segment triggers, other rules,
 *    broadcasts not yet done).
 * 3. Segments unused for 90 days archived.
 * 4. The spine told: each entry and exit past the last one told, to a Segment trigger that
 *    hears it; each trait change, to a Trait changed trigger; once a day from 09:00 (New York),
 *    each date trait whose day it is, to a Date trigger.
 *
 * `Segments/fleet` (Wren's) and `Segments/<client>/fleet` run it on `wake`: a trait, an address
 * or a segment changing wakes it at commit (`wren_wake`, migration 0252), and `SegmentsNet/all`
 * wakes every workspace each 15 minutes, the net under a lost wake and the timeline's changes.
 * Nothing fires on history: a workspace's first pass starts at its newest rows.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Db, Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { broadcastUses } from "./broadcasts.js";
import { type DateEvery, everyOf, offsetOf, SCHEDULE_ZONE, type TriggerFacts } from "./logic.js";
import { exclusiveHandler, NO_INPUT, sharedHandler } from "./restate/form.js";
import { clientKey, clientOfKey } from "./restate/keys.js";
import { makeLoopObject, type PassOutcome, runPass } from "./restate/loop.js";
import {
  archiveUnused,
  type MembershipChange,
  markUsed,
  recomputeLive,
  setUses,
} from "./segments.js";
import type { SegmentUse } from "./segments-schema.js";
import { type Fired, spineFire } from "./spine.js";
import { wallClock } from "./time.js";
import type { Workflow } from "./workflows.js";

/** The most entries, exits and trait changes told in one pass; the rest go on the next. */
export const FIRE_MOST = 2000;
/** The net's beat. */
export const SEGMENTS_NET_MS = 15 * 60_000;
/** The least time between two passes: a burst of changed rows is one pass, this much later. */
export const SEGMENTS_GAP_MS = 30_000;
/** The hour, in `SCHEDULE_ZONE`, Date triggers fire from. */
export const DATE_HOUR = 9;

/** Where a pass got to: the last entry or exit told, the last trait change, the last day dated. */
export interface SegmentCursor {
  members: number;
  traits: number;
  dated: string | null;
}

/** Each segment's workflows: the ones with a Segment trigger or an In segment step naming it. */
export function workflowUses(flows: readonly Workflow[]): Map<number, SegmentUse[]> {
  const out = new Map<number, SegmentUse[]>();
  for (const f of flows)
    for (const n of f.nodes) {
      if (n.uses !== "trigger.segment" && n.uses !== "logic.segment") continue;
      const id = Number(n.with?.segment);
      if (!Number.isSafeInteger(id) || id < 1) continue;
      const has = out.get(id) ?? [];
      if (!has.some((u) => u.id === f.id))
        out.set(id, [...has, { kind: "workflow", id: f.id, name: f.name }]);
    }
  return out;
}

/** Two maps of uses as one. */
export function joinUses(
  a: ReadonlyMap<number, SegmentUse[]>,
  b: ReadonlyMap<number, SegmentUse[]>,
): Map<number, SegmentUse[]> {
  const out = new Map(a);
  for (const [id, uses] of b) out.set(id, [...(out.get(id) ?? []), ...uses]);
  return out;
}

/** What the flows hear: segments, trait keys, and each Date trigger's settings. */
export function heard(flows: readonly Workflow[]) {
  const segments = new Set<number>();
  const traits = new Set<string>();
  const dates = new Map<string, { key: string; offset: number; every: DateEvery }>();
  for (const f of flows)
    for (const n of f.nodes) {
      const w = n.with ?? {};
      if (n.uses === "trigger.segment") segments.add(Number(w.segment));
      if (n.uses === "trigger.trait") traits.add(String(w.trait ?? "").trim());
      if (n.uses === "trigger.date") {
        const d = {
          key: String(w.trait ?? "").trim(),
          offset: offsetOf(w.offset),
          every: everyOf(w.every),
        };
        dates.set(`${d.key}|${d.offset}|${d.every}`, d);
      }
    }
  return { segments, traits, dates: [...dates.values()] };
}

type Row = Record<string, unknown>;
const rows = async (db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as Row[];

/** A profile as an event carries it: its name, first email and phone, and the lead steps' facts. */
interface Who {
  name: string | null;
  email: string | null;
  phone: string | null;
  textable: boolean;
}

async function whoOf(db: Queryable, ids: readonly number[]): Promise<Map<number, Who>> {
  if (!ids.length) return new Map();
  const got = await rows(
    db,
    sql`select p.id, p.name,
        (select k.value from profile_keys k where k.profile_id = p.id and k.kind = 'email'
          order by k.id limit 1) email,
        (select k.value from profile_keys k where k.profile_id = p.id and k.kind = 'phone'
          order by k.id limit 1) phone,
        exists (select 1 from profile_keys k join consents c on c.address = k.value
            and c.channel = 'sms' and c.state = 'confirmed'
          where k.profile_id = p.id and k.kind = 'phone') textable
      from profiles p where p.id in (${sql.join(
        [...new Set(ids)].map((id) => sql`${id}`),
        sql`, `,
      )})`,
  );
  return new Map(
    got.map((r) => [
      Number(r.id),
      {
        name: (r.name as string | null) ?? null,
        email: (r.email as string | null) ?? null,
        phone: (r.phone as string | null) ?? null,
        textable: r.textable === true,
      },
    ]),
  );
}

/** One fired event about a profile: the lead steps read `data.lead` as a door's lead. */
function profileFired(
  client: string | null,
  facts: TriggerFacts,
  subject: string,
  profile: number,
  who: Who | undefined,
  data: Record<string, unknown>,
): Fired {
  return {
    client,
    facts,
    ...(who?.email ? { about: [who.email] } : {}),
    event: {
      subject,
      kind: "lead",
      data: {
        profile,
        name: who?.name ?? null,
        email: who?.email ?? null,
        phone: who?.phone ?? null,
        ...data,
        lead: {
          name: who?.name ?? null,
          phone: who?.phone ?? null,
          email: who?.email ?? null,
          consent: who?.textable ?? false,
          consentDetail: who?.textable ? "consents: sms confirmed" : null,
          source: "segment",
          zone: null,
          niche: null,
        },
      },
    },
  };
}

/** `YYYY-MM-DD` and the hour in `SCHEDULE_ZONE` at `now`. */
function localDay(now: Date): { day: string; hour: number } {
  const w = wallClock(SCHEDULE_ZONE, now);
  const p = (n: number) => String(n).padStart(2, "0");
  return { day: `${w.year}-${p(w.month)}-${p(w.day)}`, hour: w.hour };
}

/** The profiles whose `key` date, moved `offset` days, is `day`: once, or each year. */
export async function dueOn(
  db: Queryable,
  d: { key: string; offset: number; every: DateEvery },
  day: string,
): Promise<{ profile: number; date: string }[]> {
  const target = sql`(${day}::date - ${d.offset}::int)`;
  const match =
    d.every === "once"
      ? sql`segment_date(t.value) = ${target}`
      : sql`(to_char(segment_date(t.value), 'MM-DD') = to_char(${target}, 'MM-DD')
          or (to_char(segment_date(t.value), 'MM-DD') = '02-29'
            and to_char(${target}, 'MM-DD') = '02-28'
            and to_char(${target} + 1, 'MM-DD') = '03-01'))`;
  const got = await rows(
    db,
    sql`select t.profile_id, segment_date(t.value)::text date from profile_traits t
      join profiles p on p.id = t.profile_id and p.merged_into is null
      where t.key = ${d.key} and ${match} order by t.profile_id limit 10000`,
  );
  return got.map((r) => ({ profile: Number(r.profile_id), date: String(r.date) }));
}

export interface SegmentsPassStats {
  recomputed: number;
  entered: number;
  left: number;
  archived: number[];
  told: number;
  /** More to tell than one pass tells: wake again. */
  more: boolean;
  cursor: SegmentCursor;
  fires: Fired[];
}

/** The newest ids, where a workspace's first pass starts. */
async function startOf(db: Queryable): Promise<SegmentCursor> {
  const [r] = await rows(
    db,
    sql`select (select coalesce(max(id), 0) from segment_member_events) members,
      (select coalesce(max(id), 0) from profile_trait_events) traits`,
  );
  return { members: Number(r?.members ?? 0), traits: Number(r?.traits ?? 0), dated: null };
}

/**
 * One workspace's pass: recompute, uses, archive, and the events to fire (returned, sent by the
 * caller). `client` null is Wren's. Pure of Restate, so tests run it on a database.
 */
export async function segmentsPass(
  db: Db,
  client: string | null,
  flows: readonly Workflow[],
  now: Date,
  from: SegmentCursor | null,
): Promise<SegmentsPassStats> {
  // The start is read before the recompute, so its entries are told.
  const cursor = from ?? (await startOf(db));
  const changes: MembershipChange[] = await recomputeLive(db, now);
  await setUses(db, joinUses(workflowUses(flows), await broadcastUses(db)), now);
  const archived = await archiveUnused(db, now);
  const ear = heard(flows);
  const fires: Fired[] = [];
  const next: SegmentCursor = { ...cursor };

  const moves = await rows(
    db,
    sql`select e.id, e.segment_id, e.profile_id, e.change, s.name from segment_member_events e
      join segments s on s.id = e.segment_id
      where e.id > ${cursor.members} order by e.id limit ${FIRE_MOST}`,
  );
  const traits = await rows(
    db,
    sql`select e.id, e.profile_id, e.key, e.old, e.new from profile_trait_events e
      where e.id > ${cursor.traits} order by e.id limit ${FIRE_MOST}`,
  );
  const heardMoves = moves.filter((m) => ear.segments.has(Number(m.segment_id)));
  const heardTraits = traits.filter((t) => ear.traits.has(String(t.key)));
  const today = localDay(now);
  const dates =
    today.hour >= DATE_HOUR && cursor.dated !== today.day && ear.dates.length
      ? (
          await Promise.all(
            ear.dates.map(async (d) => (await dueOn(db, d, today.day)).map((x) => ({ ...x, d }))),
          )
        ).flat()
      : [];
  const who = await whoOf(db, [
    ...heardMoves.map((m) => Number(m.profile_id)),
    ...heardTraits.map((t) => Number(t.profile_id)),
    ...dates.map((x) => x.profile),
  ]);
  for (const m of heardMoves) {
    const profile = Number(m.profile_id);
    const change = m.change === "left" ? "left" : "entered";
    fires.push(
      profileFired(
        client,
        { trigger: "trigger.segment", segment: Number(m.segment_id), change },
        `profile:${profile}`,
        profile,
        who.get(profile),
        { segment: Number(m.segment_id), segment_name: String(m.name), change },
      ),
    );
  }
  const text = (v: unknown) =>
    v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v);
  for (const t of heardTraits) {
    const profile = Number(t.profile_id);
    const value = text(t.new);
    fires.push(
      profileFired(
        client,
        { trigger: "trigger.trait", key: String(t.key), value },
        `profile:${profile}`,
        profile,
        who.get(profile),
        { trait: String(t.key), value, old: text(t.old) },
      ),
    );
  }
  for (const x of dates)
    fires.push(
      profileFired(
        client,
        { trigger: "trigger.date", key: x.d.key, offset: x.d.offset, every: x.d.every },
        // Once per person, date trigger and day: a birthday comes round again next year.
        `profile:${x.profile}:${x.d.key}${x.d.offset ? `${x.d.offset > 0 ? "+" : ""}${x.d.offset}` : ""}@${today.day}`,
        x.profile,
        who.get(x.profile),
        { trait: x.d.key, date: x.date, offset: x.d.offset, day: today.day },
      ),
    );
  const last = (xs: Row[], was: number) => (xs.length ? Number(xs[xs.length - 1]?.id) : was);
  next.members = last(moves, cursor.members);
  next.traits = last(traits, cursor.traits);
  if (today.hour >= DATE_HOUR) next.dated = today.day;
  await markUsed(
    db,
    heardMoves.map((m) => Number(m.segment_id)),
    now,
  );
  return {
    recomputed: changes.length,
    entered: changes.reduce((n, c) => n + c.entered.length, 0),
    left: changes.reduce((n, c) => n + c.left.length, 0),
    archived,
    told: fires.length,
    more: moves.length === FIRE_MOST || traits.length === FIRE_MOST,
    cursor: next,
    fires,
  };
}

export interface SegmentsDeps {
  main: Db;
  clientDb(id: string): Db;
  /** A workspace's workflows with its saved edits (`flowsWith`); null is Wren's. */
  flows(client: string | null): Promise<Workflow[]>;
  /** Every client with a database, for the net. */
  clients(): Promise<string[]>;
}

export const SEGMENTS = { name: "Segments" } as const;
/** Wren's own pass's key; a client's is `<client>/fleet`. */
export const SEGMENTS_KEY = "fleet";
const CURSOR = "cursor";
const LAST = "last";
const LATER = "later";

type Self = { wake: (ctx: restate.ObjectContext) => Promise<unknown> };

/** A workspace's pass on `wake`, and its last outcome on `status`. */
export function makeSegments(d: SegmentsDeps) {
  return restate.object({
    name: SEGMENTS.name,
    handlers: {
      /** One pass now. The box's listener calls it on a changed row; the net every 15 minutes. */
      wake: exclusiveHandler({ input: NO_INPUT }, async (ctx: restate.ObjectContext) => {
        const client = ctx.key === SEGMENTS_KEY ? null : (clientOfKey(ctx.key)?.client ?? null);
        if (ctx.key !== SEGMENTS_KEY && !client) return { skipped: "no such workspace" };
        const now = new Date(await ctx.date.now());
        const last = await ctx.get<{ at: string }>(LAST);
        const since = last ? now.getTime() - Date.parse(last.at) : Number.POSITIVE_INFINITY;
        if (since < SEGMENTS_GAP_MS) {
          // Too soon after the last pass: one more, once the gap is up, for every wake till then.
          if (!(await ctx.get<boolean>(LATER))) {
            ctx.set(LATER, true);
            ctx
              .objectSendClient<Self>(SEGMENTS, ctx.key)
              .wake(restate.rpc.sendOpts({ delay: SEGMENTS_GAP_MS - since }));
          }
          return { skipped: "soon" };
        }
        ctx.clear(LATER);
        const from = (await ctx.get<SegmentCursor>(CURSOR)) ?? null;
        // A failed pass is said in `status` and tried again by the next wake, never retried hot.
        const out = await ctx.run("pass", async () => {
          try {
            const db = client ? d.clientDb(client) : d.main;
            return await segmentsPass(db, client, await d.flows(client), now, from);
          } catch (err) {
            return { error: String(err).slice(0, 500) };
          }
        });
        if ("error" in out) {
          ctx.set(LAST, { at: now.toISOString(), error: out.error });
          return { error: out.error };
        }
        for (const f of out.fires) spineFire(ctx, f);
        ctx.set(CURSOR, out.cursor);
        const { fires: _fires, ...stats } = out;
        ctx.set(LAST, { at: now.toISOString(), ...stats });
        if (out.more) {
          ctx.set(LATER, true);
          ctx
            .objectSendClient<Self>(SEGMENTS, ctx.key)
            .wake(restate.rpc.sendOpts({ delay: SEGMENTS_GAP_MS }));
        }
        return stats;
      }),
      status: sharedHandler({ input: NO_INPUT }, async (ctx: restate.ObjectSharedContext) => ({
        key: ctx.key,
        cursor: (await ctx.get<SegmentCursor>(CURSOR)) ?? null,
        last: (await ctx.get(LAST)) ?? null,
      })),
    },
  });
}

export interface SegmentsNetStats {
  woken: number;
}

/** `SegmentsNet/all`: every 15 minutes, a wake to Wren's segments and every client's. */
export function makeSegmentsNet(d: Pick<SegmentsDeps, "main" | "clients">) {
  return makeLoopObject("SegmentsNet", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const outcome = (await runPass<SegmentsNetStats & { keys: string[] }>(ctx, d.main, now, {
      name: "segments net",
      ledger: { command: "segments net", argv: { daemon: true } },
      body: async () => {
        const keys = [SEGMENTS_KEY, ...(await d.clients()).map((c) => clientKey(c, SEGMENTS_KEY))];
        return { woken: keys.length, keys };
      },
      delayAfter: () => SEGMENTS_NET_MS,
      retryMs: SEGMENTS_NET_MS,
    })) as PassOutcome<SegmentsNetStats & { keys: string[] }>;
    for (const key of outcome.stats?.keys ?? []) ctx.objectSendClient<Self>(SEGMENTS, key).wake();
    return outcome;
  });
}

export type SegmentsService = ReturnType<typeof makeSegments>;
export type SegmentsNetService = ReturnType<typeof makeSegmentsNet>;
