/**
 * The people map (designs/2026-10-15-people-map.md): each live profile's stage, warmth (and why),
 * subscriptions, replies, first and last touch, and persona, rebuilt in one set-based statement
 * from the source tables through `profile_keys`. Tables in `./people-map-schema.ts`.
 *
 * `rollupRows` is the one query: `refreshPeople` writes it into `profile_rollups` (changed rows
 * only), and `warmthOf` reads it live for a few profiles, so the warm gate never waits on a pass.
 */
import { atomic, type Queryable } from "@wren/db";
import { type SQL, sql } from "drizzle-orm";
import {
  PERSONA_ROLES,
  PERSONA_SIZES,
  type PersonaRole,
  type PersonaSize,
  ROLLUP_COUNTS,
  type RollupCount,
  STAGES,
  type Stage,
  WARM_REASONS,
  type WarmReason,
} from "./people-map-schema.js";
import {
  type Key,
  keyOf,
  type ProfileKey,
  resolveProfile,
  setTraits,
  syncTraits,
} from "./profiles.js";

/** How each reason reads in the warmth line. */
export const REASON_WORDS: Readonly<Record<WarmReason, string>> = {
  subscribed: "subscribed",
  replied: "replied",
  booked: "booked",
  form: "sent a form",
  visited: "visited the site",
  watched: "watched a video",
  opened: "opened",
  clicked: "clicked",
  engaged: "engaged on our posts",
};

export const STAGE_WORDS: Readonly<Record<Stage, string>> = {
  stranger: "Stranger",
  lead: "Lead",
  replied: "Replied",
  booked: "Booked",
  client: "Client",
  past_client: "Past client",
};

/** A title's role, first match wins: an owner, then an executive, then a manager; else staff. */
export const ROLE_PATTERNS: readonly [Exclude<PersonaRole, "staff" | "unknown">, string][] = [
  [
    "owner",
    "\\y(owner|co-owner|founder|co-founder|ceo|chief executive|president|principal|proprietor|managing member|managing partner)\\y",
  ],
  [
    "executive",
    "\\y(chief|c[a-z]o|vp|svp|evp|vice president|managing director|partner|director|head of|general manager)\\y",
  ],
  ["manager", "\\y(manager|lead|supervisor)\\y"],
];
/** "Vice president" names a president; it's an executive. */
const NOT_OWNER = "\\y(vice|vp|svp|evp)\\y";

/** A title as a persona role, the same rule as the SQL. */
export function roleOf(title: string | null | undefined): PersonaRole {
  const t = title?.trim();
  if (!t) return "unknown";
  const re = (p: string) => new RegExp(p.replaceAll("\\y", "\\b"), "i");
  for (const [role, p] of ROLE_PATTERNS) {
    if (role === "owner" && re(NOT_OWNER).test(t)) continue;
    if (re(p).test(t)) return role;
  }
  return "staff";
}

/** A headcount as a size, the same buckets as the SQL. */
export function sizeOf(n: number | null | undefined): PersonaSize {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 1) return "unknown";
  return n === 1 ? "solo" : n < 10 ? "small" : n < 50 ? "mid" : "large";
}

/** `<niche> <role>`, or what's known of it; "unknown" when neither is. */
export const personaOf = (niche: string, role: PersonaRole) =>
  [niche === "unknown" ? null : niche, role === "unknown" ? null : role]
    .filter(Boolean)
    .join(" ") || "unknown";

/** Which profiles a read covers: every live one, or these. */
type Scope = readonly number[] | null;

const idList = (ids: readonly number[]) =>
  `{${ids.filter((n) => Number.isSafeInteger(n) && n > 0).join(",")}}`;
const inScope = (col: SQL, scope: Scope) =>
  scope ? sql`${col} = any(${idList(scope)}::int[])` : sql`true`;

/** A count's three columns, aggregated from the `ev` lines. */
const countCols = (r: RollupCount) =>
  sql.raw(`
  coalesce(sum(n) filter (where r = '${r}'), 0)::int ${r}_n,
  min(at) filter (where r = '${r}') ${r}_first,
  max(at) filter (where r = '${r}') ${r}_last`);

/** "Mon DD" of a column, UTC. */
const day = (col: string) => `to_char(${col} at time zone 'UTC', 'Mon FMDD')`;

/**
 * One row per live profile in scope, every `profile_rollups` column but `refreshed_at`.
 *
 * `ev` is every line that counts, as (profile, reason, channel, at, n, what): what they did toward
 * us (a reason in `WARM_REASONS`) and what we sent them (`contacted`). A site read is two lines,
 * its first (n = the count) and its last (n = 0), so sum, min and max come out right.
 */
export function rollupRows(scope: Scope): SQL {
  const counts = sql.join(
    ROLLUP_COUNTS.map((r) => countCols(r)),
    sql`, `,
  );
  const anyWarm = WARM_REASONS.map((r) => `a.${r}_n > 0`).join(" or ");
  const why = WARM_REASONS.map((r) => `case when a.${r}_n > 0 then '${r}' end`).join(", ");
  const line = WARM_REASONS.map(
    (r) =>
      `case when a.${r}_n > 0 then '${REASON_WORDS[r]}' || case when a.${r}_n > 1 then ' ' || a.${r}_n || 'x' else '' end || ', last ' || ${day(`a.${r}_last`)} end`,
  ).join(", ");
  const since = WARM_REASONS.map((r) => `a.${r}_first`).join(", ");
  const [ownerRe, execRe, managerRe] = ROLE_PATTERNS.map(([, p]) => p);
  return sql`
  with k as (
    select k.profile_id, k.kind, k.value, k.source, k.id, k.first_seen
    from profile_keys k
    join profiles p on p.id = k.profile_id and p.merged_into is null
    where ${inScope(sql`k.profile_id`, scope)}),
  ids as (select distinct profile_id from k),
  social as (
    select k.profile_id, h.platform, t.id, t.kind, t.direction, t.at, t.response, t.response_at,
      t.answers, t.text
    from k
    join social_handles h on k.kind = 'handle:' || h.platform and h.handle = k.value
    join touches t on t.handle_id = h.id
    where k.kind like 'handle:%'),
  ev as (
    select k.profile_id, 'replied' r, 'email' ch, t.received_at at, 1 n, 'Replied by email' what
    from k
    join enrollments e on lower(e.to_email) = k.value
    join thread_events t on t.enrollment_id = e.id
    where k.kind = 'email' and t.kind = 'reply'
    union all
    select k.profile_id, 'replied', 'sms', coalesce(s.received_at, s.created_at), 1, 'Texted back'
    from k
    join sms_contacts c on c.e164 = k.value
    join sms_messages s on s.contact_id = c.id
    where k.kind = 'phone' and s.direction = 'in'
    union all
    select x.profile_id, 'replied', 'chat', m.at, 1, 'Wrote in the site chat'
    from (
      select t.id, k.profile_id from k join chat_threads t on lower(t.email) = k.value
        where k.kind = 'email'
      union
      select t.id, k.profile_id from k
        join chat_threads t on k.value in (t.phone, '+' || t.phone, '+1' || t.phone)
        where k.kind = 'phone') x
    join chat_messages m on m.thread_id = x.id
    where m.direction = 'in'
    union all
    select s.profile_id,
      case when s.kind in ('reply', 'dm') or (s.kind = 'comment' and s.answers is not null)
        then 'replied' else 'engaged' end,
      s.platform, s.at, 1, 'They ' || s.kind || coalesce(': ' || s.text, '')
    from social s where s.direction = 'theirs'
    union all
    select s.profile_id, case when s.response = 'replied' then 'replied' else 'engaged' end,
      s.platform, s.response_at, 1, 'They ' || s.response || ' ours'
    from social s
    where s.direction = 'ours' and s.response in ('accepted', 'replied', 'liked')
      and s.response_at is not null
      and not exists (select 1 from social a where a.answers = s.id)
    union all
    select s.profile_id, 'contacted', s.platform, s.at, 1, 'We ' || s.kind
    from social s where s.direction = 'ours'
    union all
    select x.profile_id, 'form', 'site', e.at, 1,
      'Sent a form' || coalesce(' from ' || nullif(e.touch ->> 'source', ''), '')
    from (
      select e.id, k.profile_id from k join site_forms e on lower(e.fields ->> 'email') = k.value
        where k.kind = 'email'
      union
      select e.id, k.profile_id from k
        join site_forms e on k.value in (e.fields ->> 'phone',
          '+' || regexp_replace(e.fields ->> 'phone', '[^0-9]', '', 'g'),
          '+1' || regexp_replace(e.fields ->> 'phone', '[^0-9]', '', 'g'))
        where k.kind = 'phone'
      union
      select e.id, k.profile_id from k join site_forms e on e.visitor = k.value
        where k.kind = 'visitor') x
    join site_forms e on e.id = x.id
    left join site_form_defs f on f.id = e.form
    left join site_pages p on p.id = e.page
    where coalesce(f.client, p.client) is null
    union all
    select pe.profile_id,
      case pe.kind when 'form' then 'form' else 'contacted' end,
      pe.channel, pe.at, 1, pe.summary
    from profile_events pe
    where pe.profile_id in (select profile_id from ids)
      and (pe.kind = 'form' or (pe.kind = 'payment' and pe.summary not like 'Paid %'))
    union all
    select k.profile_id, 'booked', 'calendar', b.created_at, 1, 'Booked a call'
    from k join calendar.bookings b on lower(b.email) = k.value
    where k.kind = 'email' and b.state <> 'cancelled'
    union all
    select k.profile_id, 'booked', 'calendar', coalesce(cb.booked_at, cb.start), 1, 'Booked a call'
    from k join call_bookings cb on lower(cb.email) = k.value
    where k.kind = 'email' and cb.uid not like 'wren-%' and cb.state <> 'cancelled'
    union all
    select k.profile_id, 'subscribed', c.channel, coalesce(c.confirmed_at, c.created_at), 1,
      'Subscribed to ' || tp.public_name
    from k
    join consents c on c.address = k.value
      and c.channel = case k.kind when 'email' then 'email' when 'phone' then 'sms' end
    join topics tp on tp.id = c.topic_id
    where k.kind in ('email', 'phone') and c.state = 'confirmed'
    union all
    select k.profile_id, 'opened', 'email', o.seen_at, 1, 'Opened an email'
    from k
    join messages m on lower(m.to_email) = k.value
    join open_events o on o.message_id = m.id
    where k.kind = 'email' and m.sent_at is not null
      and o.seen_at >= m.sent_at + interval '2 minutes'
    union all
    select k.profile_id, 'clicked', 'email',
      case when c.first_at >= m.sent_at + interval '2 minutes' then c.first_at else c.last_at end,
      c.clicks, 'Clicked through to ' || c.url
    from k
    join messages m on lower(m.to_email) = k.value
    join email_clicks c on c.message_id = m.id
    where k.kind = 'email' and m.sent_at is not null
      and c.last_at >= m.sent_at + interval '2 minutes'
    union all
    select k.profile_id, 'contacted', 'email', m.sent_at, 1,
      'Emailed: ' || e.niche || ' / ' || replace(e.sequence_name, '_', ' ')
    from k
    join messages m on lower(m.to_email) = k.value
    join enrollments e on e.id = m.enrollment_id
    where k.kind = 'email' and m.sent_at is not null
    union all
    select k.profile_id, 'contacted', 'sms', s.sent_at, 1, 'Texted: ' || replace(s.kind, '_', ' ')
    from k
    join sms_contacts c on c.e164 = k.value
    join sms_messages s on s.contact_id = c.id
    where k.kind = 'phone' and s.direction = 'out' and s.sent_at is not null
    union all
    select k.profile_id, 'contacted', c.channel, ce.created_at, 1, 'Sent ' || tp.public_name
    from k
    join consents c on c.address = k.value
      and c.channel = case k.kind when 'email' then 'email' when 'phone' then 'sms' end
    join topics tp on tp.id = c.topic_id
    join consent_events ce on ce.consent_id = c.id
    where k.kind in ('email', 'phone') and ce.kind = 'sent'
    union all
    select k.profile_id, 'visited', 'site', k.first_seen, 1, 'Visited the site'
    from k
    where k.kind = 'visitor'
      and not exists (select 1 from profile_site_reads s where s.profile_id = k.profile_id)
    union all
    select s.profile_id, x.r, 'site', x.at, x.n, x.what
    from profile_site_reads s
    cross join lateral (values
      ('visited', s.visit_first, s.visits, 'Visited the site'),
      ('visited', s.visit_last, 0, 'Visited the site'),
      ('watched', s.watch_first, s.watches, 'Watched a video'),
      ('watched', s.watch_last, 0, 'Watched a video')) x(r, at, n, what)
    where s.profile_id in (select profile_id from ids) and x.at is not null),
  a as (
    select profile_id, ${counts},
      string_agg(distinct ch, ', ') filter (where r = 'replied') replied_channels,
      (array_agg(ch order by at desc) filter (where r = 'replied'))[1] replied_last_channel,
      min(at) first_touch_at, (array_agg(ch order by at))[1] first_channel,
      (array_agg(what order by at))[1] first_touch,
      max(at) last_touch_at, (array_agg(ch order by at desc))[1] last_channel,
      (array_agg(what order by at desc))[1] last_touch
    from ev where at is not null group by profile_id),
  subs as (
    select k.profile_id,
      string_agg(distinct tp.public_name || ' (' || c.channel || ', ' || c.state || ')', ', ')
        subscriptions
    from k
    join consents c on c.address = k.value
      and c.channel = case k.kind when 'email' then 'email' when 'phone' then 'sms' end
    join topics tp on tp.id = c.topic_id
    where k.kind in ('email', 'phone')
    group by k.profile_id),
  client as (
    select pe.profile_id, min(pe.at) at from profile_events pe
    where pe.profile_id in (select profile_id from ids)
      and pe.kind = 'payment' and pe.summary like 'Paid %'
    group by pe.profile_id
    union all
    select k.profile_id, min(m.invited_at) from k
    join client_members m on lower(m.email) = k.value
    join clients c on c.id = m.client_id and not c.demo and not c.sandbox
    where k.kind = 'email'
    group by k.profile_id),
  came as (
    select distinct on (k.profile_id) k.profile_id, k.source
    from k order by k.profile_id, k.first_seen, k.id),
  who as (
    select distinct on (k.profile_id) k.profile_id, pp.title, c.niche,
      case when jsonb_typeof(c.raw) = 'object' then nullif(regexp_replace(split_part(coalesce(
        nullif(c.raw ->> '5A', ''), nullif(c.raw ->> 'Company Size', ''),
        nullif(c.raw ->> 'agency.team_size', '')), '-', 1), '[^0-9]', '', 'g'), '') end headcount
    from k
    join people pp on pp.id = k.value::int
    join companies c on c.id = pp.company_id
    where k.kind = 'person' and k.value ~ '^[0-9]{1,9}$'
    order by k.profile_id, k.id),
  tr as (
    select t.profile_id,
      max(t.value #>> '{}') filter (where t.key = 'title') title,
      max(t.value #>> '{}') filter (where t.key = 'lifecycle') lifecycle,
      max(t.value #>> '{}') filter (where t.key = 'persona_role') role,
      max(t.value #>> '{}') filter (where t.key = 'persona_niche') niche,
      max(t.value #>> '{}') filter (where t.key = 'persona_size') size
    from profile_traits t
    where t.profile_id in (select profile_id from ids)
      and t.key in ('title', 'lifecycle', 'persona_role', 'persona_niche', 'persona_size')
    group by t.profile_id),
  per as (
    select i.profile_id, tr.lifecycle,
      coalesce(case when tr.role = any(${`{${PERSONA_ROLES.join(",")}}`}::text[]) then tr.role end,
        case
          when nullif(btrim(coalesce(w.title, tr.title)), '') is null then 'unknown'
          when coalesce(w.title, tr.title) ~* ${ownerRe as string}
            and coalesce(w.title, tr.title) !~* ${NOT_OWNER} then 'owner'
          when coalesce(w.title, tr.title) ~* ${execRe as string} then 'executive'
          when coalesce(w.title, tr.title) ~* ${managerRe as string} then 'manager'
          else 'staff' end) persona_role,
      left(coalesce(nullif(btrim(lower(tr.niche)), ''), w.niche, 'unknown'), 32) persona_niche,
      coalesce(case when tr.size = any(${`{${PERSONA_SIZES.join(",")}}`}::text[]) then tr.size end,
        case
          when w.headcount is null or length(w.headcount) > 9 or w.headcount::int < 1 then 'unknown'
          when w.headcount::int = 1 then 'solo'
          when w.headcount::int < 10 then 'small'
          when w.headcount::int < 50 then 'mid'
          else 'large' end) persona_size
    from ids i
    left join who w on w.profile_id = i.profile_id
    left join tr on tr.profile_id = i.profile_id),
  cl as (select profile_id, min(at) at from client group by profile_id)
  select i.profile_id,
    case
      when per.lifecycle = 'past_client' then 'past_client'
      when per.lifecycle = 'client' or cl.profile_id is not null then 'client'
      when coalesce(a.booked_n, 0) > 0 then 'booked'
      when coalesce(a.replied_n, 0) > 0 or coalesce(a.form_n, 0) > 0 then 'replied'
      when coalesce(a.contacted_n, 0) > 0 or ${sql.raw(anyWarm.replaceAll("a.", "coalesce(a.").replaceAll("_n > 0", "_n, 0) > 0"))} then 'lead'
      else 'stranger' end stage,
    case when ${sql.raw(anyWarm.replaceAll("a.", "coalesce(a.").replaceAll("_n > 0", "_n, 0) > 0"))}
        or cl.profile_id is not null or per.lifecycle in ('client', 'past_client')
      then 'warm' else 'cold' end warmth,
    coalesce(concat_ws(', ', ${sql.raw(why)}), '') why,
    nullif(concat_ws('; ',
      case when cl.profile_id is not null or per.lifecycle in ('client', 'past_client')
        then replace(coalesce(per.lifecycle, 'client'), '_', ' ') end,
      ${sql.raw(line)}), '') warmth_line,
    least(${sql.raw(since)}, cl.at) warm_since,
    ${sql.raw(
      ROLLUP_COUNTS.map((r) => `coalesce(a.${r}_n, 0) ${r}_n, a.${r}_first, a.${r}_last`).join(
        ",\n    ",
      ),
    )},
    subs.subscriptions, a.replied_channels, a.replied_last_channel,
    a.first_touch_at, a.first_channel, a.first_touch,
    a.last_touch_at, a.last_channel, a.last_touch,
    came.source came_from,
    left(concat_ws(' ', nullif(per.persona_niche, 'unknown'), nullif(per.persona_role, 'unknown')), 64)
      persona_raw,
    per.persona_role, per.persona_niche, per.persona_size
  from ids i
  left join a on a.profile_id = i.profile_id
  left join subs on subs.profile_id = i.profile_id
  left join cl on cl.profile_id = i.profile_id
  left join came on came.profile_id = i.profile_id
  left join per on per.profile_id = i.profile_id`;
}

/** Every `profile_rollups` column the refresh writes, in `rollupRows`' names. */
export const ROLLUP_COLUMNS = [
  "stage",
  "warmth",
  "why",
  "warmth_line",
  "warm_since",
  ...ROLLUP_COUNTS.flatMap((r) => [`${r}_n`, `${r}_first`, `${r}_last`]),
  "subscriptions",
  "replied_channels",
  "replied_last_channel",
  "first_touch_at",
  "first_channel",
  "first_touch",
  "last_touch_at",
  "last_channel",
  "last_touch",
  "came_from",
  "persona",
  "persona_role",
  "persona_niche",
  "persona_size",
] as const;

/** `rollupRows` as the table's columns: `persona_raw` named and defaulted. */
const asRows = (scope: Scope) => sql`
  select profile_id, ${sql.raw(
    ROLLUP_COLUMNS.map((c) =>
      c === "persona" ? `coalesce(nullif(persona_raw, ''), 'unknown') persona` : c,
    ).join(", "),
  )}
  from (${rollupRows(scope)}) r`;

export interface RefreshCount {
  /** Rows written: new or changed. */
  written: number;
  /** Rows dropped: their profile merged into another. */
  dropped: number;
  /** `stage` and `warmth` traits changed. */
  traits: number;
}

/**
 * The map rebuilt for every live profile, or these: changed rows written, merged profiles'
 * rows dropped, `stage` and `warmth` mirrored as traits (only when not the default).
 */
export async function refreshPeople(
  db: Queryable,
  o: { ids?: readonly number[] } = {},
): Promise<RefreshCount> {
  const scope: Scope = o.ids ?? null;
  if (scope && !scope.length) return { written: 0, dropped: 0, traits: 0 };
  const cols = ["profile_id", ...ROLLUP_COLUMNS].join(", ");
  const set = ROLLUP_COLUMNS.map((c) => `${c} = excluded.${c}`).join(", ");
  const old = ROLLUP_COLUMNS.map((c) => `profile_rollups.${c}`).join(", ");
  const neu = ROLLUP_COLUMNS.map((c) => `excluded.${c}`).join(", ");
  return atomic(db, async (tx) => {
    const [w] = (await tx.execute(sql`
      with up as (
        insert into profile_rollups (${sql.raw(cols)})
        ${asRows(scope)}
        on conflict (profile_id) do update set ${sql.raw(set)}, refreshed_at = now()
        where (${sql.raw(old)}) is distinct from (${sql.raw(neu)})
        returning 1)
      select count(*)::int n from up`)) as unknown as { n: number }[];
    const [d] = (await tx.execute(sql`
      with gone as (
        delete from profile_rollups r
        where ${inScope(sql`r.profile_id`, scope)}
          and not exists (select 1 from profiles p where p.id = r.profile_id and p.merged_into is null)
        returning 1)
      select count(*)::int n from gone`)) as unknown as { n: number }[];
    const traits = await syncTraits(
      tx,
      sql`select profile_id, 'stage' key, stage v from profile_rollups r
        where ${inScope(sql`r.profile_id`, scope)}
        union all
        select profile_id, 'warmth', warmth from profile_rollups r
        where ${inScope(sql`r.profile_id`, scope)}`,
      "people_map",
      { stage: "stranger", warmth: "cold" },
    );
    return { written: Number(w?.n ?? 0), dropped: Number(d?.n ?? 0), traits };
  });
}

/** One profile's map, as `rollupRows` returns it. */
export interface Rollup {
  profileId: number;
  stage: Stage;
  warmth: "warm" | "cold";
  why: WarmReason[];
  warmthLine: string | null;
  warmSince: string | null;
  counts: Record<RollupCount, { n: number; first: string | null; last: string | null }>;
  subscriptions: string | null;
  repliedChannels: string | null;
  repliedLastChannel: string | null;
  firstTouch: { at: string; channel: string | null; what: string | null } | null;
  lastTouch: { at: string; channel: string | null; what: string | null } | null;
  cameFrom: string | null;
  persona: string;
  personaRole: PersonaRole;
  personaNiche: string;
  personaSize: PersonaSize;
}

/** A timestamp as ISO; raw `execute` rows carry Postgres's text form. */
const iso = (v: unknown) => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
};

/** A `rollupRows` or `profile_rollups` row as a `Rollup`. */
export function rollupOf(r: Record<string, unknown>): Rollup {
  const counts = Object.fromEntries(
    ROLLUP_COUNTS.map((c) => [
      c,
      { n: Number(r[`${c}_n`] ?? 0), first: iso(r[`${c}_first`]), last: iso(r[`${c}_last`]) },
    ]),
  ) as Rollup["counts"];
  const touch = (p: "first" | "last") =>
    r[`${p}_touch_at`]
      ? {
          at: iso(r[`${p}_touch_at`]) as string,
          channel: (r[`${p}_channel`] as string | null) ?? null,
          what: (r[`${p}_touch`] as string | null) ?? null,
        }
      : null;
  const persona = (r.persona ?? r.persona_raw) as string | null;
  return {
    profileId: Number(r.profile_id),
    stage: r.stage as Stage,
    warmth: r.warmth as "warm" | "cold",
    why: String(r.why ?? "")
      .split(", ")
      .filter(Boolean) as WarmReason[],
    warmthLine: (r.warmth_line as string | null) ?? null,
    warmSince: iso(r.warm_since),
    counts,
    subscriptions: (r.subscriptions as string | null) ?? null,
    repliedChannels: (r.replied_channels as string | null) ?? null,
    repliedLastChannel: (r.replied_last_channel as string | null) ?? null,
    firstTouch: touch("first"),
    lastTouch: touch("last"),
    cameFrom: (r.came_from as string | null) ?? null,
    persona: persona || "unknown",
    personaRole: r.persona_role as PersonaRole,
    personaNiche: String(r.persona_niche),
    personaSize: r.persona_size as PersonaSize,
  };
}

/** These profiles' maps computed now from the sources, never the stored rows. */
export async function warmthOf(db: Queryable, ids: readonly number[]): Promise<Rollup[]> {
  if (!ids.length) return [];
  const rows = (await db.execute(rollupRows(ids))) as unknown as Record<string, unknown>[];
  return rows.map(rollupOf);
}

/** The stored map of one profile, or null before its first refresh. */
export async function storedRollup(db: Queryable, id: number): Promise<Rollup | null> {
  const [r] = (await db.execute(
    sql`select * from profile_rollups where profile_id = ${id}`,
  )) as unknown as Record<string, unknown>[];
  return r ? rollupOf(r) : null;
}

/** Who a cold opener would go to: the person row and their addresses, as a sender holds them. */
export interface Recipient {
  personId?: number | null;
  keys?: readonly ProfileKey[];
}

/** The live profiles these addresses and person row are. */
export async function profilesOf(db: Queryable, who: Recipient): Promise<number[]> {
  const keys: Key[] = [
    ...(who.keys ?? []),
    ...(who.personId ? [{ kind: "person", value: who.personId }] : []),
  ]
    .map(keyOf)
    .filter((k): k is Key => k !== null);
  if (!keys.length) return [];
  const rows = (await db.execute(sql`
    select distinct coalesce(p.merged_into, p.id) id from profile_keys k
    join profiles p on p.id = k.profile_id
    where (k.kind, k.value) in (${sql.join(
      keys.map((k) => sql`(${k.kind}, ${k.value})`),
      sql`, `,
    )})`)) as unknown as { id: number }[];
  return rows.map((r) => Number(r.id));
}

/**
 * The one rule before any cold opener: a warm person never gets one. Null when everyone these
 * keys name is cold (or unknown); else why, as a refusal: "warm: replied 2x, last Oct 3".
 * Read live from the sources, so it's right at send time, not as of the last refresh.
 */
export async function coldOpenerRefusal(db: Queryable, who: Recipient): Promise<string | null> {
  const ids = await profilesOf(db, who);
  if (!ids.length) return null;
  const warm = (await warmthOf(db, ids)).find((r) => r.warmth === "warm");
  return warm
    ? `warm (profile ${warm.profileId}): ${warm.warmthLine ?? warm.why.join(", ")}; no cold opener`
    : null;
}

/** A social handle we touched or that touched us, with the person row it's linked to. */
interface LooseHandle {
  platform: string;
  handle: string;
  person_id: number | null;
}

/**
 * Every handle we touched or that touched us gets a `handle:<platform>` key: `social_handles`,
 * comment authors, answered Reddit threads, posts we commented on, DM contacts. Those keyed
 * already are skipped; the rest go through `resolveProfile`, with their person row when linked.
 */
export async function keyLooseHandles(db: Queryable): Promise<{ seen: number; keyed: number }> {
  const rows = (await db.execute(sql`
    select platform, handle, person_id from social_handles
    union select platform, author, null from comments
      where author is not null and coalesce(sort, '') <> 'ours'
    union select 'reddit', author, null from reddit_threads
      where answered_at is not null and author is not null
    union select platform, coalesce(handle, author), null from reach_posts
      where commented_at is not null and coalesce(handle, author) is not null
    union select platform, handle, person_id from reach_contacts`)) as unknown as LooseHandle[];
  const want = new Map<string, { key: Key; person: number | null }>();
  for (const r of rows) {
    const key = keyOf({ kind: `handle:${r.platform}`, value: r.handle });
    if (!key) continue;
    const id = `${key.kind}\u0000${key.value}`;
    const had = want.get(id);
    if (!had || (had.person === null && r.person_id !== null))
      want.set(id, { key, person: r.person_id === null ? null : Number(r.person_id) });
  }
  const all = [...want.values()];
  let keyed = 0;
  for (let i = 0; i < all.length; i += 500) {
    const chunk = all.slice(i, i + 500);
    const have = new Set(
      (
        (await db.execute(sql`
        select kind, value from profile_keys where (kind, value) in (${sql.join(
          chunk.map((c) => sql`(${c.key.kind}, ${c.key.value})`),
          sql`, `,
        )})`)) as unknown as { kind: string; value: string }[]
      ).map((k) => `${k.kind}\u0000${k.value}`),
    );
    for (const c of chunk) {
      if (have.has(`${c.key.kind}\u0000${c.key.value}`)) continue;
      const got = await resolveProfile(
        db,
        [c.key, ...(c.person ? [{ kind: "person", value: c.person }] : [])],
        "social_handle",
      );
      if (got) keyed += 1;
    }
  }
  return { seen: all.length, keyed };
}

/** A visitor's site log, counted: page views, watch-page views, first and last of each. */
export interface SiteCounts {
  visits: number;
  visitFirst: Date | null;
  visitLast: Date | null;
  watches: number;
  watchFirst: Date | null;
  watchLast: Date | null;
}

/** Counts a profile's site log by its visitor keys; null when the read failed. */
export type SiteCountReader = (visitors: readonly string[]) => Promise<SiteCounts | null>;

/** Profiles whose site counts are read in one pass, the longest unread first. */
export const SITE_READS_MOST = 200;

/** Site counts read for the profiles with a `visitor` key, the longest unread first. */
export async function readSiteCounts(
  db: Queryable,
  read: SiteCountReader,
  o: { most?: number; now?: Date } = {},
): Promise<number> {
  const rows = (await db.execute(sql`
    select k.profile_id, array_agg(k.value order by k.first_seen desc) visitors
    from profile_keys k
    join profiles p on p.id = k.profile_id and p.merged_into is null
    left join profile_site_reads s on s.profile_id = k.profile_id
    where k.kind = 'visitor'
    group by k.profile_id, s.read_at
    order by s.read_at nulls first, k.profile_id
    limit ${o.most ?? SITE_READS_MOST}`)) as unknown as {
    profile_id: number;
    visitors: string[];
  }[];
  const now = (o.now ?? new Date()).toISOString();
  let n = 0;
  for (const r of rows) {
    const c = await read(r.visitors.slice(0, 5));
    if (!c) continue;
    const t = (d: Date | null) => d?.toISOString() ?? null;
    await db.execute(sql`
      insert into profile_site_reads
        (profile_id, visits, visit_first, visit_last, watches, watch_first, watch_last, read_at)
      values (${Number(r.profile_id)}, ${c.visits}, ${t(c.visitFirst)}, ${t(c.visitLast)},
        ${c.watches}, ${t(c.watchFirst)}, ${t(c.watchLast)}, ${now})
      on conflict (profile_id) do update set visits = excluded.visits,
        visit_first = excluded.visit_first, visit_last = excluded.visit_last,
        watches = excluded.watches, watch_first = excluded.watch_first,
        watch_last = excluded.watch_last, read_at = excluded.read_at`);
    n += 1;
  }
  return n;
}

/** Is this page a watch page: a demo video (`/v/<id>`) or an offer's video (`/watch/<offer>`)? */
export const isWatchPage = (page: string) => /^\/(v|watch)\//.test(page);

/** A list of hits counted: every page, and the watch pages apart. */
export function countHits(hits: readonly { ts: string | number; page: string }[]): SiteCounts {
  const out: SiteCounts = {
    visits: 0,
    visitFirst: null,
    visitLast: null,
    watches: 0,
    watchFirst: null,
    watchLast: null,
  };
  const min = (a: Date | null, b: Date) => (a && a <= b ? a : b);
  const max = (a: Date | null, b: Date) => (a && a >= b ? a : b);
  for (const h of hits) {
    const at = new Date(h.ts);
    if (Number.isNaN(at.getTime())) continue;
    out.visits += 1;
    out.visitFirst = min(out.visitFirst, at);
    out.visitLast = max(out.visitLast, at);
    if (isWatchPage(h.page)) {
      out.watches += 1;
      out.watchFirst = min(out.watchFirst, at);
      out.watchLast = max(out.watchLast, at);
    }
  }
  return out;
}

/** A `SiteCountReader` over a one-visitor hits read; a failed read is null, never a throw. */
export function siteCountReader(
  hits: (visitor: string) => Promise<readonly { ts: string | number; page: string }[]>,
): SiteCountReader {
  return async (visitors) => {
    try {
      const all = (await Promise.all(visitors.map((v) => hits(v)))).flat();
      return countHits(all);
    } catch (err) {
      console.warn(`people map site read: ${(err as Error).message}`);
      return null;
    }
  };
}

/** A model asked for a persona from what's known; null fields it couldn't tell. */
export type PersonaModel = (facts: {
  title: string | null;
  company: string | null;
  headline: string | null;
}) => Promise<{ role: PersonaRole | null; niche: string | null; size: PersonaSize | null }>;

/**
 * The LLM hook: profiles whose role the rule left unknown but that carry some words (a title
 * trait, a company trait, a DM contact's headline) are asked of `model`, and what it tells is
 * written as `persona_*` traits, which the next refresh prefers. Never run by a pass.
 */
export async function fillPersonas(
  db: Queryable,
  model: PersonaModel,
  o: { limit?: number; dryRun?: boolean } = {},
): Promise<{ asked: number; set: number }> {
  const rows = (await db.execute(sql`
    select r.profile_id,
      (select t.value #>> '{}' from profile_traits t
        where t.profile_id = r.profile_id and t.key = 'title') title,
      (select t.value #>> '{}' from profile_traits t
        where t.profile_id = r.profile_id and t.key = 'company') company,
      (select c.headline from profile_keys k
        join reach_contacts c on k.kind = 'handle:' || c.platform and lower(c.handle) = k.value
        where k.profile_id = r.profile_id and c.headline is not null limit 1) headline
    from profile_rollups r
    where r.persona_role = 'unknown'
      and not exists (select 1 from profile_traits t
        where t.profile_id = r.profile_id and t.key = 'persona_role')
    order by r.profile_id
    limit ${o.limit ?? 50}`)) as unknown as {
    profile_id: number;
    title: string | null;
    company: string | null;
    headline: string | null;
  }[];
  const asked = rows.filter((r) => r.title || r.company || r.headline);
  let set = 0;
  for (const r of asked) {
    const got = await model({ title: r.title, company: r.company, headline: r.headline });
    const traits: Record<string, string> = {};
    if (got.role && (PERSONA_ROLES as readonly string[]).includes(got.role))
      traits.persona_role = got.role;
    if (got.size && (PERSONA_SIZES as readonly string[]).includes(got.size))
      traits.persona_size = got.size;
    if (got.niche && /^[a-z][a-z0-9_]{0,31}$/.test(got.niche)) traits.persona_niche = got.niche;
    if (!Object.keys(traits).length) continue;
    if (!o.dryRun) {
      await setTraits(db, Number(r.profile_id), traits, "persona_llm");
    }
    set += 1;
  }
  return { asked: asked.length, set };
}

/** Sequences whose opener is written to someone who knows us: the warm gate lets them through. */
export const WARM_SEQUENCES: ReadonlySet<string> = new Set(["reactivation"]);

/**
 * The live profile a person is named by: a profile id (`#12` or `12`), an email, a phone, or
 * `<platform>:<handle>`. Null when none matches.
 */
export async function findProfile(db: Queryable, who: string): Promise<number | null> {
  const s = who.trim();
  const id = /^#?([1-9][0-9]{0,9})$/.exec(s)?.[1];
  if (id) {
    const [p] = (await db.execute(
      sql`select coalesce(merged_into, id) id from profiles where id = ${Number(id)}`,
    )) as unknown as { id: number }[];
    return p ? Number(p.id) : null;
  }
  const handle = /^([a-z]+):(.+)$/.exec(s);
  const key: ProfileKey = s.includes("@")
    ? { kind: "email", value: s }
    : handle
      ? { kind: `handle:${handle[1]}`, value: handle[2] }
      : { kind: "phone", value: s };
  return (await profilesOf(db, { keys: [key] }))[0] ?? null;
}

/** What `listPeople` narrows and orders by: each a plain column of `profile_rollups`. */
export interface PeopleFilter {
  stage?: Stage;
  warmth?: "warm" | "cold";
  /** A persona role or size, or a niche, or a whole persona ("agencies owner"). */
  persona?: string;
  /** A warm reason they have. */
  reason?: WarmReason;
  /** Any consent (true), or a topic named in one. */
  subscribed?: boolean | string;
  /** Replied at least once. */
  replied?: boolean;
  /** Where they came from (`came_from`) or the channel of their first touch. */
  source?: string;
  sort?: "last" | "warm" | "replied" | "id";
  limit?: number;
}

export interface PersonRow {
  profileId: number;
  name: string;
  stage: Stage;
  warmth: "warm" | "cold";
  warmthLine: string | null;
  persona: string;
  personaSize: PersonaSize;
  cameFrom: string | null;
  lastTouchAt: string | null;
}

/** People from the stored map, filtered and ordered; latest touch first by default. */
export async function listPeople(db: Queryable, f: PeopleFilter = {}): Promise<PersonRow[]> {
  const where: SQL[] = [sql`true`];
  if (f.stage) where.push(sql`r.stage = ${f.stage}`);
  if (f.warmth) where.push(sql`r.warmth = ${f.warmth}`);
  if (f.persona)
    where.push(sql`${f.persona.toLowerCase()} in (r.persona, r.persona_role, r.persona_size,
      r.persona_niche)`);
  if (f.reason) where.push(sql`${f.reason} = any(string_to_array(r.why, ', '))`);
  if (f.subscribed === true) where.push(sql`r.subscriptions is not null`);
  if (typeof f.subscribed === "string")
    where.push(sql`r.subscriptions ilike ${`%${f.subscribed.replace(/[%_\\]/g, "\\$&")}%`}`);
  if (f.replied) where.push(sql`r.replied_n > 0`);
  if (f.source) where.push(sql`${f.source} in (r.came_from, r.first_channel)`);
  const order = {
    last: sql`r.last_touch_at desc nulls last, r.profile_id`,
    warm: sql`r.warm_since desc nulls last, r.profile_id`,
    replied: sql`r.replied_last desc nulls last, r.profile_id`,
    id: sql`r.profile_id`,
  }[f.sort ?? "last"];
  const rows = (await db.execute(sql`
    select r.profile_id, coalesce(p.name, (select k.value from profile_keys k
        where k.profile_id = p.id order by k.kind <> 'email', k.kind <> 'phone', k.id limit 1),
        '#' || p.id) name,
      r.stage, r.warmth, r.warmth_line, r.persona, r.persona_size, r.came_from, r.last_touch_at
    from profile_rollups r join profiles p on p.id = r.profile_id and p.merged_into is null
    where ${sql.join(where, sql` and `)}
    order by ${order}
    limit ${Math.min(Math.max(f.limit ?? 50, 1), 5000)}`)) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    profileId: Number(r.profile_id),
    name: String(r.name),
    stage: r.stage as Stage,
    warmth: r.warmth as "warm" | "cold",
    warmthLine: (r.warmth_line as string | null) ?? null,
    persona: String(r.persona),
    personaSize: r.persona_size as PersonaSize,
    cameFrom: (r.came_from as string | null) ?? null,
    lastTouchAt: iso(r.last_touch_at),
  }));
}

/** Counts of the stored map by stage and warmth: the CLI's and the agent's one-glance view. */
export async function peopleCounts(
  db: Queryable,
): Promise<{ stage: Stage; warmth: string; n: number }[]> {
  const rows = (await db.execute(sql`
    select stage, warmth, count(*)::int n from profile_rollups group by 1, 2
    order by array_position(${`{${STAGES.join(",")}}`}::text[], stage::text), 2`)) as unknown as {
    stage: Stage;
    warmth: string;
    n: number;
  }[];
  return rows.map((r) => ({ ...r, n: Number(r.n) }));
}
