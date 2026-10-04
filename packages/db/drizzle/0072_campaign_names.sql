DROP VIEW "public"."email_campaign_records";--> statement-breakpoint
DROP VIEW "public"."email_firm_records";--> statement-breakpoint
DROP VIEW "public"."email_reply_records";--> statement-breakpoint
CREATE VIEW "public"."email_campaign_records" AS (
  select e.niche::text id, upper(left(e.niche::text, 1)) || replace(substr(e.niche::text, 2), '_', ' ') "name", count(*) enrolled,
    count(*) filter (where s.openers > 0) reached,
    coalesce(sum(s.openers + s.followups), 0)::bigint sent,
    count(*) filter (where i.replies > 0) replies,
    count(*) filter (where i.interested > 0) interested,
    coalesce(sum(i.bounces), 0)::bigint bounces,
    max(s.last_sent) last_sent
  from enrollments e
  left join (
    select m.enrollment_id, count(*) filter (where m.step = 0) openers,
      count(*) filter (where m.step > 0) followups, max(m.sent_at) last_sent
    from messages m where m.state = 'sent' group by m.enrollment_id) s on s.enrollment_id = e.id
  left join (
    select t.enrollment_id, count(*) filter (where t.kind = 'reply') replies,
      count(*) filter (where t.disposition in ('interested', 'meeting_booked')) interested,
      count(*) filter (where t.kind = 'bounce' and t.bounce_class = 'hard') bounces
    from thread_events t group by t.enrollment_id) i on i.enrollment_id = e.id
  group by e.niche);--> statement-breakpoint
CREATE VIEW "public"."email_firm_records" AS (
  select c.id, coalesce(c.name, c.domain, '?')::text "name", c.domain::text domain,
    c.niche::text niche, upper(left(c.niche::text, 1)) || replace(substr(c.niche::text, 2), '_', ' ') campaign,
    case when c.decline_reason is not null then 'declined' when l.first is not null then 'lead'
      when p.first is not null then 'named' when d.first is not null then 'crawled'
      when c.domain is not null then 'domain' else 'found' end stage,
    c.decline_reason::text declined, c.created_at added, d.first crawled, p.first named,
    l.first lead
  from companies c
  left join (select company_id, min(fetched_at) first from documents group by company_id) d
    on d.company_id = c.id
  left join (select company_id, min(created_at) first from people group by company_id) p
    on p.company_id = c.id
  left join (
    select company_id, min(created_at) first from leads
    where status = 'verified' and first_name is not null group by company_id) l
    on l.company_id = c.id
  where c.niche is not null);--> statement-breakpoint
CREATE VIEW "public"."email_reply_records" AS (
  select ci.id, ci.state::text state,
    coalesce(nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''),
      p.full_name, te.from_address, ci.email)::text who,
    co.name::text company, co.domain::text domain, ci.email::text email, te.subject,
    coalesce(te.body_text, te.snippet) words, m.body draft, ci.start, ci.time_zone::text time_zone,
    ci.detail, e.niche::text niche, upper(left(e.niche::text, 1)) || replace(substr(e.niche::text, 2), '_', ' ') campaign,
    coalesce(te.received_at, ci.created_at) received
  from call_invites ci
  join thread_events te on te.id = ci.thread_event_id
  left join messages m on m.id = ci.reply_message_id
  left join enrollments e on e.id = ci.enrollment_id
  left join people p on p.id = e.person_id
  left join companies co on co.id = e.company_id);