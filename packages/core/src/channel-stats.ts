/**
 * Channel stats (designs/2026-10-15-channel-stats.md): who each channel reached, and how far they
 * went from there, side by side. Rows are cohorts: the people whose first reach on a channel (or a
 * source, or with a trait value) fell in the window. Their later steps count from that reach to
 * now. Bookings and payments carry no channel, so `attribution` decides whose they are:
 *
 * - `any`: booked after their first reach there (the default; one person can count on two rows).
 * - `first`: that reach was their first anywhere.
 * - `last`: it was their last reach before the booking.
 *
 * Every number opens its people (`channelPeople`). Post views and `/go/` visits know no person, so
 * they ride beside the funnel, never inside it.
 */
import type { Queryable } from "@wren/db";
import { type SQL, sql } from "drizzle-orm";
import {
  FUNNEL_STEPS,
  type FunnelStep,
  provesOf,
  STAT_CHANNEL_NAMES,
  type StatChannel,
} from "./channel-stats-schema.js";
import { PortalRefusal } from "./refusal.js";
import { compileRule, type Rule, readRule, segmentById } from "./segments.js";

export const STAT_BYS = ["channel", "source"] as const;
export const ATTRIBUTIONS = ["any", "first", "last"] as const;
export type Attribution = (typeof ATTRIBUTIONS)[number];

export interface StatsQuery {
  /** Rows per channel, per source (campaign, post, thread, link), or per a trait's value. */
  by?: "channel" | "source" | `trait:${string}`;
  /** Only this channel's reaches. */
  channel?: string | null;
  /** First reach in the last this many days; null or left out is ever. */
  days?: number | null;
  /** Only people in this segment now. */
  segment?: number | null;
  /** Only people this rule matches now. */
  rule?: unknown;
  attribution?: Attribution;
}

export interface StatsRow {
  /** The row's key, as `channelPeople` takes it back. */
  key: string;
  label: string;
  channel: string | null;
  sourceKind: string | null;
  source: string | null;
  /** People per step; null where the channel can't prove it. */
  people: Record<FunnelStep, number | null>;
  /** Each step as a share of reached, 0 to 1. */
  rates: Record<FunnelStep, number | null>;
  sends: number;
  costUsd: number | null;
  /** Post views and `/go/` visits on this channel in the window: no person behind them. */
  views: number | null;
  visits: number | null;
}

export interface ChannelStats {
  by: string;
  attribution: Attribution;
  from: string | null;
  to: string;
  rows: StatsRow[];
}

const DAY_MS = 86_400_000;
const TRAIT_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const CHANNEL = /^[a-z][a-z0-9_]{0,23}$/;
/** A source row's key: channel, kind and source, apart. */
const SEP = "\u001f";

interface Plan {
  by: string;
  trait: string | null;
  channel: string | null;
  from: string | null;
  to: string;
  attribution: Attribution;
  who: SQL;
}

/** A query checked, its filters read: refusals name the field. */
async function planOf(db: Queryable, q: StatsQuery, now: Date): Promise<Plan> {
  const by = q.by ?? "channel";
  const trait = by.startsWith("trait:") ? by.slice(6) : null;
  if (trait !== null ? !TRAIT_KEY.test(trait) : !STAT_BYS.includes(by as "channel"))
    throw new PortalRefusal("by is channel, source or trait:<key>", 400, "by");
  const channel = q.channel || null;
  if (channel && !CHANNEL.test(channel)) throw new PortalRefusal("no such channel", 400, "channel");
  const days = q.days ?? null;
  if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 3650))
    throw new PortalRefusal("days is 1 to 3650", 400, "days");
  const attribution = q.attribution ?? "any";
  if (!ATTRIBUTIONS.includes(attribution))
    throw new PortalRefusal("attribution is any, first or last", 400, "attribution");
  const tests: SQL[] = [];
  if (q.segment) {
    const s = await segmentById(db, Number(q.segment));
    if (!s) throw new PortalRefusal("no such segment", 404, "segment");
    tests.push(
      s.kind === "live" && s.rule
        ? compileRule(s.rule, now)
        : sql`p.id in (select m.profile_id from segment_members m where m.segment_id = ${s.id})`,
    );
  }
  if (q.rule !== undefined && q.rule !== null) {
    const got = readRule(q.rule);
    if ("problems" in got) throw new PortalRefusal(`the rule: ${got.problems.join("; ")}`, 422);
    tests.push(compileRule(got.rule as Rule, now));
  }
  return {
    by,
    trait,
    channel,
    from: days === null ? null : new Date(now.getTime() - days * DAY_MS).toISOString(),
    to: now.toISOString(),
    attribution,
    who: tests.length ? sql`and ${sql.join(tests, sql` and `)}` : sql``,
  };
}

/** Whether a `profile_steps` row (`alias`) is on cohort row `c`'s channel or source. */
function onRow(plan: Plan, alias: string): SQL {
  const x = sql.raw(alias);
  if (plan.by === "source")
    return sql`${x}.channel = c.channel and ${x}.source_kind = c.source_kind and ${x}.source = c.source`;
  if (plan.by === "channel") return sql`${x}.channel = c.channel`;
  return plan.channel ? sql`${x}.channel = ${plan.channel}` : sql`${x}.channel is not null`;
}

/** Whose an outcome (`x`) is, by the plan's attribution. */
function owns(plan: Plan): SQL {
  if (plan.attribution === "first")
    return sql`and c.first_at = (select min(r.at) from steps r
      where r.profile_id = c.profile_id and r.step = 'reached' and r.channel is not null)`;
  if (plan.attribution === "last")
    return sql`and coalesce((select ${onRow(plan, "r")} from steps r
      where r.profile_id = c.profile_id and r.step = 'reached' and r.channel is not null
        and r.at <= x.at order by r.at desc limit 1), false)`;
  return sql``;
}

/** Each cohort row's people with the time they took each step: `key, profile_id, <step>_at`. */
function hitsSql(plan: Plan): SQL {
  const key =
    plan.by === "source"
      ? sql`s.channel || ${SEP} || s.source_kind || ${SEP} || s.source`
      : plan.by === "channel"
        ? sql`s.channel`
        : sql`lower(trim(coalesce(t.value #>> '{}', '')))`;
  const trait = plan.trait
    ? sql`left join profile_traits t on t.profile_id = s.profile_id and t.key = ${plan.trait}`
    : sql``;
  // Each later step: the first one from their reach to now, on the row's channel (booked and
  // paid by the attribution), from one join over `steps`.
  const step = (name: FunnelStep) => {
    if (name === "reached") return sql`c.first_at`;
    const on = name === "booked" || name === "paid" ? owns(plan) : sql`and ${onRow(plan, "x")}`;
    return sql`min(x.at) filter (where x.step = ${name} ${on})`;
  };
  // `steps` reads the view once: a subquery per cohort row per step re-ran it each time, 93 s
  // on prod for 544 people (2026-10-16).
  return sql`with steps as materialized (
      select profile_id, channel, source_kind, source, step, at, sends, cost_usd from profile_steps
    ), reach as (
      select s.profile_id, ${key} key, s.channel, s.source_kind, s.source, s.at, s.sends, s.cost_usd
      from steps s
      join profiles p on p.id = s.profile_id and p.merged_into is null
      ${trait}
      where s.step = 'reached' and s.channel is not null and s.at <= ${plan.to}::timestamptz
        ${plan.channel ? sql`and s.channel = ${plan.channel}` : sql``}
        ${plan.who}
    ), cohort as (
      select profile_id, key, min(channel) channel, min(source_kind) source_kind,
        min(source) source, min(at) first_at,
        sum(sends) filter (where ${plan.from ? sql`at >= ${plan.from}::timestamptz` : sql`true`}) sends,
        sum(cost_usd) filter (where ${plan.from ? sql`at >= ${plan.from}::timestamptz` : sql`true`}) cost
      from reach group by profile_id, key
      ${plan.from ? sql`having min(at) >= ${plan.from}::timestamptz` : sql``}
    ), hits as (
      select c.key, c.profile_id, c.channel, c.source_kind, c.source, c.sends, c.cost,
        ${sql.join(
          FUNNEL_STEPS.map((n) => sql`${step(n)} ${sql.raw(`${n}_at`)}`),
          sql`, `,
        )}
      from cohort c
      left join steps x on x.profile_id = c.profile_id and x.step <> 'reached'
        and x.at >= c.first_at and x.at <= ${plan.to}::timestamptz
      group by c.key, c.profile_id, c.channel, c.source_kind, c.source, c.sends, c.cost, c.first_at
    )`;
}

type Row = Record<string, unknown>;
const rows = async (db: Queryable, q: SQL) => (await db.execute(q)) as unknown as Row[];

/** A `/go/` source or a post's platform as a channel; null when it names none. */
export function channelOfSource(raw: string): string | null {
  const s = raw.toLowerCase();
  if (s === "twitter") return "x";
  if (s === "meta") return "ads";
  if (s === "recruiting") return "email";
  if (["google", "bing", "duckduckgo", "yahoo", "ecosia", "brave"].includes(s)) return "search";
  return s in STAT_CHANNEL_NAMES ? s : null;
}

/** Post views and `/go/` visits per channel in the window. Either table may be missing. */
async function reachWithoutPeople(db: Queryable, plan: Plan) {
  const views = new Map<string, number>();
  const visits = new Map<string, number>();
  const add = (m: Map<string, number>, raw: unknown, n: unknown) => {
    const ch = channelOfSource(String(raw ?? ""));
    if (ch && Number(n)) m.set(ch, (m.get(ch) ?? 0) + Number(n));
  };
  const from = plan.from;
  try {
    for (const r of await rows(
      db,
      sql`select d.platform, sum(m.views) n from content_drafts d
        join lateral (select views from content_metrics m where m.draft_id = d.id
          order by m.as_of desc limit 1) m on true
        where d.published_at is not null and d.published_at <= ${plan.to}::timestamptz
          ${from ? sql`and d.published_at >= ${from}::timestamptz` : sql``}
        group by d.platform`,
    ))
      add(views, r.platform, r.n);
  } catch {
    // A workspace without content: no views.
  }
  try {
    for (const r of await rows(
      db,
      sql`select source, sum(clicks + hops) n from link_days
        where day <= ${plan.to}::date ${from ? sql`and day >= ${from}::date` : sql``}
        group by source`,
    ))
      add(visits, r.source, r.n);
  } catch {
    // A workspace without links: no visits.
  }
  return { views, visits };
}

const labelOf = (plan: Plan, r: Row): string => {
  const key = String(r.key ?? "");
  if (plan.by === "channel") return STAT_CHANNEL_NAMES[key as StatChannel] ?? key;
  if (plan.by === "source") return String(r.source || "(no source)");
  return key || "(not set)";
};

/** The funnel per channel, source or trait value, filtered by segment or rule. */
export async function channelStats(db: Queryable, q: StatsQuery, now: Date): Promise<ChannelStats> {
  const plan = await planOf(db, q, now);
  const got = await rows(
    db,
    sql`${hitsSql(plan)}
      select key, min(channel) channel, min(source_kind) source_kind, min(source) source,
        ${sql.join(
          FUNNEL_STEPS.map((n) => sql`count(${sql.raw(`${n}_at`)})::int ${sql.raw(n)}`),
          sql`, `,
        )},
        coalesce(sum(sends), 0)::int sends, sum(cost)::float8 cost
      from hits group by key order by count(*) desc, key limit 500`,
  );
  const extra =
    plan.by === "channel"
      ? await reachWithoutPeople(db, plan)
      : { views: new Map<string, number>(), visits: new Map<string, number>() };
  const out: StatsRow[] = got.map((r) => {
    const channel = plan.by === "channel" ? String(r.key) : r.channel ? String(r.channel) : null;
    const proves = plan.trait && !plan.channel ? FUNNEL_STEPS : provesOf(channel ?? "");
    const reached = Number(r.reached);
    const people = Object.fromEntries(
      FUNNEL_STEPS.map((n) => [n, proves.includes(n) ? Number(r[n]) : null]),
    ) as Record<FunnelStep, number | null>;
    const rates = Object.fromEntries(
      FUNNEL_STEPS.map((n) => {
        const v = people[n];
        return [n, v === null || !reached ? null : v / reached];
      }),
    ) as Record<FunnelStep, number | null>;
    return {
      key: String(r.key),
      label: labelOf(plan, r),
      channel,
      sourceKind: plan.by === "source" ? String(r.source_kind) : null,
      source: plan.by === "source" ? String(r.source ?? "") : null,
      people,
      rates,
      sends: Number(r.sends),
      costUsd: r.cost === null || r.cost === undefined ? null : Number(r.cost),
      views: channel ? (extra.views.get(channel) ?? null) : null,
      visits: channel ? (extra.visits.get(channel) ?? null) : null,
    };
  });
  // Channels with views or visits but nobody reached by name still get a row.
  if (plan.by === "channel")
    for (const ch of new Set([...extra.views.keys(), ...extra.visits.keys()])) {
      if (out.some((r) => r.key === ch) || (plan.channel && plan.channel !== ch)) continue;
      const zero = (n: FunnelStep) => (provesOf(ch).includes(n) ? 0 : null);
      out.push({
        key: ch,
        label: STAT_CHANNEL_NAMES[ch as StatChannel] ?? ch,
        channel: ch,
        sourceKind: null,
        source: null,
        people: Object.fromEntries(FUNNEL_STEPS.map((n) => [n, zero(n)])) as StatsRow["people"],
        rates: Object.fromEntries(FUNNEL_STEPS.map((n) => [n, null])) as StatsRow["rates"],
        sends: 0,
        costUsd: null,
        views: extra.views.get(ch) ?? null,
        visits: extra.visits.get(ch) ?? null,
      });
    }
  return { by: plan.by, attribution: plan.attribution, from: plan.from, to: plan.to, rows: out };
}

export interface StepPerson {
  id: number;
  name: string;
  email: string | null;
  /** When they took the step. */
  at: string;
  link: string;
}

/** The people behind one number: a row's key and a step, same filters. At most 500, latest first. */
export async function channelPeople(
  db: Queryable,
  q: StatsQuery & { key: string; step: FunnelStep },
  now: Date,
): Promise<StepPerson[]> {
  if (!FUNNEL_STEPS.includes(q.step)) throw new PortalRefusal("no such step", 400, "step");
  if (typeof q.key !== "string") throw new PortalRefusal("key is a row's key", 400, "key");
  const plan = await planOf(db, q, now);
  const at = sql.raw(`h.${q.step}_at`);
  const got = await rows(
    db,
    sql`${hitsSql(plan)}
      select p.id, coalesce(p.name, '#' || p.id) "name",
        (select k.value from profile_keys k where k.profile_id = p.id and k.kind = 'email'
          order by k.id limit 1) email,
        max(${at}) at
      from hits h join profiles p on p.id = h.profile_id
      where h.key = ${q.key} and ${at} is not null
      group by p.id order by max(${at}) desc limit 500`,
  );
  return got.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    email: (r.email as string | null) ?? null,
    at: (r.at instanceof Date ? r.at : new Date(String(r.at))).toISOString(),
    link: `/people/people/${Number(r.id)}`,
  }));
}

/** A row and step as a segment rule: who `channelPeople` lists, kept live. */
export function stepRule(
  row: Pick<StatsRow, "channel" | "source">,
  step: FunnelStep,
  days?: number | null,
): Rule {
  return {
    kind: "group",
    match: "all",
    of: [
      {
        kind: "step",
        step,
        ...(row.channel ? { channel: row.channel } : {}),
        ...(row.source ? { source: row.source } : {}),
        days: days ?? null,
      },
    ],
  };
}
