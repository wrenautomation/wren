CREATE VIEW "public"."client_records" AS (
  select c.id::text id, c.name, case when c.demo then 'demo' else 'client' end kind,
    (select string_agg(k, ', ' order by k) from jsonb_object_keys(c.products) k) products,
    (select count(*) from client_members m where m.client_id = c.id) members,
    (select max(m.last_seen_at) from client_members m where m.client_id = c.id) last_seen,
    c.created_at added
  from clients c);--> statement-breakpoint
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
CREATE VIEW "public"."email_model_records" AS (
  select concat_ws('/', month, kind, model, provider) id, *, case when month = date_trunc('month', current_date)::date then 'this_month'
    when month = (date_trunc('month', current_date) - interval '1 month')::date then 'last_month'
    else 'earlier' end age
  from (
    select date_trunc('month', c.created_at)::date "month", c.kind::text kind,
      c.model::text model, c.provider::text provider, count(*) calls,
      sum(c.input_tokens)::bigint input_tokens, sum(c.output_tokens)::bigint output_tokens,
      count(*) filter (where c.rejected) rejected_calls,
      count(*) filter (where c.parse_failed) parse_failures
    from email_llm_calls c group by 1, 2, 3, 4) u);--> statement-breakpoint
CREATE VIEW "public"."email_reply_records" AS (
  select ci.id, ci.state::text state,
    coalesce(nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''),
      p.full_name, te.from_address, ci.email)::text who,
    co.name::text company, co.domain::text domain, ci.email::text email, te.subject,
    coalesce(te.body_text, te.snippet) words, m.body draft, ci.start, ci.time_zone::text time_zone,
    ci.detail, e.niche::text niche, coalesce(te.received_at, ci.created_at) received
  from call_invites ci
  join thread_events te on te.id = ci.thread_event_id
  left join messages m on m.id = ci.reply_message_id
  left join enrollments e on e.id = ci.enrollment_id
  left join people p on p.id = e.person_id
  left join companies co on co.id = e.company_id);--> statement-breakpoint
CREATE VIEW "public"."email_reply_thread" AS (
  select ci.id reply_id, m.sent_at at, 'sent' kind,
    case when m.step = 0 then 'Opener' else 'Follow-up ' || m.step end
      || coalesce(': ' || m.subject, '') what
  from call_invites ci join messages m on m.enrollment_id = ci.enrollment_id
  where m.state = 'sent'
  union all
  select ci.id, t.received_at, t.kind::text, coalesce(t.snippet, t.subject, '')
  from call_invites ci join thread_events t on t.enrollment_id = ci.enrollment_id
  where t.kind <> 'note');--> statement-breakpoint
CREATE VIEW "books"."spend_records" AS (
    select concat_ws('/', s.month, s.account, s.vendor) id, s.month,
      coalesce(s.account_name, s.account)::text account, s.t2125_line::text t2125_line,
      coalesce(s.vendor_name, s.vendor)::text vendor, s.cad_cents / 100.0 amount,
      'CAD' currency,
      case when s.month = date_trunc('month', current_date)::date then 'this_month'
        when s.month = (date_trunc('month', current_date) - interval '1 month')::date then 'last_month'
        else 'earlier' end age
    from books.spend s);--> statement-breakpoint
CREATE VIEW "books"."subscription_records" AS (
    select concat_ws('/', s.vendor_id, lower(coalesce(s.plan, '')), s.cycle, s.last_billed_on) id,
      coalesce(s.vendor_name, s.vendor)::text vendor, s.plan, s.cycle::text cycle,
      s.last_total_cents / 100.0 cost, s.currency::text currency,
      s.monthly_cad_cents / 100.0 monthly, 'CAD' cad, s.last_billed_on, s.renews_on,
      case when s.renews_on < current_date then 'past'
        when s.renews_on < current_date + 30 then 'soon' else 'later' end renewal,
      s.since, s.bills
    from books.subscriptions s);