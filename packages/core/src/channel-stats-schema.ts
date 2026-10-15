/**
 * Channel stats (designs/2026-10-15-channel-stats.md): each person's funnel steps on each channel
 * and source, read live from the rows that already hold them, never copied. `profile_steps` is
 * one row per person, channel, source and step: reached, saw, engaged, replied, then booked and
 * paid (no channel: `./channel-stats.ts` attributes them at read time). Sends and a text's cost
 * ride on its reached row.
 *
 * - The sent log (`sent_records`): reached once it went (not bounced or failed); saw on an open;
 *   engaged on a click; replied on a reply. The ladder holds: a reply counts as seen and engaged.
 * - Social touches: ours reached them, and their answer (accepted, liked, replied) moves them on;
 *   theirs (a like, a comment, a follow, a DM) reached, saw and engaged, and a reply or DM replied.
 * - Wren's site forms, by email or the `wv` visitor: the `/go/` source that brought them (YouTube,
 *   LinkedIn, ...), else referral when a referrer came along, else the site. A form is a hand raised.
 * - A `source` or `channel` trait naming a channel: reached there at the trait's time (referral).
 * - Bookings not cancelled, and payments made, from the timeline.
 *
 * Pure constants up top: the portal reads them.
 */
import { sql } from "drizzle-orm";
import { doublePrecision, integer, pgView, text, timestamp } from "drizzle-orm/pg-core";

/** A funnel's steps, in order. */
export const FUNNEL_STEPS = ["reached", "saw", "engaged", "replied", "booked", "paid"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];
export const FUNNEL_STEP_NAMES: Readonly<Record<FunnelStep, string>> = {
  reached: "Reached",
  saw: "Saw",
  engaged: "Engaged",
  replied: "Replied",
  booked: "Booked",
  paid: "Paid",
};

/** The channels a person is reached on, as `profile_steps.channel` names them. */
export const STAT_CHANNELS = [
  "email",
  "sms",
  "linkedin",
  "x",
  "reddit",
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "threads",
  "newsletter",
  "site",
  "referral",
  "search",
  "ads",
] as const;
export type StatChannel = (typeof STAT_CHANNELS)[number];
export const STAT_CHANNEL_NAMES: Readonly<Record<StatChannel, string>> = {
  email: "Email",
  sms: "Texts",
  linkedin: "LinkedIn",
  x: "X",
  reddit: "Reddit",
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  newsletter: "Newsletter",
  site: "Site",
  referral: "Referral",
  search: "Search",
  ads: "Ads",
};

/**
 * What each channel can prove. A text or a newsletter has no open, so "saw" there is a dash, not
 * a zero; the rest prove every step through replies, touches or forms.
 */
export function provesOf(channel: string): readonly FunnelStep[] {
  if (channel === "sms") return ["reached", "replied", "booked", "paid"];
  if (channel === "newsletter") return ["reached", "booked", "paid"];
  return FUNNEL_STEPS;
}

const IN = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");

/** A `/go/` source, a form's `touch.source`, as a channel. */
const SOURCE_CHANNEL = (col: string) => `case
    when ${col} in (${IN(["youtube", "linkedin", "instagram", "tiktok", "x", "reddit", "facebook", "threads", "sms"])}) then ${col}
    when ${col} in ('twitter') then 'x'
    when ${col} in ('meta') then 'ads'
    when ${col} in ('recruiting', 'email') then 'email'
    when ${col} in ('google', 'bing', 'duckduckgo', 'yahoo', 'ecosia', 'brave') then 'search'
    else null end`;

export const profileSteps = pgView("profile_steps", {
  profileId: integer("profile_id"),
  channel: text("channel"),
  sourceKind: text("source_kind"),
  source: text("source"),
  step: text("step"),
  at: timestamp("at", { withTimezone: true }),
  ref: text("ref"),
  costUsd: doublePrecision("cost_usd"),
  sends: integer("sends"),
}).as(sql`
  select k.profile_id,
    case when s.kind = 'newsletter' or (s.kind = 'broadcast' and s.channel = 'email')
      then 'newsletter' else s.channel end channel,
    case when s.broadcast is not null then 'broadcast'
      when s.kind = 'newsletter' then 'list'
      when s.kind = 'comment' and s.channel = 'reddit' then 'thread'
      when s.kind = 'comment' then 'post'
      else 'campaign' end source_kind,
    coalesce(s.campaign, '') source, st.step, s.at, s.id ref,
    case when st.step = 'reached' then m.cost_usd end cost_usd,
    case when st.step = 'reached' then 1 else 0 end sends
  from sent_records s
  join profile_keys k on k.kind = s.key_kind and k.value = s.key_value
  left join sms_messages m
    on m.id = case when s.id ~ '^sms:[0-9]+$' then substr(s.id, 5)::int end
  cross join lateral (values ('reached'), ('saw'), ('engaged'), ('replied')) st(step)
  where s.state in ('sent', 'delivered', 'opened', 'clicked', 'replied')
    and (st.step = 'reached'
      or (st.step = 'saw' and s.state in ('opened', 'clicked', 'replied'))
      or (st.step = 'engaged' and s.state in ('clicked', 'replied'))
      or (st.step = 'replied' and s.state = 'replied'))
  union all
  select k.profile_id, h.platform,
    case when t.kind = 'dm' then 'thread' when t.kind in ('follow', 'connect') then 'profile'
      else 'post' end,
    coalesce(t.url, ''), st.step,
    case when st.step = 'reached' or t.direction = 'theirs' then t.at
      else coalesce(t.response_at, t.at) end,
    'touch:' || t.id, null::float8, 0
  from touches t
  join social_handles h on h.id = t.handle_id
  join profile_keys k on k.kind = 'handle:' || h.platform and k.value = h.handle
  cross join lateral (values ('reached'), ('saw'), ('engaged'), ('replied')) st(step)
  where st.step = 'reached'
    or (t.direction = 'theirs' and (st.step in ('saw', 'engaged')
      or (st.step = 'replied' and t.kind in ('reply', 'dm'))))
    or (t.direction = 'ours' and (
      (st.step in ('saw', 'engaged') and t.response in ('accepted', 'liked', 'replied'))
      or (st.step = 'replied' and t.response = 'replied')))
  union all
  select hit.profile_id,
    coalesce(${sql.raw(SOURCE_CHANNEL("lower(e.touch ->> 'source')"))},
      case when coalesce(e.touch ->> 'ref', '') <> '' then 'referral' else 'site' end),
    'link',
    concat_ws('/', nullif(e.touch ->> 'campaign', ''), nullif(e.touch ->> 'content', '')),
    st.step, e.at, 'site_form:' || e.id, null::float8, 0
  from (
    select e.id, k.profile_id from profile_keys k
      join site_forms e on lower(e.fields ->> 'email') = k.value where k.kind = 'email'
    union
    select e.id, k.profile_id from profile_keys k
      join site_forms e on e.visitor = k.value where k.kind = 'visitor'
  ) hit
  join site_forms e on e.id = hit.id
  left join site_form_defs f on f.id = e.form
  left join site_pages p on p.id = e.page
  cross join lateral (values ('reached'), ('saw'), ('engaged'), ('replied')) st(step)
  where coalesce(f.client, p.client) is null
  union all
  select t.profile_id, lower(t.value #>> '{}'), 'trait', t.key, 'reached', t.at,
    'trait:' || t.profile_id || ':' || t.key, null::float8, 0
  from profile_traits t
  where t.key in ('source', 'channel')
    and lower(t.value #>> '{}') in (${sql.raw(IN(STAT_CHANNELS))})
  union all
  select l.profile_id, null, 'outcome', '', 'booked', l.at, l.id, null::float8, 0
  from profile_timeline l
  where l.kind = 'booking' and l.summary not like 'Cancelled%'
  union all
  select l.profile_id, null, 'outcome', '', 'paid', l.at, l.id, null::float8, 0
  from profile_timeline l
  where l.kind = 'payment' and l.summary like 'Paid %'`);
