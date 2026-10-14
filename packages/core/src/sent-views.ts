/**
 * The SQL views behind the sent log (`./sent-records.ts`, designs/2026-10-14-customerio-audit.md,
 * B2): every message we sent, on any channel, as one row, and each row's history.
 *
 * One ladder for all of them: queued, sent, delivered, bounced, failed, opened, clicked, replied.
 * A row sits at the furthest step it reached. A failure (bounced, failed) wins over the rest, since
 * nothing after it can have happened. Each source keeps its own state beside it (`channel_state`).
 * What each channel can prove:
 * - email: no delivery receipts, so it counts as delivered once 48 hours pass with no bounce, or
 *   sooner on an open, a click or a reply (the history says which rule fired). An open is a fetch
 *   of the tracking image at least 2 minutes after sending, as `open_outcomes` counts it; a click
 *   is a view of the lander that came from the email's link (`email_clicks`, pulled hourly), also
 *   counted only from 2 minutes after sending. Both rules read `now()`, so a message crosses into
 *   "delivered" by itself with nothing written.
 * - texts: the carrier's receipt sets "delivered"; an inbound text after ours is a reply.
 * - DMs and comments: sent or not; a DM's reply is the next inbound message on the thread.
 * - newsletter and marketing mail: a consent event of kind `sent`, one per address and issue.
 * - broadcasts (`./broadcasts.ts`): an email is its recipient row, sent or not yet; a text is its
 *   recipient row until it is queued, then its `sms_messages` row. `broadcast` names the
 *   broadcast on both, so its results are this view's rows for it.
 *
 * Not here: drafts, rejected and skipped messages (they never left), and what people sent us.
 * Each row's `key_kind` and `key_value` are how B1's `profile_keys` name the same address
 * (`email`, `phone`, `handle:<platform>`), so a profile joins on those two columns.
 */
import { sql } from "drizzle-orm";
import { integer, pgView, text, timestamp } from "drizzle-orm/pg-core";

/** "Oct 12": a date as a history line says it. */
const DAY = (col: string) => sql.raw(`to_char(${col} at time zone 'UTC', 'Mon FMDD')`);

/** A message's first line: whitespace folded, cut at 140 characters. */
const LINE = (col: string) => `left(regexp_replace(${col}, '[[:space:]]+', ' ', 'g'), 140)`;

/**
 * Every reply, bounce and other mail event on a thread, with the message it answers: the one its
 * headers name, else the last one sent on that thread before it arrived.
 */
const THREAD = `
  select t.id, t.kind, t.bounce_class, t.received_at, t.snippet, t.detail,
    coalesce(t.in_reply_to_message_id,
      (select x.id from messages x
        where x.enrollment_id = t.enrollment_id and x.sent_at <= t.received_at
        order by x.sent_at desc limit 1)) message_id
  from thread_events t
  where t.kind in ('reply', 'bounce', 'auto_reply', 'unsubscribe', 'complaint')`;

/** The next text we sent on the thread after this one, or never: where a reply stops being its. */
const NEXT_SMS = `coalesce((select min(n.sent_at) from sms_messages n
    where n.contact_id = m.contact_id and n.direction = 'out' and n.sent_at > m.sent_at),
  'infinity'::timestamptz)`;
const NEXT_DM = `coalesce((select min(n.sent_at) from reach_messages n
    where n.contact_id = m.contact_id and n.direction = 'out' and n.sent_at > m.sent_at),
  'infinity'::timestamptz)`;

/** An inbound text or DM after this outbound one and before the next outbound one. */
const REPLY_SMS = `exists (select 1 from sms_messages i
    where i.contact_id = m.contact_id and i.direction = 'in'
      and i.received_at > m.sent_at and i.received_at < ${NEXT_SMS})`;
const REPLY_DM = `exists (select 1 from reach_messages i
    where i.contact_id = m.contact_id and i.direction = 'in'
      and i.sent_at > m.sent_at and i.sent_at < ${NEXT_DM})`;

/** A broadcast text's broadcast id: its ref is `<slug>/<id>`. */
const BROADCAST_OF_REF = `case when split_part(m.ref, '/', 2) ~ '^[0-9]+$'
    then split_part(m.ref, '/', 2)::int end`;

export const sentRecords = pgView("sent_records", {
  id: text("id"),
  channel: text("channel"),
  kind: text("kind"),
  toAddress: text("to_address"),
  keyKind: text("key_kind"),
  keyValue: text("key_value"),
  subject: text("subject"),
  channelState: text("channel_state"),
  state: text("state"),
  campaign: text("campaign"),
  at: timestamp("at", { withTimezone: true }),
  broadcast: integer("broadcast"),
}).as(sql`
  with ev as (
    select message_id, bool_or(kind = 'bounce') bounced, bool_or(kind = 'reply') replied
    from (${sql.raw(THREAD)}) t where message_id is not null group by message_id),
  op as (
    select o.message_id from open_events o join messages m on m.id = o.message_id
    where o.seen_at >= m.sent_at + interval '2 minutes' group by o.message_id),
  ck as (
    select c.message_id from email_clicks c join messages m on m.id = c.message_id
    where c.last_at >= m.sent_at + interval '2 minutes' group by c.message_id)
  select 'email:' || m.id id, 'email' channel, 'email' kind,
    m.to_email to_address, 'email' key_kind, lower(m.to_email) key_value,
    ${sql.raw(LINE("coalesce(m.subject, m.body)"))} subject,
    m.state channel_state,
    case when m.state in ('failed', 'unknown') then 'failed'
      when m.state in ('approved', 'sending') then 'queued'
      when ev.bounced then 'bounced'
      when ev.replied then 'replied'
      when ck.message_id is not null then 'clicked'
      when op.message_id is not null then 'opened'
      when m.sent_at <= now() - interval '48 hours' then 'delivered'
      else 'sent' end state,
    e.niche || ' / ' || replace(e.sequence_name, '_', ' ') campaign,
    coalesce(m.sent_at, m.approved_at, m.created_at) at, null::int broadcast
  from messages m
  join enrollments e on e.id = m.enrollment_id
  left join ev on ev.message_id = m.id
  left join op on op.message_id = m.id
  left join ck on ck.message_id = m.id
  where m.state in ('approved', 'sending', 'sent', 'failed', 'unknown')
  union all
  select 'newsletter:' || e.id, 'email', 'newsletter',
    c.address, 'email', lower(c.address),
    coalesce(b.title, e.evidence ->> 'issue'),
    'sent', 'sent', t.public_name, e.created_at, null::int
  from consent_events e
  join consents c on c.id = e.consent_id
  join topics t on t.id = c.topic_id
  left join blog_posts b on b.slug = split_part(e.evidence ->> 'issue', ':', 2)
  where e.kind = 'sent' and c.channel = 'email' and not coalesce(e.evidence ? 'broadcast', false)
  union all
  select 'broadcast:' || r.id, b.channel, 'broadcast',
    r.address, case b.channel when 'email' then 'email' else 'phone' end, lower(r.address),
    ${sql.raw(LINE("coalesce(b.subject, b.body)"))},
    r.state,
    case r.state when 'sent' then 'sent' when 'failed' then 'failed' else 'queued' end,
    b.name, coalesce(r.sent_at, r.due_at), b.id
  from broadcast_recipients r
  join broadcasts b on b.id = r.broadcast_id
  where r.address is not null and (r.state in ('due', 'held', 'sending', 'sent', 'failed')
    and (b.channel = 'email' or r.state in ('due', 'held')))
  union all
  select 'sms:' || m.id, 'sms', case m.kind when 'broadcast' then 'broadcast' else 'sms' end,
    m.to_e164, 'phone', m.to_e164,
    ${sql.raw(LINE("m.body"))},
    m.state,
    case when m.state in ('failed', 'unknown') then 'failed'
      when m.state in ('queued', 'sending') then 'queued'
      when ${sql.raw(REPLY_SMS)} then 'replied'
      when m.state = 'delivered' then 'delivered'
      else 'sent' end,
    case m.kind
      when 'sequence' then coalesce(c.niche || ' / ', '') || replace(coalesce(c.sequence, m.template, 'sequence'), '_', ' ')
      when 'broadcast' then coalesce(bc.name, 'broadcast')
      else replace(m.kind, '_', ' ') end,
    coalesce(m.sent_at, m.due_at, m.created_at), bc.id
  from sms_messages m
  join sms_contacts c on c.id = m.contact_id
  left join broadcasts bc on m.kind = 'broadcast' and bc.id = ${sql.raw(BROADCAST_OF_REF)}
  where m.direction = 'out' and m.state in ('queued', 'sending', 'sent', 'delivered', 'failed', 'unknown')
  union all
  select 'dm:' || m.id, c.platform, 'dm',
    c.handle, 'handle:' || c.platform, lower(c.handle),
    ${sql.raw(LINE("coalesce(m.subject, m.body)"))},
    m.state,
    case when m.state in ('failed', 'unknown') then 'failed'
      when m.state in ('queued', 'sending') then 'queued'
      when ${sql.raw(REPLY_DM)} then 'replied'
      else 'sent' end,
    case m.kind
      when 'sequence' then coalesce(c.niche || ' / ', '') || replace(coalesce(c.sequence, 'sequence'), '_', ' ')
      when 'connect' then 'invite'
      else replace(m.kind, '_', ' ') end,
    coalesce(m.sent_at, m.due_at, m.created_at), null::int
  from reach_messages m
  join reach_contacts c on c.id = m.contact_id
  where m.direction = 'out' and m.state in ('queued', 'sending', 'sent', 'failed', 'unknown')
  union all
  select 'comment:' || k.id, k.platform, 'comment',
    k.author, 'handle:' || k.platform, lower(k.author),
    ${sql.raw(LINE("k.answer"))},
    'answered', 'sent',
    case k.channel when 'content' then 'replies on our posts' else 'replies to comments' end,
    k.answered_at, null::int
  from comments k
  where k.answer is not null and k.answered_at is not null
  union all
  select 'post:' || p.id, p.platform, 'comment',
    coalesce(p.handle, p.author), 'handle:' || p.platform, lower(coalesce(p.handle, p.author)),
    ${sql.raw(LINE("p.comment"))},
    'commented', 'sent', p.found_by, p.commented_at, null::int
  from reach_posts p
  where p.comment is not null and p.commented_at is not null
  union all
  select 'thread:' || r.id, 'reddit', 'comment',
    r.author, 'handle:reddit', lower(r.author),
    ${sql.raw(LINE("r.answer"))},
    'commented', 'sent', 'r/' || r.subreddit, r.answered_at, null::int
  from reddit_threads r
  where r.answer is not null and r.answered_at is not null`);

/**
 * Each sent row's history, by `message` (a `sent_records` id): when it was written, approved,
 * sent, delivered, opened, replied to or bounced, and why a failure failed. `seq` breaks a tie in
 * `at`, the higher happened later.
 *
 * Email's "delivered" line is its first proof of arrival: the earliest open, click or reply, or
 * the 48-hour mark when none came sooner, and never on a message that bounced. A click's time is
 * its first one from 2 minutes after sending; when the first came sooner (a mail scanner), the
 * last one stands in for it.
 */
export const sentActivity = pgView("sent_activity", {
  message: text("message"),
  at: timestamp("at", { withTimezone: true }),
  kind: text("kind"),
  what: text("what"),
  seq: integer("seq"),
}).as(sql`
  with th as (${sql.raw(THREAD)}),
  proof as (
    select distinct on (message_id) message_id, at, what from (
      select o.message_id, min(o.seen_at) at, 'it was opened' what
      from open_events o join messages m on m.id = o.message_id
      where o.seen_at >= m.sent_at + interval '2 minutes' group by o.message_id
      union all
      select c.message_id, min(case when c.first_at >= m.sent_at + interval '2 minutes' then c.first_at else c.last_at end), 'they clicked a link'
      from email_clicks c join messages m on m.id = c.message_id
      where c.last_at >= m.sent_at + interval '2 minutes' group by c.message_id
      union all
      select t.message_id, min(t.received_at), 'they replied'
      from th t where t.kind = 'reply' and t.message_id is not null group by t.message_id
    ) p order by message_id, at),
  bounced as (select message_id from th where kind = 'bounce' and message_id is not null group by message_id)
  select 'email:' || m.id message, m.approved_at at, 'approved' kind,
    'Approved' || coalesce(' (' || replace(m.approved_by, '_', ' ') || ')', '') what, 2 seq
  from messages m where m.approved_at is not null
  union all
  select 'email:' || m.id, m.sent_at, 'sent',
    'Sent from ' || e.sender || coalesce(' through ' || m.transport, ''), 3
  from messages m join enrollments e on e.id = m.enrollment_id where m.sent_at is not null
  union all
  select 'email:' || m.id, coalesce(m.attempted_at, m.created_at), 'failed',
    case m.state when 'unknown' then 'May not have sent: ' else 'Didn''t send: ' end
      || coalesce(m.detail, 'no reason kept'), 3
  from messages m where m.state in ('failed', 'unknown')
  union all
  select 'email:' || o.message_id, min(o.seen_at), 'note',
    'Tracking image fetched within 2 minutes of sending: a mail scanner, so not counted as an open', 4
  from open_events o join messages m on m.id = o.message_id
  where o.seen_at < m.sent_at + interval '2 minutes' group by o.message_id
  union all
  select 'email:' || o.message_id, min(o.seen_at), 'opened',
    'Opened' || case when count(*) > 1 then ' ' || count(*) || ' times, last ' || ${DAY("max(o.seen_at)")} else '' end, 5
  from open_events o join messages m on m.id = o.message_id
  where o.seen_at >= m.sent_at + interval '2 minutes' group by o.message_id
  union all
  select 'email:' || c.message_id, min(c.first_at), 'note',
    'Link followed within 2 minutes of sending: a mail scanner, so not counted as a click', 4
  from email_clicks c join messages m on m.id = c.message_id
  where c.last_at < m.sent_at + interval '2 minutes' group by c.message_id
  union all
  select 'email:' || c.message_id, min(case when c.first_at >= m.sent_at + interval '2 minutes' then c.first_at else c.last_at end), 'clicked',
    'Clicked the link, landing on ' || string_agg(distinct c.url, ', ' order by c.url)
      || case when sum(c.clicks) > 1 then ' (' || sum(c.clicks) || ' times, last ' || ${DAY("max(c.last_at)")} || ')' else '' end, 5
  from email_clicks c join messages m on m.id = c.message_id
  where c.last_at >= m.sent_at + interval '2 minutes' group by c.message_id
  union all
  select 'email:' || t.message_id, t.received_at, t.kind,
    case t.kind
      when 'reply' then 'They replied' || coalesce(': ' || left(t.snippet, 140), '')
      when 'bounce' then 'Bounced' || coalesce(' (' || t.bounce_class || ')', '') || coalesce(': ' || left(t.detail, 140), '')
      when 'auto_reply' then 'Automatic reply'
      when 'unsubscribe' then 'They unsubscribed'
      else 'They marked it as spam' end, 6
  from th t where t.message_id is not null
  union all
  select 'email:' || m.id, d.at, 'delivered', 'Counted as delivered: ' || d.what, 4
  from messages m
  left join proof p on p.message_id = m.id
  cross join lateral (
    select case when p.at < m.sent_at + interval '48 hours' then p.at else m.sent_at + interval '48 hours' end at,
      case when p.at < m.sent_at + interval '48 hours' then p.what else 'no bounce in 48 hours' end what) d
  where m.state = 'sent' and m.sent_at is not null
    and not exists (select 1 from bounced b where b.message_id = m.id)
    and (p.at is not null or m.sent_at + interval '48 hours' <= now())
  union all
  select 'newsletter:' || e.id, e.created_at, 'sent', 'Sent as ' || coalesce(e.evidence ->> 'issue', 'an issue'), 3
  from consent_events e join consents c on c.id = e.consent_id
  where e.kind = 'sent' and c.channel = 'email' and not coalesce(e.evidence ? 'broadcast', false)
  union all
  select 'broadcast:' || r.id, r.created_at, 'queued', 'In the broadcast ' || b.name || ', due ' || ${DAY("r.due_at")}, 1
  from broadcast_recipients r join broadcasts b on b.id = r.broadcast_id
  union all
  select 'broadcast:' || r.id, b.decided_at, 'approved', 'Approved' || coalesce(' (' || b.decided_by || ')', ''), 2
  from broadcast_recipients r join broadcasts b on b.id = r.broadcast_id
  where b.decided_at is not null
  union all
  select 'broadcast:' || r.id, r.created_at, 'note', r.why || ' Next try ' || ${DAY("r.due_at")}, 4
  from broadcast_recipients r where r.state = 'held'
  union all
  select 'broadcast:' || r.id, r.sent_at, 'sent', 'Sent', 3
  from broadcast_recipients r join broadcasts b on b.id = r.broadcast_id
  where b.channel = 'email' and r.state = 'sent'
  union all
  select 'broadcast:' || r.id, coalesce(r.sent_at, r.due_at), 'failed', coalesce(r.why, 'Didn''t send: no reason kept'), 3
  from broadcast_recipients r where r.state = 'failed'
  union all
  select 'sms:' || m.id, m.created_at, 'queued', 'Queued', 1
  from sms_messages m where m.direction = 'out'
  union all
  select 'sms:' || m.id, bc.decided_at, 'approved',
    'Approved in the broadcast ' || bc.name || coalesce(' (' || bc.decided_by || ')', ''), 2
  from sms_messages m join broadcasts bc on bc.id = ${sql.raw(BROADCAST_OF_REF)}
  where m.direction = 'out' and m.kind = 'broadcast' and bc.decided_at is not null
  union all
  select 'sms:' || m.id, m.sent_at, 'sent',
    'Sent' || coalesce(' from ' || m.from_e164, '') || coalesce(' by ' || m.service, ''), 3
  from sms_messages m where m.direction = 'out' and m.sent_at is not null
  union all
  select 'sms:' || m.id, m.delivered_at, 'delivered', 'Delivered', 4
  from sms_messages m where m.direction = 'out' and m.delivered_at is not null
  union all
  select 'sms:' || m.id, coalesce(m.attempted_at, m.created_at), 'failed',
    case m.state when 'unknown' then 'May not have sent: ' else 'Didn''t send: ' end
      || coalesce(m.error_code || ' ', '') || coalesce(m.detail, 'no reason kept'), 3
  from sms_messages m where m.direction = 'out' and m.state in ('failed', 'unknown')
  union all
  select 'sms:' || m.id, i.received_at, 'replied', 'They replied: ' || ${sql.raw(LINE("i.body"))}, 6
  from sms_messages m
  join sms_messages i on i.contact_id = m.contact_id and i.direction = 'in'
    and i.received_at > m.sent_at and i.received_at < ${sql.raw(NEXT_SMS)}
  where m.direction = 'out'
  union all
  select 'dm:' || m.id, m.created_at, 'queued', 'Queued', 1
  from reach_messages m where m.direction = 'out'
  union all
  select 'dm:' || m.id, m.sent_at, 'sent', 'Sent', 3
  from reach_messages m where m.direction = 'out' and m.sent_at is not null
  union all
  select 'dm:' || m.id, m.created_at, 'failed',
    case m.state when 'unknown' then 'May not have sent: ' else 'Didn''t send: ' end
      || coalesce(m.state_reason, 'no reason kept'), 3
  from reach_messages m where m.direction = 'out' and m.state in ('failed', 'unknown')
  union all
  select 'dm:' || m.id, i.sent_at, 'replied', 'They replied: ' || ${sql.raw(LINE("i.body"))}, 6
  from reach_messages m
  join reach_messages i on i.contact_id = m.contact_id and i.direction = 'in'
    and i.sent_at > m.sent_at and i.sent_at < ${sql.raw(NEXT_DM)}
  where m.direction = 'out'
  union all
  select 'comment:' || k.id, k.answered_at, 'sent', 'Posted on ' || k.platform, 3
  from comments k where k.answer is not null and k.answered_at is not null
  union all
  select 'post:' || p.id, p.commented_at, 'sent',
    'Posted on ' || p.platform || coalesce(', by ' || p.commented_by, ''), 3
  from reach_posts p where p.comment is not null and p.commented_at is not null
  union all
  select 'thread:' || r.id, r.answered_at, 'sent', 'Posted on Reddit, in r/' || r.subreddit, 3
  from reddit_threads r where r.answer is not null and r.answered_at is not null`);
