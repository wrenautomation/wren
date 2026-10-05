CREATE TABLE "consent_events" (
	"id" serial NOT NULL,
	"consent_id" integer NOT NULL,
	"kind" varchar(16) NOT NULL,
	"by" varchar(320) NOT NULL,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_consent_events" PRIMARY KEY("id"),
	CONSTRAINT "ck_consent_events_kind" CHECK (("kind")::text = ANY ((ARRAY['pending'::character varying, 'confirmed'::character varying, 'withdrawn'::character varying, 'frequency'::character varying, 'paused'::character varying, 'sent'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" serial NOT NULL,
	"channel" varchar(16) NOT NULL,
	"address" varchar(320) NOT NULL,
	"topic_id" integer NOT NULL,
	"state" varchar(16) NOT NULL,
	"source" varchar(32) NOT NULL,
	"text_version" varchar(64) NOT NULL,
	"frequency" varchar(16) DEFAULT 'as_sent' NOT NULL,
	"paused_until" timestamp with time zone,
	"pending_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_consents" PRIMARY KEY("id"),
	CONSTRAINT "uq_consents_channel" UNIQUE("channel","address","topic_id"),
	CONSTRAINT "ck_consents_channel" CHECK (("channel")::text = ANY ((ARRAY['email'::character varying, 'sms'::character varying])::text[])),
	CONSTRAINT "ck_consents_state" CHECK (("state")::text = ANY ((ARRAY['pending'::character varying, 'confirmed'::character varying, 'withdrawn'::character varying])::text[])),
	CONSTRAINT "ck_consents_source" CHECK (("source")::text = ANY ((ARRAY['lander_form'::character varying, 'meta_lead_form'::character varying, 'sms_keyword'::character varying, 'calcom_booking'::character varying, 'preference_center'::character varying])::text[])),
	CONSTRAINT "ck_consents_frequency" CHECK (("frequency")::text = ANY ((ARRAY['as_sent'::character varying, 'weekly'::character varying, 'monthly'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" serial NOT NULL,
	"name" varchar(64) NOT NULL,
	"public_name" varchar(120) NOT NULL,
	"line" text NOT NULL,
	"channel" varchar(16) NOT NULL,
	"cadence" varchar(64) NOT NULL,
	"public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_topics" PRIMARY KEY("id"),
	CONSTRAINT "uq_topics_name" UNIQUE("name"),
	CONSTRAINT "ck_topics_channel" CHECK (("channel")::text = ANY ((ARRAY['email'::character varying, 'sms'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "fk_consent_events_consent_id_consents" FOREIGN KEY ("consent_id") REFERENCES "public"."consents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "fk_consents_topic_id_topics" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_consent_events_consent_id" ON "consent_events" USING btree ("consent_id","created_at");--> statement-breakpoint
CREATE VIEW "public"."marketing_subscriber_activity" AS (
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
  where x.kind in ('email', 'phone'));--> statement-breakpoint
CREATE VIEW "public"."marketing_subscriber_records" AS (
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
    case when off.at is not null then 'Can''t send: unsubscribed from everything on ' || to_char(off.at at time zone 'UTC', 'Mon FMDD')
      when s.confirmed and s.paused_until > now() then 'Can''t send: paused until ' || to_char(s.paused_until at time zone 'UTC', 'Mon FMDD')
      when s.confirmed then 'Can send: confirmed for ' || s.topics || ' on ' || to_char(s.confirmed_at at time zone 'UTC', 'Mon FMDD') || ' by ' || case s.source when 'lander_form' then 'lander form'
    when 'meta_lead_form' then 'Meta lead form' when 'sms_keyword' then 'text keyword'
    when 'calcom_booking' then 'cal.com booking' else 'preference center' end
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
    order by e.id desc limit 1) last on true);--> statement-breakpoint
CREATE VIEW "public"."marketing_topic_records" AS (
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
    group by c.topic_id) e on e.topic_id = t.id);