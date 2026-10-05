/**
 * The SQL views behind the opt-in marketing records (`./marketing-records.ts`): a subscriber is
 * one address on one channel, across its topics; its activity is every consent change with its
 * proof, plus the suppressions on the address.
 */
import { sql } from "drizzle-orm";
import { bigint, pgView, text, timestamp } from "drizzle-orm/pg-core";

/** "Oct 12": a date as the "Can send" line says it. */
const DAY = (col: string) => sql.raw(`to_char(${col} at time zone 'UTC', 'Mon FMDD')`);
const SOURCE = sql.raw(`case s.source when 'lander_form' then 'lander form'
    when 'meta_lead_form' then 'Meta lead form' when 'sms_keyword' then 'text keyword'
    when 'calcom_booking' then 'cal.com booking' else 'preference center' end`);

export const marketingSubscriberRecords = pgView("marketing_subscriber_records", {
  id: text("id"),
  address: text("address"),
  channel: text("channel"),
  topics: text("topics"),
  state: text("state"),
  source: text("source"),
  canSend: text("can_send"),
  since: timestamp("since", { withTimezone: true }),
  lastSent: timestamp("last_sent", { withTimezone: true }),
  frequency: text("frequency"),
  actor: text("actor"),
}).as(sql`
  with s as (
    select c.channel, c.address,
      string_agg(t.public_name, ', ' order by t.public_name) filter (where c.state = 'confirmed') topics,
      bool_or(c.state = 'confirmed') confirmed,
      bool_or(c.state = 'pending' and c.pending_at > now() - interval '7 days') pending,
      bool_or(c.state = 'pending') ever_pending,
      max(c.paused_until) paused_until,
      max(c.frequency) frequency,
      min(c.confirmed_at) confirmed_at,
      min(coalesce(c.confirmed_at, c.pending_at, c.created_at)) since,
      max(c.last_sent_at) last_sent,
      (array_agg(c.source order by c.created_at))[1] source
    from consents c join topics t on t.id = c.topic_id
    group by c.channel, c.address)
  select s.channel || ':' || s.address id, s.address, s.channel, s.topics,
    case when off.at is not null then 'off'
      when s.confirmed and s.paused_until > now() then 'paused'
      when s.confirmed then 'confirmed'
      when s.pending then 'pending'
      when s.ever_pending then 'lapsed'
      else 'withdrawn' end state,
    s.source,
    case when off.at is not null then 'Can''t send: unsubscribed from everything on ' || ${DAY("off.at")}
      when s.confirmed and s.paused_until > now() then 'Can''t send: paused until ' || ${DAY("s.paused_until")}
      when s.confirmed then 'Can send: confirmed for ' || s.topics || ' on ' || ${DAY("s.confirmed_at")} || ' by ' || ${SOURCE}
      when s.pending then 'Can''t send yet: waiting on the confirm click'
      when s.ever_pending then 'Can''t send: never confirmed'
      else 'Can''t send: off every topic' end can_send,
    s.since, s.last_sent, s.frequency, last.by actor
  from s
  left join lateral (
    select max(e.created_at) at from suppressions x join suppression_events e on e.suppression_id = x.id
    where x.kind = case s.channel when 'email' then 'email' else 'phone' end
      and x.value = s.address and x.revoked_at is null) off on true
  left join lateral (
    select e.by from consent_events e join consents c on c.id = e.consent_id
    where c.channel = s.channel and c.address = s.address and e.kind <> 'sent'
    order by e.id desc limit 1) last on true`);

/** Every consent change and suppression on a subscriber, with who did it and the proof. */
export const marketingSubscriberActivity = pgView("marketing_subscriber_activity", {
  subscriber: text("subscriber"),
  at: timestamp("at", { withTimezone: true }),
  kind: text("kind"),
  what: text("what"),
}).as(sql`
  select c.channel || ':' || c.address subscriber, e.created_at at, e.kind,
    case e.kind when 'pending' then 'Signed up for ' || t.public_name
      when 'confirmed' then 'Confirmed ' || t.public_name
      when 'withdrawn' then 'Left ' || t.public_name
      when 'frequency' then 'How often: ' || replace(e.evidence ->> 'frequency', '_', ' ')
      when 'paused' then coalesce('Paused until ' || left(e.evidence ->> 'pausedUntil', 10), 'Pause ended')
      else 'Sent ' || t.public_name end
    || ', by ' || e.by
    || coalesce(' · ' || (select string_agg(k || ' ' || v, ', ') from jsonb_each_text(
      case when jsonb_typeof(e.evidence) = 'object' and e.kind not in ('frequency', 'paused')
        then e.evidence end) as p(k, v)), '') what
  from consent_events e join consents c on c.id = e.consent_id join topics t on t.id = c.topic_id
  union all
  select case x.kind when 'email' then 'email' else 'sms' end || ':' || x.value, e.created_at,
    'suppression',
    case e.reason when 'lifted' then 'Back on: opt-out lifted'
      when 'opt_out' then 'Unsubscribed from everything'
      else 'Suppressed: ' || e.reason end
    || coalesce(' · ' || (select string_agg(k || ' ' || v, ', ') from jsonb_each_text(
      case when jsonb_typeof(e.evidence) = 'object' then e.evidence end) as p(k, v)), '')
  from suppression_events e join suppressions x on x.id = e.suppression_id
  where x.kind in ('email', 'phone')`);

export const marketingTopicRecords = pgView("marketing_topic_records", {
  id: text("id"),
  publicName: text("public_name"),
  channel: text("channel"),
  cadence: text("cadence"),
  shown: text("shown"),
  confirmed: bigint("confirmed", { mode: "number" }),
  netWeek: bigint("net_week", { mode: "number" }),
  confirms: bigint("confirms", { mode: "number" }),
  signups: bigint("signups", { mode: "number" }),
  leaves: bigint("leaves", { mode: "number" }),
  sends: bigint("sends", { mode: "number" }),
  lastSent: timestamp("last_sent", { withTimezone: true }),
}).as(sql`
  select t.name id, t.public_name, t.channel, t.cadence,
    case when t.public then 'shown' else 'hidden' end shown,
    (select count(*) from consents c where c.topic_id = t.id and c.state = 'confirmed') confirmed,
    coalesce(e.net_week, 0)::bigint net_week, coalesce(e.confirms, 0)::bigint confirms,
    coalesce(e.signups, 0)::bigint signups, coalesce(e.leaves, 0)::bigint leaves,
    coalesce(e.sends, 0)::bigint sends, e.last_sent
  from topics t
  left join (
    select c.topic_id,
      count(*) filter (where e.kind = 'confirmed' and e.created_at > now() - interval '7 days')
        - count(*) filter (where e.kind = 'withdrawn' and e.created_at > now() - interval '7 days') net_week,
      count(distinct c.id) filter (where e.kind = 'pending') signups,
      count(distinct c.id) filter (where e.kind = 'confirmed'
        and c.id in (select consent_id from consent_events where kind = 'pending')) confirms,
      count(*) filter (where e.kind = 'withdrawn') leaves,
      count(*) filter (where e.kind = 'sent') sends,
      max(e.created_at) filter (where e.kind = 'sent') last_sent
    from consent_events e join consents c on c.id = e.consent_id
    group by c.topic_id) e on e.topic_id = t.id`);
