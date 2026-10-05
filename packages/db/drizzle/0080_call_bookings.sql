CREATE TABLE "call_bookings" (
	"id" serial NOT NULL,
	"uid" varchar(64) NOT NULL,
	"state" varchar(16) NOT NULL,
	"start" timestamp with time zone,
	"email" varchar(320),
	"name" text,
	"offer" varchar(64),
	"code" varchar(40),
	"message_id" integer,
	"enrollment_id" integer,
	"booked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_call_bookings" PRIMARY KEY("id"),
	CONSTRAINT "uq_call_bookings_uid" UNIQUE("uid"),
	CONSTRAINT "ck_call_bookings_callbookingstate" CHECK (("state")::text = ANY ((ARRAY['booked'::character varying, 'cancelled'::character varying])::text[]))
);
--> statement-breakpoint
DROP VIEW "public"."contact_outcomes";--> statement-breakpoint
DROP VIEW "books"."econ_channels";--> statement-breakpoint
ALTER TABLE "enrollments" DROP CONSTRAINT "ck_enrollments_stopreason";--> statement-breakpoint
ALTER TABLE "call_bookings" ADD CONSTRAINT "fk_call_bookings_message_id_messages" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_bookings" ADD CONSTRAINT "fk_call_bookings_enrollment_id_enrollments" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_call_bookings_enrollment_id" ON "call_bookings" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "ix_call_bookings_message_id" ON "call_bookings" USING btree ("message_id");--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "ck_enrollments_stopreason" CHECK (("stop_reason")::text = ANY ((ARRAY['reply'::character varying, 'bounce'::character varying, 'opt_out'::character varying, 'complaint'::character varying, 'manual'::character varying, 'undeliverable'::character varying, 'booked'::character varying])::text[]));--> statement-breakpoint
CREATE VIEW "public"."contact_outcomes" AS (WITH sent AS ( SELECT m.enrollment_id, max(m.sent_at) AS last_sent_at FROM messages m WHERE m.state::text = 'sent'::text GROUP BY m.enrollment_id ), ev AS ( SELECT te.enrollment_id, max(te.received_at) AS last_event_at, bool_or(te.kind::text = ANY (ARRAY['unsubscribe'::text, 'complaint'::text])) AS opted_out, bool_or(te.kind::text = 'reply'::text AND (te.disposition::text = ANY (ARRAY['interested'::text, 'meeting_booked'::text]))) AS warm, COALESCE((array_agg(COALESCE(te.disposition::text, 'other'::text) ORDER BY te.received_at DESC, te.id DESC) FILTER (WHERE te.kind::text = 'reply'::text))[1] = 'other'::text, false) AS needs_a_look, bool_or(te.kind::text = 'bounce'::text AND te.bounce_class::text = 'hard'::text) AS hard_bounced, (array_agg(te.disposition ORDER BY te.received_at DESC, te.id DESC) FILTER (WHERE te.kind::text = 'reply'::text AND te.disposition IS NOT NULL))[1] AS disposition FROM thread_events te GROUP BY te.enrollment_id ) SELECT e.id AS enrollment_id, e.company_id, e.niche, e.sequence_name, e.offer, e.to_email, e.contact_round, e.created_at AS enrolled_at, GREATEST(e.created_at, e.stopped_at, s.last_sent_at, ev.last_event_at) AS last_touch_at, CASE WHEN e.state::text = 'active'::text THEN 'active'::text WHEN (e.stop_reason::text = ANY (ARRAY['opt_out'::text, 'complaint'::text])) OR ev.opted_out THEN 'opted_out'::text WHEN ev.warm OR e.stop_reason::text = 'booked'::text OR (EXISTS ( SELECT 1 FROM call_bookings cb WHERE cb.enrollment_id = e.id)) THEN 'warm'::text WHEN e.stop_reason::text = 'manual'::text THEN 'stopped_by_hand'::text WHEN ev.needs_a_look THEN 'needs_a_look'::text WHEN ev.disposition::text = ANY (ARRAY['not_interested'::text, 'not_now'::text, 'wrong_person'::text, 'referral'::text]) THEN ev.disposition::text WHEN e.stop_reason::text = 'bounce'::text OR ev.hard_bounced THEN 'bounced'::text ELSE 'no_reply'::text END AS outcome FROM enrollments e LEFT JOIN sent s ON s.enrollment_id = e.id LEFT JOIN ev ON ev.enrollment_id = e.id);--> statement-breakpoint
CREATE VIEW "books"."econ_channels" AS (
    with chans as (
      select unnest(array['email', 'sms', 'ads', 'content', 'search', 'reach', 'unknown']) channel),
    spend as (
      select date_trunc('month', e.posted_on)::date "month", a.channel::text channel, sum(l.cad_cents) cents
      from books.lines l join books.entries e on e.id = l.entry_id
      join books.accounts a on a.id = l.account_id
      where a.type = 'expense' and a.bucket = 'acquisition' group by 1, 2),
    news as (
      select x."month", x.channel, count(*) n from books.econ_client_months x where x.is_new group by 1, 2),
    stages as (
      select 'email' channel, l.created_at ts, 'lead' stage from leads l
      union all select 'email', m.sent_at, 'send' from messages m where m.state = 'sent' and m.sent_at is not null
      union all select 'email', te.received_at, 'reply' from thread_events te where te.kind = 'reply'
      union all select 'email', te.received_at, 'interested' from thread_events te
        where te.kind = 'reply' and te.disposition in ('interested', 'meeting_booked')
      union all select 'email', ci.updated_at, 'booked' from call_invites ci where ci.state in ('booked', 'already_booked')
      union all select 'email', cb.booked_at, 'booked' from call_bookings cb
        where cb.state = 'booked' and cb.enrollment_id is not null and not exists (
          select 1 from call_invites ci where ci.enrollment_id = cb.enrollment_id and ci.state in ('booked', 'already_booked'))
      union all select 'sms', c.created_at, 'lead' from sms_contacts c
      union all select 'sms', m.sent_at, 'send' from sms_messages m where m.direction = 'out' and m.sent_at is not null
      union all select 'sms', coalesce(m.received_at, m.created_at), 'reply' from sms_messages m where m.direction = 'in'
      union all select 'sms', coalesce(m.received_at, m.created_at), 'interested' from sms_messages m
        where m.direction = 'in' and m.disposition = 'interested'
      union all select 'reach', c.created_at, 'lead' from reach_contacts c
      union all select 'reach', m.sent_at, 'send' from reach_messages m where m.direction = 'out' and m.sent_at is not null
      union all select 'reach', m.created_at, 'reply' from reach_messages m where m.direction = 'in'),
    funnel as (
      select s.channel, date_trunc('month', s.ts at time zone 'America/Toronto')::date "month",
        count(*) filter (where s.stage = 'lead') leads, count(*) filter (where s.stage = 'send') sends,
        count(*) filter (where s.stage = 'reply') replies,
        count(*) filter (where s.stage = 'interested') interested,
        count(*) filter (where s.stage = 'booked') booked
      from stages s group by 1, 2),
    grid as (
      select mo."month", mo.latest, c.channel,
        coalesce(s.cents, 0) direct, coalesce(sh.cents, 0) shared,
        coalesce(n.n, 0) new_clients, coalesce(nt.n, 0) new_total,
        coalesce(fu.leads, 0) leads, coalesce(fu.sends, 0) sends, coalesce(fu.replies, 0) replies,
        coalesce(fu.interested, 0) interested, coalesce(fu.booked, 0) booked
      from books.econ_months mo cross join chans c
      left join spend s on s."month" = mo."month" and s.channel = c.channel
      left join spend sh on sh."month" = mo."month" and sh.channel is null
      left join news n on n."month" = mo."month" and n.channel = c.channel
      left join (select x."month", sum(x.n) n from news x group by 1) nt on nt."month" = mo."month"
      left join funnel fu on fu."month" = mo."month" and fu.channel = c.channel),
    t as (
      select g.*,
        g.direct + case when g.new_total > 0 then g.shared * g.new_clients::numeric / g.new_total else 0 end cents,
        sum(g.direct) over w3 direct3, sum(g.shared) over w3 shared3,
        sum(g.new_clients) over w3 new3, sum(g.new_total) over w3 total3,
        sum(g.direct) over w6 direct6, sum(g.shared) over w6 shared6,
        sum(g.new_clients) over w6 new6, sum(g.new_total) over w6 total6,
        sum(g.direct) over w12 direct12, sum(g.shared) over w12 shared12,
        sum(g.new_clients) over w12 new12, sum(g.new_total) over w12 total12
      from grid g
      window w3 as (partition by g.channel order by g."month" rows 2 preceding),
        w6 as (partition by g.channel order by g."month" rows 5 preceding),
        w12 as (partition by g.channel order by g."month" rows 11 preceding))
    select t.channel || '/' || to_char(t."month", 'YYYY-MM') id, t.channel, t."month", t.latest,
      'CAD' currency, round(t.cents / 100.0, 2) spend,
      t.leads::int leads, t.sends::int sends, t.replies::int replies,
      t.interested::int interested, t.booked::int booked, t.new_clients::int new_clients,
      round(t.cents / 100.0 / nullif(t.leads, 0), 2) per_lead,
      round(t.cents / 100.0 / nullif(t.sends, 0), 4) per_send,
      round(t.cents / 100.0 / nullif(t.replies, 0), 2) per_reply,
      round(t.cents / 100.0 / nullif(t.interested, 0), 2) per_interested,
      round(t.cents / 100.0 / nullif(t.booked, 0), 2) per_booked,
      round((t.direct3 + t.shared3 * t.new3::numeric / nullif(t.total3, 0)) / 100.0 / nullif(t.new3, 0), 2) cac_3,
      round((t.direct6 + t.shared6 * t.new6::numeric / nullif(t.total6, 0)) / 100.0 / nullif(t.new6, 0), 2) cac_6,
      round((t.direct12 + t.shared12 * t.new12::numeric / nullif(t.total12, 0)) / 100.0 / nullif(t.new12, 0), 2) cac_12
    from t);