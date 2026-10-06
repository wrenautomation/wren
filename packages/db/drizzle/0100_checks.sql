CREATE TABLE "check_outcomes" (
	"id" serial NOT NULL,
	"stage" varchar(64) NOT NULL,
	"source" varchar(64) NOT NULL,
	"check" varchar(120) NOT NULL,
	"subject" varchar(200),
	"ok" boolean NOT NULL,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_check_outcomes" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "unit_holds" (
	"id" serial NOT NULL,
	"stage" varchar(64) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"reason" text NOT NULL,
	"held_at" timestamp with time zone DEFAULT now() NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"tries" integer DEFAULT 1 NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" varchar(320),
	CONSTRAINT "pk_unit_holds" PRIMARY KEY("id"),
	CONSTRAINT "uq_unit_holds_stage_subject" UNIQUE("stage","subject")
);
--> statement-breakpoint
DROP VIEW "public"."reactivation_people";--> statement-breakpoint
CREATE INDEX "ix_check_outcomes_stage_source" ON "check_outcomes" USING btree ("stage","source","id");--> statement-breakpoint
CREATE VIEW "public"."check_rates" AS (
  select o.stage || ' ' || o.source || ' ' || o."check" id, o.stage, o.source, o."check",
    count(*)::int total, count(*) filter (where o.ok)::int passed,
    avg(o.ok::int)::real rate, max(o.at) last_at,
    case when exists (select 1 from unit_holds h where h.stage = o.stage
      and h.subject = 'source:' || o.source and h.released_at is null) then 'paused' else 'on' end state
  from check_outcomes o where o.at > now() - interval '30 days'
  group by o.stage, o.source, o."check");--> statement-breakpoint
CREATE VIEW "public"."unit_holds_now" AS (
  select id, stage, subject, reason,
    case when released_at is not null then 'released' when subject like 'source:%' then 'paused'
      when until = 'infinity' then 'stuck' when until > now() then 'held' else 'due' end state,
    held_at, nullif(until, 'infinity') until, tries, released_at, released_by
  from unit_holds);--> statement-breakpoint
CREATE VIEW "public"."reactivation_people" AS (
  with latest as (
    select distinct on (c.person_id) c.person_id, c.company_id, c.email, c.owner,
      c.last_contacted_on, c.last_placement_on
    from crm_contacts c order by c.person_id, c.id desc),
  subjects as (
    select l.*, (with r as (select distinct on (f.via) f.id, f.via, f.kind, f.value, f.confidence, f.observed_at
    from findings f where f.person_id = l.person_id
      and f.kind in ('still_there', 'job_change', 'left')
    order by f.via, f.observed_at desc, f.id desc),
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
    order by f.via, f.observed_at desc, f.id desc)
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
    case when b.state = 'written' and sc.score > 0 then b.text end brief
  from subjects s
  join people p on p.id = s.person_id
  join companies co on co.id = s.company_id
  left join findings w on w.id = s.where_id
  left join contact_scores sc on sc.person_id = s.person_id
  left join briefs b on b.person_id = s.person_id);