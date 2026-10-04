/**
 * The SQL views behind the portal's record types (`./records.ts`), one row per record, in every
 * client database through the migrations. They read the same fragments as the portal's pages
 * (`whereFinding`, `hiringFinding`), so a change there regenerates these views' migration.
 */
import { sql } from "drizzle-orm";
import { integer, pgView, real, text, timestamp } from "drizzle-orm/pg-core";
import { hiringFinding, whereFinding } from "../score.js";

const NAME = (p: string) =>
  sql.raw(`nullif(concat_ws(' ', nullif(${p}.first_name, ''), nullif(${p}.last_name, '')), '')`);

/**
 * Each CRM person with their latest row. `now` is the first that holds: moved, left, their firm
 * hiring, still there, unknown.
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
  brief: text("brief"),
}).as(sql`
  with latest as (
    select distinct on (c.person_id) c.person_id, c.company_id, c.email, c.owner,
      c.last_contacted_on, c.last_placement_on
    from crm_contacts c order by c.person_id, c.id desc),
  subjects as (
    select l.*, ${whereFinding(sql`l.person_id`)} where_id, ${hiringFinding(sql`l.company_id`)} hiring_id
    from latest l)
  select s.person_id id,
    coalesce(${NAME("p")}, p.full_name, '(no name)') "name",
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
  where f.person_id is not null`);
