CREATE TABLE "broadcast_recipients" (
	"id" serial NOT NULL,
	"broadcast_id" integer NOT NULL,
	"profile_id" integer NOT NULL,
	"address" varchar(320),
	"zone" varchar(64),
	"state" varchar(8) DEFAULT 'due' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"why" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_broadcast_recipients" PRIMARY KEY("id"),
	CONSTRAINT "uq_broadcast_recipients_broadcast_profile" UNIQUE("broadcast_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" serial NOT NULL,
	"name" varchar(120) NOT NULL,
	"channel" varchar(8) NOT NULL,
	"segment_id" integer NOT NULL,
	"topic_id" integer NOT NULL,
	"subject" varchar(200),
	"body" text NOT NULL,
	"send_at" timestamp with time zone,
	"local" boolean DEFAULT false NOT NULL,
	"zone" varchar(64) DEFAULT 'America/New_York' NOT NULL,
	"state" varchar(16) DEFAULT 'draft' NOT NULL,
	"asked_by" varchar(320),
	"asked_at" timestamp with time zone,
	"decided_by" varchar(320),
	"decided_at" timestamp with time zone,
	"note" text,
	"tested_to" varchar(320),
	"tested_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"by" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_broadcasts" PRIMARY KEY("id")
);
--> statement-breakpoint
DROP VIEW "public"."sent_activity";--> statement-breakpoint
DROP VIEW "public"."sent_records";--> statement-breakpoint
ALTER TABLE "sms_messages" DROP CONSTRAINT "ck_sms_messages_messagekind";--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "fk_broadcast_recipients_broadcast_id_broadcasts" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "fk_broadcast_recipients_profile_id_profiles" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "fk_broadcasts_segment_id_segments" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "fk_broadcasts_topic_id_topics" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_broadcast_recipients_due" ON "broadcast_recipients" USING btree ("broadcast_id","state","due_at");--> statement-breakpoint
CREATE INDEX "ix_broadcast_recipients_profile_id" ON "broadcast_recipients" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "ix_broadcasts_segment_id" ON "broadcasts" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "ix_broadcasts_topic_id" ON "broadcasts" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "ix_broadcasts_state" ON "broadcasts" USING btree ("state","send_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sms_messages_broadcast_ref" ON "sms_messages" USING btree ("contact_id","ref") WHERE (kind)::text = 'broadcast'::text;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "ck_sms_messages_messagekind" CHECK (("kind")::text = ANY ((ARRAY['sequence'::character varying, 'manual'::character varying, 'reminder'::character varying, 'inbound'::character varying, 'follow_up'::character varying, 'text_back'::character varying, 'review'::character varying, 'pay'::character varying, 'doc'::character varying, 'broadcast'::character varying])::text[]));--> statement-breakpoint
CREATE VIEW "public"."broadcast_recipient_records" AS (
  select r.id, r.broadcast_id, b.name::text broadcast, b.channel::text, r.profile_id,
    coalesce(p.name, '#' || p.id) "name", r.address::text, r.state::text, r.why, r.zone::text,
    r.due_at, r.sent_at, '/people/people/' || r.profile_id profile_link
  from broadcast_recipients r
  join broadcasts b on b.id = r.broadcast_id
  join profiles p on p.id = r.profile_id);--> statement-breakpoint
CREATE VIEW "public"."broadcast_records" AS (
  select b.id, b.name::text, b.channel::text, b.state::text, b.segment_id, s.name::text segment,
    s.size, t.public_name::text topic, b.subject::text, b.body, b.send_at, b.local, b.zone::text,
    coalesce(b.started_at, b.send_at, b.decided_at, b.asked_at, b.created_at) "when",
    r.people, r.sent, r.waiting, r.skipped, r.failed,
    b.by::text, b.asked_at, b.decided_by::text, b.decided_at, b.note, b.tested_to::text,
    b.tested_at, b.started_at, b.finished_at, b.created_at,
    case when b.started_at is not null then '/people/sent?broadcast=' || b.id || '..' || b.id end sent_log,
    case when b.started_at is not null then '/people/recipients?broadcastId=' || b.id || '..' || b.id end recipients
  from broadcasts b
  join segments s on s.id = b.segment_id
  join topics t on t.id = b.topic_id
  left join lateral (
    select count(*)::int people,
      count(*) filter (where x.state in ('sent', 'queued'))::int sent,
      count(*) filter (where x.state in ('due', 'held', 'sending'))::int waiting,
      count(*) filter (where x.state = 'skipped')::int skipped,
      count(*) filter (where x.state = 'failed')::int failed
    from broadcast_recipients x where x.broadcast_id = b.id) r on true);--> statement-breakpoint
CREATE VIEW "public"."sent_activity" AS (
  with th as (
  select t.id, t.kind, t.bounce_class, t.received_at, t.snippet, t.detail,
    coalesce(t.in_reply_to_message_id,
      (select x.id from messages x
        where x.enrollment_id = t.enrollment_id and x.sent_at <= t.received_at
        order by x.sent_at desc limit 1)) message_id
  from thread_events t
  where t.kind in ('reply', 'bounce', 'auto_reply', 'unsubscribe', 'complaint')),
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
    'Opened' || case when count(*) > 1 then ' ' || count(*) || ' times, last ' || to_char(max(o.seen_at) at time zone 'UTC', 'Mon FMDD') else '' end, 5
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
      || case when sum(c.clicks) > 1 then ' (' || sum(c.clicks) || ' times, last ' || to_char(max(c.last_at) at time zone 'UTC', 'Mon FMDD') || ')' else '' end, 5
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
  select 'broadcast:' || r.id, r.created_at, 'queued', 'In the broadcast ' || b.name || ', due ' || to_char(r.due_at at time zone 'UTC', 'Mon FMDD'), 1
  from broadcast_recipients r join broadcasts b on b.id = r.broadcast_id
  union all
  select 'broadcast:' || r.id, b.decided_at, 'approved', 'Approved' || coalesce(' (' || b.decided_by || ')', ''), 2
  from broadcast_recipients r join broadcasts b on b.id = r.broadcast_id
  where b.decided_at is not null
  union all
  select 'broadcast:' || r.id, r.created_at, 'note', r.why || ' Next try ' || to_char(r.due_at at time zone 'UTC', 'Mon FMDD'), 4
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
  from sms_messages m join broadcasts bc on bc.id = case when split_part(m.ref, '/', 2) ~ '^[0-9]+$'
    then split_part(m.ref, '/', 2)::int end
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
    where o.seen_at >= m.sent_at + interval '2 minutes' group by o.message_id),
  ck as (
    select c.message_id from email_clicks c join messages m on m.id = c.message_id
    where c.last_at >= m.sent_at + interval '2 minutes' group by c.message_id)
  select 'email:' || m.id id, 'email' channel, 'email' kind,
    m.to_email to_address, 'email' key_kind, lower(m.to_email) key_value,
    left(regexp_replace(coalesce(m.subject, m.body), '[[:space:]]+', ' ', 'g'), 140) subject,
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
    left(regexp_replace(coalesce(b.subject, b.body), '[[:space:]]+', ' ', 'g'), 140),
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
      when 'broadcast' then coalesce(bc.name, 'broadcast')
      else replace(m.kind, '_', ' ') end,
    coalesce(m.sent_at, m.due_at, m.created_at), bc.id
  from sms_messages m
  join sms_contacts c on c.id = m.contact_id
  left join broadcasts bc on m.kind = 'broadcast' and bc.id = case when split_part(m.ref, '/', 2) ~ '^[0-9]+$'
    then split_part(m.ref, '/', 2)::int end
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
    coalesce(m.sent_at, m.due_at, m.created_at), null::int
  from reach_messages m
  join reach_contacts c on c.id = m.contact_id
  where m.direction = 'out' and m.state in ('queued', 'sending', 'sent', 'failed', 'unknown')
  union all
  select 'comment:' || k.id, k.platform, 'comment',
    k.author, 'handle:' || k.platform, lower(k.author),
    left(regexp_replace(k.answer, '[[:space:]]+', ' ', 'g'), 140),
    'answered', 'sent',
    case k.channel when 'content' then 'replies on our posts' else 'replies to comments' end,
    k.answered_at, null::int
  from comments k
  where k.answer is not null and k.answered_at is not null
  union all
  select 'post:' || p.id, p.platform, 'comment',
    coalesce(p.handle, p.author), 'handle:' || p.platform, lower(coalesce(p.handle, p.author)),
    left(regexp_replace(p.comment, '[[:space:]]+', ' ', 'g'), 140),
    'commented', 'sent', p.found_by, p.commented_at, null::int
  from reach_posts p
  where p.comment is not null and p.commented_at is not null
  union all
  select 'thread:' || r.id, 'reddit', 'comment',
    r.author, 'handle:reddit', lower(r.author),
    left(regexp_replace(r.answer, '[[:space:]]+', ' ', 'g'), 140),
    'commented', 'sent', 'r/' || r.subreddit, r.answered_at, null::int
  from reddit_threads r
  where r.answer is not null and r.answered_at is not null);