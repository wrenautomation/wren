CREATE VIEW "public"."reactivation_emails" AS (
  select e.id, e.person_id person, coalesce(nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''), p.full_name, e.to_email) "name",
    coalesce(co.name, co.domain) company, co.domain,
    (select s.subject from messages s where s.enrollment_id = e.id and s.step = 0
      order by s.id desc limit 1) subject,
    case when e.state = 'stopped' and e.stop_reason = 'manual' and m.sent = 0 then 'skipped'
      when m.sent > 0 then 'sent' when e.state = 'stopped' then 'stopped'
      when m.drafts > 0 then 'awaiting' else 'approved' end status,
    e.stop_reason, m.sent, m.approved_by, e.created_at written, m.last_sent_at last_sent
  from enrollments e
  join lateral (
    select count(*) filter (where state = 'sent')::int sent,
      count(*) filter (where state = 'draft')::int drafts,
      max(sent_at) last_sent_at,
      max(approved_by) filter (where step = 0) approved_by
    from messages where enrollment_id = e.id) m on true
  left join people p on p.id = e.person_id
  left join companies co on co.id = e.company_id
  where e.niche = 'reactivation');--> statement-breakpoint
CREATE VIEW "public"."reactivation_findings" AS (
  select f.id, f.kind, f.person_id person,
    coalesce(nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''), p.full_name, co.name, co.domain, '?') subject,
    f.via, d.title, coalesce(f.source_url, d.url) url, f.confidence, f.observed_at observed
  from findings f
  left join people p on p.id = f.person_id
  left join companies co on co.id = f.company_id
  left join documents d on d.id = f.document_id
  where f.person_id in (select person_id from crm_contacts)
    or f.company_id in (select company_id from crm_contacts));--> statement-breakpoint
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
    sc.score, sc.next_step, s.last_contacted_on::timestamptz last_contact,
    s.last_placement_on::timestamptz last_placement, s.owner,
    (select v.result from contact_candidates cc join verifications v on v.contact_candidate_id = cc.id
      where cc.evidence = 'crm' and lower(cc.email) = lower(s.email)
      order by v.checked_at desc, v.id desc limit 1) email,
    case when b.state = 'written' and sc.score > 0 then b.text end brief
  from subjects s
  join people p on p.id = s.person_id
  join companies co on co.id = s.company_id
  left join findings w on w.id = s.where_id
  left join contact_scores sc on sc.person_id = s.person_id
  left join briefs b on b.person_id = s.person_id);--> statement-breakpoint
CREATE VIEW "public"."reactivation_person_activity" AS (
  select e.person_id person, m.sent_at at, 'sent' kind, coalesce(m.subject, '(no subject)') what
  from messages m join enrollments e on e.id = m.enrollment_id
  where m.state = 'sent' and e.niche = 'reactivation' and e.person_id is not null
  union all
  select e.person_id, t.received_at, t.kind, coalesce(t.subject, t.kind)
  from thread_events t join enrollments e on e.id = t.enrollment_id
  where t.kind <> 'note' and e.niche = 'reactivation' and e.person_id is not null
  union all
  select f.person_id, f.observed_at, f.kind, concat_ws(' · ', f.via, d.title)
  from findings f left join documents d on d.id = f.document_id
  where f.person_id is not null);