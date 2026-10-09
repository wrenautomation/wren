/**
 * The SQL views behind the portal's record types (`./records.ts`), one row per record, in every
 * client database through the migrations. They read the same fragments as the portal's pages
 * (`whereFinding`, `hiringFinding`), so a change there regenerates these views' migration.
 */
import { sql } from "drizzle-orm";
import { integer, pgView, real, text, timestamp } from "drizzle-orm/pg-core";
import { hiringFinding, newsFinding, whereConflict, whereFinding } from "../score.js";

const NAME = (p: string) =>
  sql.raw(`nullif(concat_ws(' ', nullif(${p}.first_name, ''), nullif(${p}.last_name, '')), '')`);

/**
 * Each CRM person with their latest row. `now` is the first that holds: sources disagree, moved,
 * left, their firm hiring, still there, unknown. Last contact is the CRM's or a call marked here, the later one.
 */
export const reactivationPeople = pgView("reactivation_people", {
  id: integer("id"),
  name: text("name"),
  title: text("title"),
  company: text("company"),
  domain: text("domain"),
  now: text("now"),
  score: real("score"),
  nextStep: text("next_step"),
  lastContact: timestamp("last_contact", { withTimezone: true }),
  lastPlacement: timestamp("last_placement", { withTimezone: true }),
  owner: text("owner"),
  email: text("email"),
  /** The score's first reason, the one that counts most: "Moved to Acme 4 months ago". */
  reason: text("reason"),
  brief: text("brief"),
}).as(sql`
  with latest as (
    select distinct on (c.person_id) c.person_id, c.company_id, c.email, c.owner,
      c.last_contacted_on, c.last_placement_on
    from crm_contacts c order by c.person_id, c.id desc),
  subjects as (
    select l.*, ${whereFinding(sql`l.person_id`)} where_id, ${hiringFinding(sql`l.company_id`)} hiring_id,
      ${whereConflict(sql`l.person_id`)} is not null conflicted
    from latest l)
  select s.person_id id,
    coalesce(${NAME("p")}, p.full_name, '(no name)') "name",
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
  left join briefs b on b.person_id = s.person_id`);

/**
 * Each reactivation email pair. Skipped (stopped by hand before a send) comes first and sent
 * next, so a pair that went out and then got a reply still reads as sent.
 */
export const reactivationEmails = pgView("reactivation_emails", {
  id: integer("id"),
  person: integer("person"),
  name: text("name"),
  company: text("company"),
  domain: text("domain"),
  subject: text("subject"),
  status: text("status"),
  stopReason: text("stop_reason"),
  sent: integer("sent"),
  approvedBy: text("approved_by"),
  written: timestamp("written", { withTimezone: true }),
  lastSent: timestamp("last_sent", { withTimezone: true }),
}).as(sql`
  select e.id, e.person_id person, coalesce(${NAME("p")}, p.full_name, e.to_email) "name",
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
  where e.niche = 'reactivation'`);

/**
 * Each reply to a reactivation email. Booked once a meeting came of it, warm when they said
 * they're interested or want a meeting, other for the rest.
 */
export const reactivationReplies = pgView("reactivation_replies", {
  id: integer("id"),
  person: integer("person"),
  name: text("name"),
  company: text("company"),
  domain: text("domain"),
  subject: text("subject"),
  status: text("status"),
  disposition: text("disposition"),
  handedTo: text("handed_to"),
  received: timestamp("received", { withTimezone: true }),
  booked: timestamp("booked", { withTimezone: true }),
}).as(sql`
  select t.id, e.person_id person, coalesce(${NAME("p")}, p.full_name, e.to_email) "name",
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
  where t.kind = 'reply' and e.niche = 'reactivation'`);

/** Every finding about this client's list: its people and their firms. */
export const reactivationFindings = pgView("reactivation_findings", {
  id: integer("id"),
  kind: text("kind"),
  person: integer("person"),
  subject: text("subject"),
  via: text("via"),
  title: text("title"),
  url: text("url"),
  confidence: real("confidence"),
  observed: timestamp("observed", { withTimezone: true }),
}).as(sql`
  select f.id, f.kind, f.person_id person,
    coalesce(${NAME("p")}, p.full_name, co.name, co.domain, '?') subject,
    f.via, d.title, coalesce(f.source_url, d.url) url, f.confidence, f.observed_at observed
  from findings f
  left join people p on p.id = f.person_id
  left join companies co on co.id = f.company_id
  left join documents d on d.id = f.document_id
  where f.person_id in (select person_id from crm_contacts)
    or f.company_id in (select company_id from crm_contacts)`);

/** What happened with one person, for their record's activity: sends, what came back, findings. */
export const reactivationPersonActivity = pgView("reactivation_person_activity", {
  person: integer("person"),
  at: timestamp("at", { withTimezone: true }),
  kind: text("kind"),
  what: text("what"),
}).as(sql`
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
  where f.person_id is not null
  union all
  select k.person_id, k.called_at, 'called', k.called_by from calls k`);

/**
 * Keep (designs/2026-10-07-health.md): each company placed with in the last 24 months, scored
 * for the risk of losing it. Its usual gap is the median between its placement days; with
 * fewer than two, the client's median; with none, 180 days. The champion is the person behind
 * the latest placement. Signal, first that holds: champion left, past the usual gap by 25%
 * (not while a job order is open), hiring again, a form sent on the client's site in 30 days,
 * news in 6 months, open job orders, steady. Risk: champion left 50, past the gap 30, no
 * contact in 6 months 20; hiring, visits, news and orders are reasons to call, not risk.
 */
export const reactivationKeep = pgView("reactivation_keep", {
  id: integer("id"),
  company: text("company"),
  domain: text("domain"),
  champion: text("champion"),
  championId: integer("champion_id"),
  signal: text("signal"),
  risk: integer("risk"),
  why: text("why"),
  lastPlacement: timestamp("last_placement", { withTimezone: true }),
  placements: integer("placements"),
  usualGap: integer("usual_gap"),
  since: integer("since"),
  lastContact: timestamp("last_contact", { withTimezone: true }),
  visited: timestamp("visited", { withTimezone: true }),
  openOrders: integer("open_orders"),
}).as(sql`
  with placed as (
    select company_id, person_id, last_placement_on d from crm_contacts
    where last_placement_on is not null),
  dates as (select distinct company_id, d from placed),
  gaps as (
    select company_id, d - lag(d) over (partition by company_id order by d) gap from dates),
  own as (
    select company_id, percentile_cont(0.5) within group (order by gap) gap from gaps
    where gap is not null group by company_id),
  usual as (
    select percentile_cont(0.5) within group (order by gap) gap from gaps where gap is not null),
  latest as (
    select distinct on (company_id) company_id, person_id champion, d last_placement from placed
    order by company_id, d desc, person_id),
  counts as (select company_id, count(*)::int placements from dates group by company_id),
  cur as (
    select l.company_id, l.champion, l.last_placement, k.placements,
      round(coalesce(o.gap, u.gap, 180))::int usual_gap,
      (current_date - l.last_placement)::int since,
      ${whereFinding(sql`l.champion`)} where_id, ${hiringFinding(sql`l.company_id`)} hiring_id,
      ${newsFinding(sql`l.company_id`, sql`null::int`)} news_id
    from latest l join counts k on k.company_id = l.company_id
    left join own o on o.company_id = l.company_id cross join usual u
    where l.last_placement > current_date - interval '24 months'),
  touched as (
    select c.company_id,
      greatest(max(c.last_contacted_on)::timestamptz, max(k.called_at)) last_contact
    from crm_contacts c left join calls k on k.person_id = c.person_id group by c.company_id),
  visit as (
    select distinct on (company_id) company_id, at visited, what visit_what from account_visits
    where at > now() - interval '30 days' order by company_id, at desc, id desc),
  orders as (
    select company_id, count(*)::int open_orders from job_orders
    where open and company_id is not null group by company_id),
  sig as (
    select cur.*, w.kind where_kind, w.value ->> 'to' moved_to, t.last_contact,
      v.visited, v.visit_what, coalesce(o.open_orders, 0) open_orders,
      cur.since > 1.25 * cur.usual_gap and o.open_orders is null overdue,
      coalesce(w.kind in ('job_change', 'left'), false) gone,
      (select coalesce(n.value ->> 'title', n.value ->> 'event') from findings n
        where n.id = cur.news_id) news
    from cur left join findings w on w.id = cur.where_id
    left join touched t on t.company_id = cur.company_id
    left join visit v on v.company_id = cur.company_id
    left join orders o on o.company_id = cur.company_id)
  select s.company_id id, coalesce(co.name, co.domain, '?') company, co.domain,
    coalesce(${NAME("p")}, p.full_name, '(no name)') champion, s.champion champion_id,
    case when s.gone then 'champion_left' when s.overdue then 'overdue'
      when s.hiring_id is not null then 'hiring' when s.visited is not null then 'visited'
      when s.news_id is not null then 'news' when s.open_orders > 0 then 'orders'
      else 'steady' end signal,
    ((case when s.gone then 50 else 0 end) + (case when s.overdue then 30 else 0 end)
      + (case when s.last_contact is null or s.last_contact < now() - interval '6 months'
        then 20 else 0 end))::int risk,
    case when s.where_kind = 'job_change' then
        coalesce(${NAME("p")}, p.full_name, 'The champion') || ' moved'
          || coalesce(' to ' || s.moved_to, '')
      when s.where_kind = 'left' then coalesce(${NAME("p")}, p.full_name, 'The champion') || ' left'
      when s.overdue then s.since || ' days since the last placement; usually ' || s.usual_gap
      when s.hiring_id is not null then 'Open roles found in the last 30 days'
      when s.visited is not null then 'Filled ' || s.visit_what || ' on your site'
      when s.news_id is not null then coalesce(s.news, 'In the news')
      when s.open_orders > 0 then s.open_orders || case when s.open_orders = 1
        then ' open job order' else ' open job orders' end
      else s.placements || case when s.placements = 1 then ' placement' else ' placements' end
        || ', the last ' || s.since || ' days ago' end why,
    s.last_placement::timestamptz last_placement, s.placements, s.usual_gap, s.since,
    s.last_contact, s.visited, s.open_orders
  from sig s
  join companies co on co.id = s.company_id
  join people p on p.id = s.champion`);
