DROP VIEW "public"."reactivation_people";--> statement-breakpoint
CREATE VIEW "public"."reactivation_people" AS (
  with latest as (
    select distinct on (c.person_id) c.person_id, c.company_id, c.email, c.owner,
      c.last_contacted_on, c.last_placement_on
    from crm_contacts c order by c.person_id, c.id desc),
  subjects as (
    select l.*, (select f.id from findings f where f.person_id = l.person_id
    and f.kind in ('still_there', 'job_change', 'left')
    order by f.confidence desc, f.observed_at desc, f.id desc limit 1) where_id, (select h.id from company_checks k join findings h on h.id = k.finding_id
    where k.company_id = l.company_id and h.observed_at > now() - interval '30 days') hiring_id
    from latest l)
  select s.person_id id,
    coalesce(nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''), p.full_name, '(no name)') "name",
    p.title, coalesce(co.name, co.domain, '?') company, co.domain,
    case when w.kind = 'job_change' then 'moved' when w.kind = 'left' then 'left'
      when s.hiring_id is not null then 'hiring' when w.kind = 'still_there' then 'there'
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