CREATE TABLE "profile_keys" (
	"id" serial NOT NULL,
	"profile_id" integer NOT NULL,
	"kind" varchar(48) NOT NULL,
	"value" varchar(320) NOT NULL,
	"source" varchar(32) NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_profile_keys" PRIMARY KEY("id"),
	CONSTRAINT "uq_profile_keys_kind_value" UNIQUE("kind","value")
);
--> statement-breakpoint
CREATE TABLE "profile_merges" (
	"id" serial NOT NULL,
	"into_id" integer NOT NULL,
	"from_id" integer NOT NULL,
	"by" varchar(400) NOT NULL,
	"keys" integer NOT NULL,
	"traits" integer NOT NULL,
	"source" varchar(32) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_profile_merges" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "profile_trait_events" (
	"id" serial NOT NULL,
	"profile_id" integer NOT NULL,
	"key" varchar(64) NOT NULL,
	"old" jsonb,
	"new" jsonb NOT NULL,
	"source" varchar(32) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_profile_trait_events" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "profile_traits" (
	"profile_id" integer NOT NULL,
	"key" varchar(64) NOT NULL,
	"value" jsonb NOT NULL,
	"source" varchar(32) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_profile_traits" PRIMARY KEY("profile_id","key")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" serial NOT NULL,
	"name" text,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"merged_into" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_profiles" PRIMARY KEY("id")
);
--> statement-breakpoint
DROP VIEW "public"."reactivation_people";--> statement-breakpoint
ALTER TABLE "profile_keys" ADD CONSTRAINT "fk_profile_keys_profile_id_profiles" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_merges" ADD CONSTRAINT "fk_profile_merges_into_id_profiles" FOREIGN KEY ("into_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_merges" ADD CONSTRAINT "fk_profile_merges_from_id_profiles" FOREIGN KEY ("from_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_trait_events" ADD CONSTRAINT "fk_profile_trait_events_profile_id_profiles" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_traits" ADD CONSTRAINT "fk_profile_traits_profile_id_profiles" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "fk_profiles_merged_into_profiles" FOREIGN KEY ("merged_into") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_profile_keys_profile_id" ON "profile_keys" USING btree ("profile_id","kind");--> statement-breakpoint
CREATE INDEX "ix_profile_keys_profile_text" ON "profile_keys" USING btree (("profile_id"::text));--> statement-breakpoint
CREATE INDEX "ix_profile_merges_into_id" ON "profile_merges" USING btree ("into_id");--> statement-breakpoint
CREATE INDEX "ix_profile_merges_from_id" ON "profile_merges" USING btree ("from_id");--> statement-breakpoint
CREATE INDEX "ix_profile_trait_events_profile_id" ON "profile_trait_events" USING btree ("profile_id","at");--> statement-breakpoint
CREATE INDEX "ix_profile_traits_key" ON "profile_traits" USING btree ("key");--> statement-breakpoint
CREATE INDEX "ix_profiles_merged_into" ON "profiles" USING btree ("merged_into");--> statement-breakpoint
CREATE INDEX "ix_profiles_last_seen" ON "profiles" USING btree ("last_seen");--> statement-breakpoint
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
  select 'site_form:' || e.id, hit.profile_id, e.at, 'form', coalesce(e.channel, 'site'),
    coalesce(f.name, p.title, 'A form') || ' sent',
    (select string_agg(a || ': ' || b, chr(10) order by a) from jsonb_each_text(e.fields) x(a, b)),
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
  where k.kind = 'email' and b.calendar = 'wren'
  union all
  select 'call_booking:' || cb.id, k.profile_id, coalesce(cb.booked_at, cb.start), 'booking',
    'calendar', 'Booked a call' || coalesce(' for '
      || to_char(cb.start at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', ''),
    cb.outcome, '/calls/calls/' || cb.id, 'call_bookings'
  from profile_keys k
  join call_bookings cb on lower(cb.email) = k.value
  where k.kind = 'email' and cb.uid not like 'wren-%'
  union all
  select 'paid:' || c.id, k.profile_id, c.paid_at, 'payment', 'sms',
    'Paid ' || to_char(c.paid_cents / 100.0, 'FM999999990.00') || ' by pay link', null,
    '/marketing/texts/' || c.id, 'sms_contacts'
  from profile_keys k
  join sms_contacts c on c.e164 = k.value
  where k.kind = 'phone' and c.paid_at is not null
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
  join profiles p on p.id = lines.profile_id);--> statement-breakpoint
CREATE VIEW "public"."profile_key_records" AS (
  select k.id, k.profile_id, k.kind::text, k.value::text, k.source::text, k.first_seen,
    '/people/people/' || k.profile_id profile_link
  from profile_keys k);--> statement-breakpoint
CREATE VIEW "public"."profile_merge_records" AS (
  select m.id, m.into_id, m.from_id, coalesce(p.name, '#' || m.from_id) from_name, m.by::text,
    m.keys, m.traits, m.source::text, m.at, '/people/people/' || m.into_id into_link
  from profile_merges m
  join profiles p on p.id = m.from_id);--> statement-breakpoint
CREATE VIEW "public"."profile_records" AS (
  select p.id, coalesce(p.name, (select k.value from profile_keys k where k.profile_id = p.id
      order by k.kind <> 'email', k.kind <> 'phone', k.id limit 1), '#' || p.id) "name",
    (select string_agg(k.value, ', ' order by k.id) from profile_keys k
      where k.profile_id = p.id and k.kind = 'email') emails,
    (select string_agg(k.value, ', ' order by k.id) from profile_keys k
      where k.profile_id = p.id and k.kind = 'phone') phones,
    (select string_agg(substr(k.kind, 8) || ' ' || k.value, ', ' order by k.id) from profile_keys k
      where k.profile_id = p.id and k.kind like 'handle:%') handles,
    (select string_agg(distinct case when k.kind = 'phone' then 'sms'
        when k.kind like 'handle:%' then substr(k.kind, 8) else k.kind end, ', ')
      from profile_keys k where k.profile_id = p.id and (k.kind in ('email', 'phone')
        or k.kind like 'handle:%')) channels,
    (select string_agg(distinct x.said, ', ') from (
      select c.channel || ' ' || c.state said from profile_keys k
        join consents c on c.address = k.value
          and c.channel = case k.kind when 'email' then 'email' when 'phone' then 'sms' end
        where k.profile_id = p.id and k.kind in ('email', 'phone')
      union all
      select 'sms opted out' from profile_keys k join sms_contacts s on s.e164 = k.value
        where k.profile_id = p.id and k.kind = 'phone' and s.state = 'opted_out') x) consent,
    p.first_seen, p.last_seen,
    (select count(*)::int from profile_keys k where k.profile_id = p.id) keys,
    (select count(*)::int from profile_traits t where t.profile_id = p.id) traits,
    (select count(*)::int from profile_merges m where m.into_id = p.id) merged
  from profiles p
  where p.merged_into is null);--> statement-breakpoint
CREATE VIEW "public"."profile_trait_activity" AS (
  select e.profile_id || ':' || e.key trait, e.id seq, e.at, e.source::text kind,
    coalesce(e.old::text, 'none') || ' to ' || e.new::text what
  from profile_trait_events e);--> statement-breakpoint
CREATE VIEW "public"."profile_trait_records" AS (
  select t.profile_id || ':' || t.key id, t.profile_id, t.key::text,
    case jsonb_typeof(t.value) when 'string' then t.value #>> '{}' else t.value::text end "value",
    t.source::text, t.at,
    (select count(*)::int from profile_trait_events e
      where e.profile_id = t.profile_id and e.key = t.key) changes,
    '/people/people/' || t.profile_id profile_link
  from profile_traits t);--> statement-breakpoint
CREATE VIEW "public"."reactivation_people" AS (
  with latest as (
    select distinct on (c.person_id) c.person_id, c.company_id, c.email, c.owner,
      c.last_contacted_on, c.last_placement_on
    from crm_contacts c order by c.person_id, c.id desc),
  subjects as (
    select l.*, (with r as (select distinct on (f.via) f.id, f.via, f.kind, f.value, f.confidence, f.observed_at
    from findings f where f.person_id = l.person_id
      and f.kind in ('still_there', 'job_change', 'left')
    order by f.via, f.confidence desc, f.observed_at desc, f.id desc),
    n as (select count(*) filter (where kind = 'still_there') there,
      count(*) filter (where kind <> 'still_there') gone from r)
    select r.id from r, n
    where case when n.there > n.gone then r.kind = 'still_there'
      when n.gone > n.there then r.kind <> 'still_there'
      else exists (select 1 from unit_holds h where h.stage = 'reactivation.where'
    and h.subject = 'person:' || l.person_id and h.released_at is not null
    and h.released_by <> 'checks') end
    order by r.confidence desc, r.observed_at desc, r.id desc limit 1) where_id, (select h.id from company_checks k join findings h on h.id = k.finding_id
    where k.company_id = l.company_id and h.observed_at > now() - interval '30 days') hiring_id,
      (with r as (select distinct on (f.via) f.id, f.via, f.kind, f.value, f.confidence, f.observed_at
    from findings f where f.person_id = l.person_id
      and f.kind in ('still_there', 'job_change', 'left')
    order by f.via, f.confidence desc, f.observed_at desc, f.id desc)
    select jsonb_agg(jsonb_build_object('id', r.id, 'via', r.via, 'kind', r.kind, 'value', r.value)
      order by r.kind = 'still_there' desc, r.id)
    from r
    having count(*) > 0
      and count(*) filter (where kind = 'still_there') = count(*) filter (where kind <> 'still_there')
      and not exists (select 1 from unit_holds h where h.stage = 'reactivation.where'
    and h.subject = 'person:' || l.person_id and h.released_at is not null
    and h.released_by <> 'checks')) is not null conflicted
    from latest l)
  select s.person_id id,
    coalesce(nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''), p.full_name, '(no name)') "name",
    p.title, coalesce(co.name, co.domain, '?') company, co.domain,
    case when s.conflicted then 'conflict' when w.kind = 'job_change' then 'moved'
      when w.kind = 'left' then 'left' when s.hiring_id is not null then 'hiring' when w.kind = 'still_there' then 'there'
      else 'unknown' end "now",
    sc.score, sc.next_step,
    greatest(s.last_contacted_on::timestamptz,
      (select max(k.called_at) from calls k where k.person_id = s.person_id)) last_contact,
    s.last_placement_on::timestamptz last_placement, s.owner,
    case when w.kind = 'job_change' then
      (select v.result from mover_addresses m join verifications v on v.contact_candidate_id = m.candidate_id
        where m.finding_id = s.where_id and m.outcome = 'found'
        order by v.checked_at desc, v.id desc limit 1)
    else
      (select v.result from contact_candidates cc join verifications v on v.contact_candidate_id = cc.id
        where cc.evidence = 'crm' and lower(cc.email) = lower(s.email)
        order by v.checked_at desc, v.id desc limit 1) end email,
    sc.reasons->0->>'reason' reason,
    case when b.state = 'written' and sc.score > 0 then b.text end brief,
    (select '/people/people/' || pk.profile_id from profile_keys pk
      where pk.kind = 'person' and pk.value = s.person_id::text) profile
  from subjects s
  join people p on p.id = s.person_id
  join companies co on co.id = s.company_id
  left join findings w on w.id = s.where_id
  left join contact_scores sc on sc.person_id = s.person_id
  left join briefs b on b.person_id = s.person_id);