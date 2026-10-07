DROP VIEW "public"."email_candidate_records";--> statement-breakpoint
DROP VIEW "public"."email_allele_records";--> statement-breakpoint
DROP VIEW "public"."email_campaign_records";--> statement-breakpoint
DROP VIEW "public"."email_experiment_records";--> statement-breakpoint
DROP VIEW "public"."email_firm_records";--> statement-breakpoint
DROP VIEW "public"."email_reply_records";--> statement-breakpoint
CREATE VIEW "public"."email_allele_records" AS (
  select a.id, a.experiment_id, e.template::text experiment, e.niche::text niche,
    a.locus::text locus,
    a.allele::text allele, a.text, a.state::text state, a.origin::text origin,
    a.angle::text angle, a.judge_score, j.detail->>'reason' reason,
    coalesce((s.stats->a.locus->a.allele->>'exposures')::int, 0) exposures,
    coalesce((s.stats->a.locus->a.allele->>'replies')::int, 0) replies,
    coalesce((s.stats->a.locus->a.allele->>'interested')::int, 0) interested,
    case when a.state = 'live' then (s.shares->a.locus->>a.allele)::float8 end share,
    (s.p_best->a.locus->>a.allele)::float8 p_best,
    replace(a.retired_reason::text, '_', ' ') retired_reason, a.decided_by::text decided_by,
    a.decided_at decided, a.created_at created
  from experiment_alleles a
  join experiments e on e.id = a.experiment_id
  left join experiment_journal j on j.id = a.journal_id
  left join lateral (
    select generation, taken_at, stats, shares, p_best from experiment_snapshots
    where experiment_id = e.id order by generation desc limit 1) s on true);--> statement-breakpoint
CREATE VIEW "public"."email_campaign_records" AS (
  select e.niche::text id, count(*) enrolled,
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
CREATE VIEW "public"."email_candidate_records" AS (
  select r.id, r.experiment_id, r.experiment, r.niche, r.locus, r.text, r.state, r.origin, r.angle,
    r.judge_score, r.reason, r.decided_by, r.decided, r.created
  from email_allele_records r
  join experiment_alleles a on a.id = r.id
  join experiment_journal j on j.id = a.journal_id and j.kind = 'candidate');--> statement-breakpoint
CREATE VIEW "public"."email_experiment_records" AS (
  select e.id, e.niche::text niche, e.template::text template,
    e.state::text state, replace(e.stop_reason::text, '_', ' ') stop_reason,
    e.settings->>'selection' selection, replace(e.settings->>'fitness', '_', ' ') fitness,
    coalesce(s.generation, 0) generation, a.loci, a.live, a.waiting, a.retired,
    s.taken_at last_tick, e.started_at started
  from experiments e
  left join lateral (
    select generation, taken_at, stats, shares, p_best from experiment_snapshots
    where experiment_id = e.id order by generation desc limit 1) s on true
  left join lateral (
    select count(distinct x.locus) loci, count(*) filter (where x.state = 'live') live,
      count(*) filter (where x.state = 'candidate') waiting,
      count(*) filter (where x.state = 'retired') retired
    from experiment_alleles x where x.experiment_id = e.id) a on true);--> statement-breakpoint
CREATE VIEW "public"."email_firm_records" AS (
  select c.id, coalesce(c.name, c.domain, '?')::text "name", c.domain::text domain,
    c.niche::text niche,
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
    ci.detail, e.niche::text niche,
    coalesce(te.received_at, ci.created_at) received
  from call_invites ci
  join thread_events te on te.id = ci.thread_event_id
  left join messages m on m.id = ci.reply_message_id
  left join enrollments e on e.id = ci.enrollment_id
  left join people p on p.id = e.person_id
  left join companies co on co.id = e.company_id);