CREATE VIEW "public"."template_stats" AS (
  with sent as (
    select 'email'::text kind, e.niche::text system, m.template::text template,
      m.template_version::text version, m.provenance -> 'picks' picks, m.sent_at,
      exists (select 1 from thread_events te where te.enrollment_id = m.enrollment_id
        and te.kind = 'reply' and te.received_at >= m.sent_at) replied,
      exists (select 1 from thread_events te where te.enrollment_id = m.enrollment_id
          and te.disposition = 'meeting_booked' and te.received_at >= m.sent_at)
        or exists (select 1 from call_invites ci where ci.enrollment_id = m.enrollment_id
          and ci.state in ('booked', 'already_booked') and ci.created_at >= m.sent_at)
        or exists (select 1 from call_bookings cb where cb.enrollment_id = m.enrollment_id
          and cb.state = 'booked' and cb.booked_at >= m.sent_at) booked
    from messages m join enrollments e on e.id = m.enrollment_id
    where m.state = 'sent'
    union all
    select 'sms', 'texts', m.template, m.template_version, m.provenance -> 'picks', m.sent_at,
      exists (select 1 from sms_messages r where r.contact_id = m.contact_id
        and r.direction = 'in' and coalesce(r.received_at, r.created_at) >= m.sent_at),
      null
    from sms_messages m
    where m.direction = 'out' and m.state in ('sent', 'delivered') and m.template is not null
    union all
    select 'dm', 'reach', m.template, m.template_version, m.provenance -> 'picks', m.sent_at,
      exists (select 1 from reach_messages r where r.contact_id = m.contact_id
        and r.direction = 'in' and coalesce(r.sent_at, r.created_at) >= m.sent_at),
      null
    from reach_messages m
    where m.direction = 'out' and m.state = 'sent' and m.template is not null
  )
  select s.kind, s.system, s.template, t.id template_id, s.version, s.picks,
    count(*) sends,
    count(*) filter (where s.replied) replies,
    case when s.kind = 'email' then count(*) filter (where s.booked) end booked,
    max(s.sent_at) last_sent
  from sent s
  left join templates t on t.kind = s.kind and t.system = s.system and t.name = s.template
  group by s.kind, s.system, s.template, t.id, s.version, s.picks
);