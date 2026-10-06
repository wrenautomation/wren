CREATE TABLE "company_event_checks" (
	"company_id" integer NOT NULL,
	"state" varchar(16) NOT NULL,
	"events" integer DEFAULT 0 NOT NULL,
	"tried" jsonb NOT NULL,
	"retry_at" timestamp with time zone,
	"run_id" uuid,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_company_event_checks" PRIMARY KEY("company_id"),
	CONSTRAINT "ck_company_event_checks_state" CHECK (("state")::text = ANY ((ARRAY['found'::character varying, 'none'::character varying, 'unresolved'::character varying, 'capped'::character varying])::text[]))
);
--> statement-breakpoint
DROP VIEW "public"."reactivation_people";--> statement-breakpoint
ALTER TABLE "company_event_checks" ADD CONSTRAINT "fk_company_event_checks_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_event_checks" ADD CONSTRAINT "fk_company_event_checks_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_company_event_checks_run_id" ON "company_event_checks" USING btree ("run_id");--> statement-breakpoint
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
    case when b.state = 'written' and sc.score > 0 then b.text end brief
  from subjects s
  join people p on p.id = s.person_id
  join companies co on co.id = s.company_id
  left join findings w on w.id = s.where_id
  left join contact_scores sc on sc.person_id = s.person_id
  left join briefs b on b.person_id = s.person_id);