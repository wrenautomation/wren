CREATE VIEW "public"."reactivation_replies" AS (
  select t.id, e.person_id person, coalesce(nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''), p.full_name, e.to_email) "name",
    coalesce(co.name, co.domain) company, co.domain, t.subject,
    case when h.meeting_booked_at is not null then 'booked'
      when t.disposition in ('interested', 'meeting_booked') then 'warm' else 'other' end status,
    t.disposition, h.recruiter_email handed_to, t.received_at received,
    h.meeting_booked_at booked
  from thread_events t
  join enrollments e on e.id = t.enrollment_id
  left join handoffs h on h.thread_event_id = t.id
  left join people p on p.id = e.person_id
  left join companies co on co.id = e.company_id
  where t.kind = 'reply' and e.niche = 'reactivation');