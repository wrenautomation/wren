CREATE VIEW "public"."sent_activity" AS (
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
    'Opened' || case when count(*) > 1 then ' ' || count(*) || ' times, last ' || to_char(max(o.seen_at) at time zone 'UTC', 'Mon FMDD') else '' end, 5
  from open_events o join messages m on m.id = o.message_id
  where o.seen_at >= m.sent_at + interval '2 minutes' group by o.message_id
  union all
  select 'email:' || t.message_id, t.received_at, t.kind,
    case t.kind
      when 'reply' then 'They replied' || coalesce(': ' || left(t.snippet, 140), '')
      when 'bounce' then 'Bounced' || coalesce(' (' || t.bounce_class || ')', '') || coalesce(': ' || left(t.detail, 140), '')
      when 'auto_reply' then 'Automatic reply'
      when 'unsubscribe' then 'They unsubscribed'
      else 'They marked it as spam' end, 6
  from (
  select t.id, t.kind, t.bounce_class, t.received_at, t.snippet, t.detail,
    coalesce(t.in_reply_to_message_id,
      (select x.id from messages x
        where x.enrollment_id = t.enrollment_id and x.sent_at <= t.received_at
        order by x.sent_at desc limit 1)) message_id
  from thread_events t
  where t.kind in ('reply', 'bounce', 'auto_reply', 'unsubscribe', 'complaint')) t where t.message_id is not null
  union all
  select 'newsletter:' || e.id, e.created_at, 'sent', 'Sent as ' || coalesce(e.evidence ->> 'issue', 'an issue'), 3
  from consent_events e join consents c on c.id = e.consent_id
  where e.kind = 'sent' and c.channel = 'email'
  union all
  select 'sms:' || m.id, m.created_at, 'queued', 'Queued', 1
  from sms_messages m where m.direction = 'out'
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
  select 'sms:' || m.id, i.received_at, 'replied', 'They replied: ' || left(regexp_replace(i.body, '[[:space:]]+', ' ', 'g'), 140), 6
  from sms_messages m
  join sms_messages i on i.contact_id = m.contact_id and i.direction = 'in'
    and i.received_at > m.sent_at and i.received_at < coalesce((select min(n.sent_at) from sms_messages n
    where n.contact_id = m.contact_id and n.direction = 'out' and n.sent_at > m.sent_at),
  'infinity'::timestamptz)
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
  select 'dm:' || m.id, i.sent_at, 'replied', 'They replied: ' || left(regexp_replace(i.body, '[[:space:]]+', ' ', 'g'), 140), 6
  from reach_messages m
  join reach_messages i on i.contact_id = m.contact_id and i.direction = 'in'
    and i.sent_at > m.sent_at and i.sent_at < coalesce((select min(n.sent_at) from reach_messages n
    where n.contact_id = m.contact_id and n.direction = 'out' and n.sent_at > m.sent_at),
  'infinity'::timestamptz)
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
  from reddit_threads r where r.answer is not null and r.answered_at is not null);--> statement-breakpoint
CREATE VIEW "public"."sent_records" AS (
  with ev as (
    select message_id, bool_or(kind = 'bounce') bounced, bool_or(kind = 'reply') replied
    from (
  select t.id, t.kind, t.bounce_class, t.received_at, t.snippet, t.detail,
    coalesce(t.in_reply_to_message_id,
      (select x.id from messages x
        where x.enrollment_id = t.enrollment_id and x.sent_at <= t.received_at
        order by x.sent_at desc limit 1)) message_id
  from thread_events t
  where t.kind in ('reply', 'bounce', 'auto_reply', 'unsubscribe', 'complaint')) t where message_id is not null group by message_id),
  op as (
    select o.message_id from open_events o join messages m on m.id = o.message_id
    where o.seen_at >= m.sent_at + interval '2 minutes' group by o.message_id)
  select 'email:' || m.id id, 'email' channel, 'email' kind,
    m.to_email to_address, 'email' key_kind, lower(m.to_email) key_value,
    left(regexp_replace(coalesce(m.subject, m.body), '[[:space:]]+', ' ', 'g'), 140) subject,
    m.state channel_state,
    case when m.state in ('failed', 'unknown') then 'failed'
      when m.state in ('approved', 'sending') then 'queued'
      when ev.bounced then 'bounced'
      when ev.replied then 'replied'
      when op.message_id is not null then 'opened'
      else 'sent' end state,
    e.niche || ' / ' || replace(e.sequence_name, '_', ' ') campaign,
    coalesce(m.sent_at, m.approved_at, m.created_at) at
  from messages m
  join enrollments e on e.id = m.enrollment_id
  left join ev on ev.message_id = m.id
  left join op on op.message_id = m.id
  where m.state in ('approved', 'sending', 'sent', 'failed', 'unknown')
  union all
  select 'newsletter:' || e.id, 'email', 'newsletter',
    c.address, 'email', lower(c.address),
    coalesce(b.title, e.evidence ->> 'issue'),
    'sent', 'sent', t.public_name, e.created_at
  from consent_events e
  join consents c on c.id = e.consent_id
  join topics t on t.id = c.topic_id
  left join blog_posts b on b.slug = split_part(e.evidence ->> 'issue', ':', 2)
  where e.kind = 'sent' and c.channel = 'email'
  union all
  select 'sms:' || m.id, 'sms', 'sms',
    m.to_e164, 'phone', m.to_e164,
    left(regexp_replace(m.body, '[[:space:]]+', ' ', 'g'), 140),
    m.state,
    case when m.state in ('failed', 'unknown') then 'failed'
      when m.state in ('queued', 'sending') then 'queued'
      when exists (select 1 from sms_messages i
    where i.contact_id = m.contact_id and i.direction = 'in'
      and i.received_at > m.sent_at and i.received_at < coalesce((select min(n.sent_at) from sms_messages n
    where n.contact_id = m.contact_id and n.direction = 'out' and n.sent_at > m.sent_at),
  'infinity'::timestamptz)) then 'replied'
      when m.state = 'delivered' then 'delivered'
      else 'sent' end,
    case m.kind
      when 'sequence' then coalesce(c.niche || ' / ', '') || replace(coalesce(c.sequence, m.template, 'sequence'), '_', ' ')
      else replace(m.kind, '_', ' ') end,
    coalesce(m.sent_at, m.due_at, m.created_at)
  from sms_messages m
  join sms_contacts c on c.id = m.contact_id
  where m.direction = 'out' and m.state in ('queued', 'sending', 'sent', 'delivered', 'failed', 'unknown')
  union all
  select 'dm:' || m.id, c.platform, 'dm',
    c.handle, 'handle:' || c.platform, lower(c.handle),
    left(regexp_replace(coalesce(m.subject, m.body), '[[:space:]]+', ' ', 'g'), 140),
    m.state,
    case when m.state in ('failed', 'unknown') then 'failed'
      when m.state in ('queued', 'sending') then 'queued'
      when exists (select 1 from reach_messages i
    where i.contact_id = m.contact_id and i.direction = 'in'
      and i.sent_at > m.sent_at and i.sent_at < coalesce((select min(n.sent_at) from reach_messages n
    where n.contact_id = m.contact_id and n.direction = 'out' and n.sent_at > m.sent_at),
  'infinity'::timestamptz)) then 'replied'
      else 'sent' end,
    case m.kind
      when 'sequence' then coalesce(c.niche || ' / ', '') || replace(coalesce(c.sequence, 'sequence'), '_', ' ')
      when 'connect' then 'invite'
      else replace(m.kind, '_', ' ') end,
    coalesce(m.sent_at, m.due_at, m.created_at)
  from reach_messages m
  join reach_contacts c on c.id = m.contact_id
  where m.direction = 'out' and m.state in ('queued', 'sending', 'sent', 'failed', 'unknown')
  union all
  select 'comment:' || k.id, k.platform, 'comment',
    k.author, 'handle:' || k.platform, lower(k.author),
    left(regexp_replace(k.answer, '[[:space:]]+', ' ', 'g'), 140),
    'answered', 'sent',
    case k.channel when 'content' then 'replies on our posts' else 'replies to comments' end,
    k.answered_at
  from comments k
  where k.answer is not null and k.answered_at is not null
  union all
  select 'post:' || p.id, p.platform, 'comment',
    coalesce(p.handle, p.author), 'handle:' || p.platform, lower(coalesce(p.handle, p.author)),
    left(regexp_replace(p.comment, '[[:space:]]+', ' ', 'g'), 140),
    'commented', 'sent', p.found_by, p.commented_at
  from reach_posts p
  where p.comment is not null and p.commented_at is not null
  union all
  select 'thread:' || r.id, 'reddit', 'comment',
    r.author, 'handle:reddit', lower(r.author),
    left(regexp_replace(r.answer, '[[:space:]]+', ' ', 'g'), 140),
    'commented', 'sent', 'r/' || r.subreddit, r.answered_at
  from reddit_threads r
  where r.answer is not null and r.answered_at is not null);