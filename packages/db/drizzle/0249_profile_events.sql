CREATE TABLE "profile_events" (
	"id" serial NOT NULL,
	"profile_id" integer NOT NULL,
	"kind" varchar(24) NOT NULL,
	"channel" varchar(24) NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"body" text,
	"link" text,
	"source" varchar(32) NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_profile_events" PRIMARY KEY("id"),
	CONSTRAINT "uq_profile_events_source" UNIQUE("source","source_id")
);
--> statement-breakpoint
DROP VIEW "public"."profile_timeline";--> statement-breakpoint
ALTER TABLE "site_forms" ADD COLUMN "pages" jsonb;--> statement-breakpoint
ALTER TABLE "profile_events" ADD CONSTRAINT "fk_profile_events_profile_id_profiles" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_profile_events_profile_id" ON "profile_events" USING btree ("profile_id","at");--> statement-breakpoint
CREATE VIEW "public"."profile_timeline" AS (
  select lines.id, lines.profile_id, lines.at, lines.kind, lines.channel,
  lines.summary, lines.body, lines.link, lines.source,
  coalesce(p.name, '#' || p.id) who, '/people/people/' || p.id profile_link from (
  select 'message:' || m.id id, k.profile_id, coalesce(m.sent_at, m.created_at) at,
    'email_sent' kind, 'email' channel, coalesce(nullif(m.subject, ''), '(no subject)') summary,
    m.body, null::text link, 'messages' source
  from profile_keys k
  join enrollments e on lower(e.to_email) = k.value
  join messages m on m.enrollment_id = e.id
  where k.kind = 'email' and m.sent_at is not null
  union all
  select 'thread_event:' || t.id, k.profile_id, t.received_at, 'email_received', 'email',
    replace(t.kind, '_', ' ') || ': ' || coalesce(nullif(t.subject, ''), t.snippet, ''),
    coalesce(t.body_text, t.snippet), null, 'thread_events'
  from profile_keys k
  join enrollments e on lower(e.to_email) = k.value
  join thread_events t on t.enrollment_id = e.id
  where k.kind = 'email' and t.kind <> 'note'
  union all
  select 'sms_message:' || s.id, k.profile_id, coalesce(s.received_at, s.sent_at, s.created_at),
    case when s.direction = 'in' then 'text_received' else 'text_sent' end, 'sms',
    left(s.body, 160), s.body, '/marketing/texts/' || c.id, 'sms_messages'
  from profile_keys k
  join sms_contacts c on c.e164 = k.value
  join sms_messages s on s.contact_id = c.id
  where k.kind = 'phone' and (s.direction = 'in' or s.sent_at is not null)
  union all
  select 'sms_call:' || x.id, k.profile_id, x.started_at, 'call_in', 'phone',
    'Called in: ' || coalesce(x.result, 'ringing'), x.text_back_detail,
    case when x.contact_id is not null then '/marketing/texts/' || x.contact_id end, 'sms_calls'
  from profile_keys k
  join sms_calls x on x.from_e164 = k.value
  where k.kind = 'phone'
  union all
  select 'voice_call:' || v.id, k.profile_id, v.started_at, 'voice_call', 'phone',
    v.direction || ' call: ' || v.outcome, v.message, '/voice/calls/' || v.id, 'voice_calls'
  from profile_keys k
  join voice_calls v on k.value in (v.from_number, v.to_number)
  where k.kind = 'phone'
  union all
  select 'call:' || c.id, k.profile_id, c.called_at, 'call', 'phone', 'Called by ' || c.called_by,
    null, '/reactivation/people/' || c.person_id, 'calls'
  from profile_keys k
  join calls c on c.person_id::text = k.value
  where k.kind = 'person'
  union all
  select 'touch:' || t.id, k.profile_id, t.at, 'touch', h.platform,
    case t.direction when 'ours' then 'We ' else 'They ' end || t.kind
      || coalesce(': ' || left(t.text, 140), ''),
    t.text, t.url, 'touches'
  from profile_keys k
  join social_handles h on k.kind = 'handle:' || h.platform and h.handle = k.value
  join touches t on t.handle_id = h.id
  where k.kind like 'handle:%'
  union all
  select 'consent_event:' || ce.id, k.profile_id, ce.created_at, 'consent', c.channel,
    tp.public_name || ': ' || ce.kind || ' (' || ce.by || ')', ce.evidence::text, null,
    'consent_events'
  from profile_keys k
  join consents c on c.address = k.value
    and c.channel = case k.kind when 'email' then 'email' when 'phone' then 'sms' end
  join topics tp on tp.id = c.topic_id
  join consent_events ce on ce.consent_id = c.id
  where k.kind in ('email', 'phone')
  union all
  select 'site_form:' || e.id, hit.profile_id, e.at, 'form', 'site',
    coalesce(f.name, p.title, 'A form') || ' sent',
    concat_ws(chr(10) || chr(10),
      (select string_agg(a || ': ' || b, chr(10) order by a) from jsonb_each_text(e.fields) x(a, b)),
      'Pages seen first: '
        || (select string_agg(v ->> 'path', ', ' order by n) from jsonb_array_elements(e.pages)
          with ordinality y(v, n))),
    '/sites/submissions/' || e.id, 'site_forms'
  from (
    select e.id, k.profile_id from profile_keys k
      join site_forms e on lower(e.fields ->> 'email') = k.value where k.kind = 'email'
    union
    select e.id, k.profile_id from profile_keys k
      join site_forms e on k.value in (e.fields ->> 'phone',
        '+' || regexp_replace(e.fields ->> 'phone', '[^0-9]', '', 'g'),
        '+1' || regexp_replace(e.fields ->> 'phone', '[^0-9]', '', 'g'))
      where k.kind = 'phone'
    union
    select e.id, k.profile_id from profile_keys k
      join site_forms e on e.visitor = k.value where k.kind = 'visitor'
  ) hit
  join site_forms e on e.id = hit.id
  left join site_form_defs f on f.id = e.form
  left join site_pages p on p.id = e.page
  where coalesce(f.client, p.client) is null
  union all
  select 'chat_message:' || m.id, k.profile_id, m.at, 'chat', 'site',
    case when m.direction = 'in' then 'They wrote: ' else 'We wrote: ' end || left(m.body, 140),
    m.body, null, 'chat_messages'
  from (
    select t.id, k.profile_id from profile_keys k
      join chat_threads t on lower(t.email) = k.value where k.kind = 'email'
    union
    select t.id, k.profile_id from profile_keys k
      join chat_threads t on k.value in (t.phone, '+' || t.phone, '+1' || t.phone)
      where k.kind = 'phone'
  ) k
  join chat_messages m on m.thread_id = k.id
  union all
  select 'booking:' || b.id, k.profile_id, b.created_at, 'booking', 'calendar',
    case when b.state = 'cancelled' then 'Cancelled the call on ' else 'Booked a call for ' end
      || to_char(b.start at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC',
    b.reason, '/calendar/calls/' || b.id, 'bookings'
  from profile_keys k
  join calendar.bookings b on lower(b.email) = k.value
  where k.kind = 'email'
  union all
  select 'call_booking:' || cb.id, k.profile_id, coalesce(cb.booked_at, cb.start), 'booking',
    'calendar', 'Booked a call' || coalesce(' for '
      || to_char(cb.start at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', ''),
    cb.outcome, '/calls/calls/' || cb.id, 'call_bookings'
  from profile_keys k
  join call_bookings cb on lower(cb.email) = k.value
  where k.kind = 'email' and cb.uid not like 'wren-%'
  union all
  select 'profile_event:' || pe.id, pe.profile_id, pe.at, pe.kind, pe.channel, pe.summary, pe.body,
    pe.link, pe.source
  from profile_events pe
  union all
  select distinct on (ev.workflow, ev.subject, w.profile_id) 'event:' || ev.id, w.profile_id,
    ev.at, 'workflow', 'workflow', 'Entered ' || ev.workflow, ev.subject, null, 'events'
  from (
    select k.profile_id, 'lead:email:' || e.id subject from profile_keys k
      join enrollments e on lower(e.to_email) = k.value where k.kind = 'email'
    union all
    select k.profile_id, 'lead:sms:' || c.id from profile_keys k
      join sms_contacts c on c.e164 = k.value where k.kind = 'phone'
  ) w
  join events ev on ev.subject = w.subject
  union all
  select 'trait_event:' || te.id, te.profile_id, te.at, 'trait', 'profile',
    te.key || ': ' || coalesce(te.old::text, 'none') || ' to ' || te.new::text, null, null,
    'profile_trait_events'
  from profile_trait_events te
  union all
  select 'merge:' || pm.id, pm.into_id, pm.at, 'merge', 'profile',
    'Profile #' || pm.from_id || ' merged in by ' || pm.by, null, null, 'profile_merges'
  from profile_merges pm
  ) lines
  join profiles p on p.id = lines.profile_id);