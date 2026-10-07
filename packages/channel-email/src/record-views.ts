/**
 * The SQL views behind the console's email records (`./records.ts`), one row per record. The
 * roster and the send policy aren't in the database: an inbox is built from them in code, and a
 * campaign's state and kill switch are merged onto its row there.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  doublePrecision,
  integer,
  pgView,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Which month a row's `month` is, against today: "This month" is a static saved view. */
const AGE = sql.raw(`case when month = date_trunc('month', current_date)::date then 'this_month'
    when month = (date_trunc('month', current_date) - interval '1 month')::date then 'last_month'
    else 'earlier' end`);

// A campaign is its niche key ("sec_ria"); its records show the niche's label ("SEC RIA").

/** Each campaign (niche): who it enrolled and reached, what went out, who answered. */
export const emailCampaignRecords = pgView("email_campaign_records", {
  id: text("id"),
  enrolled: bigint("enrolled", { mode: "number" }),
  reached: bigint("reached", { mode: "number" }),
  sent: bigint("sent", { mode: "number" }),
  replies: bigint("replies", { mode: "number" }),
  interested: bigint("interested", { mode: "number" }),
  bounces: bigint("bounces", { mode: "number" }),
  lastSent: timestamp("last_sent", { withTimezone: true }),
}).as(sql`
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
  group by e.niche`);

/** Each warm reply with a call invite: who, their words, the drafted answer, where it stands. */
export const emailReplyRecords = pgView("email_reply_records", {
  id: integer("id"),
  state: text("state"),
  who: text("who"),
  company: text("company"),
  domain: text("domain"),
  email: text("email"),
  subject: text("subject"),
  words: text("words"),
  draft: text("draft"),
  start: timestamp("start", { withTimezone: true }),
  timeZone: text("time_zone"),
  detail: text("detail"),
  niche: text("niche"),
  received: timestamp("received", { withTimezone: true }),
}).as(sql`
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
  left join companies co on co.id = e.company_id`);

/** A reply's thread: what we sent on its enrollment and everything that came back. */
export const emailReplyThread = pgView("email_reply_thread", {
  replyId: integer("reply_id"),
  at: timestamp("at", { withTimezone: true }),
  kind: text("kind"),
  what: text("what"),
}).as(sql`
  select ci.id reply_id, m.sent_at at, 'sent' kind,
    case when m.step = 0 then 'Opener' else 'Follow-up ' || m.step end
      || coalesce(': ' || m.subject, '') what
  from call_invites ci join messages m on m.enrollment_id = ci.enrollment_id
  where m.state = 'sent'
  union all
  select ci.id, t.received_at, t.kind::text, coalesce(t.snippet, t.subject, '')
  from call_invites ci join thread_events t on t.enrollment_id = ci.enrollment_id
  where t.kind <> 'note'`);

/**
 * Each firm in a campaign, with when it passed each pipeline stage. The stages read as
 * `pipeline_funnel` counts them, so a funnel number opens the firms behind it.
 */
export const emailFirmRecords = pgView("email_firm_records", {
  id: integer("id"),
  name: text("name"),
  domain: text("domain"),
  niche: text("niche"),
  stage: text("stage"),
  declined: text("declined"),
  added: timestamp("added", { withTimezone: true }),
  crawled: timestamp("crawled", { withTimezone: true }),
  named: timestamp("named", { withTimezone: true }),
  lead: timestamp("lead", { withTimezone: true }),
}).as(sql`
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
  where c.niche is not null`);

/** Model calls and tokens per month, kind and model, aged against this month. */
export const emailModelRecords = pgView("email_model_records", {
  id: text("id"),
  month: date("month"),
  kind: text("kind"),
  model: text("model"),
  provider: text("provider"),
  calls: bigint("calls", { mode: "number" }),
  inputTokens: bigint("input_tokens", { mode: "number" }),
  outputTokens: bigint("output_tokens", { mode: "number" }),
  rejectedCalls: bigint("rejected_calls", { mode: "number" }),
  parseFailures: bigint("parse_failures", { mode: "number" }),
  age: text("age"),
}).as(sql`
  select concat_ws('/', month, kind, model, provider) id, *, ${AGE} age
  from (
    select date_trunc('month', c.created_at)::date "month", c.kind::text kind,
      c.model::text model, c.provider::text provider, count(*) calls,
      sum(c.input_tokens)::bigint input_tokens, sum(c.output_tokens)::bigint output_tokens,
      count(*) filter (where c.rejected) rejected_calls,
      count(*) filter (where c.parse_failed) parse_failures
    from email_llm_calls c group by 1, 2, 3, 4) u`);

/** An experiment's newest snapshot, joined lateral on `e`. */
const NEWEST = sql.raw(`left join lateral (
    select generation, taken_at, stats, shares, p_best from experiment_snapshots
    where experiment_id = e.id order by generation desc limit 1) s on true`);

/** Each copy experiment: where it stands, its newest generation, its alleles by state. */
export const emailExperimentRecords = pgView("email_experiment_records", {
  id: integer("id"),
  niche: text("niche"),
  template: text("template"),
  state: text("state"),
  stopReason: text("stop_reason"),
  selection: text("selection"),
  fitness: text("fitness"),
  generation: integer("generation"),
  loci: bigint("loci", { mode: "number" }),
  live: bigint("live", { mode: "number" }),
  waiting: bigint("waiting", { mode: "number" }),
  retired: bigint("retired", { mode: "number" }),
  lastTick: timestamp("last_tick", { withTimezone: true }),
  started: timestamp("started", { withTimezone: true }),
}).as(sql`
  select e.id, e.niche::text niche, e.template::text template,
    e.state::text state, replace(e.stop_reason::text, '_', ' ') stop_reason,
    e.settings->>'selection' selection, replace(e.settings->>'fitness', '_', ' ') fitness,
    coalesce(s.generation, 0) generation, a.loci, a.live, a.waiting, a.retired,
    s.taken_at last_tick, e.started_at started
  from experiments e
  ${NEWEST}
  left join lateral (
    select count(distinct x.locus) loci, count(*) filter (where x.state = 'live') live,
      count(*) filter (where x.state = 'candidate') waiting,
      count(*) filter (where x.state = 'retired') retired
    from experiment_alleles x where x.experiment_id = e.id) a on true`);

/**
 * Each allele of each experiment, with its counts, share and P(best) as of the newest
 * snapshot, and for a model-written one the strategist's reason.
 */
export const emailAlleleRecords = pgView("email_allele_records", {
  id: integer("id"),
  experimentId: integer("experiment_id"),
  experiment: text("experiment"),
  niche: text("niche"),
  locus: text("locus"),
  allele: text("allele"),
  text: text("text"),
  state: text("state"),
  origin: text("origin"),
  angle: text("angle"),
  judgeScore: doublePrecision("judge_score"),
  reason: text("reason"),
  exposures: integer("exposures"),
  replies: integer("replies"),
  interested: integer("interested"),
  share: doublePrecision("share"),
  pBest: doublePrecision("p_best"),
  retiredReason: text("retired_reason"),
  decidedBy: text("decided_by"),
  decided: timestamp("decided", { withTimezone: true }),
  created: timestamp("created", { withTimezone: true }),
}).as(sql`
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
  ${NEWEST}`);

/** What the model wrote: candidates waiting on William, and the ones he decided. */
export const emailCandidateRecords = pgView("email_candidate_records", {
  id: integer("id"),
  experimentId: integer("experiment_id"),
  experiment: text("experiment"),
  niche: text("niche"),
  locus: text("locus"),
  text: text("text"),
  state: text("state"),
  origin: text("origin"),
  angle: text("angle"),
  judgeScore: doublePrecision("judge_score"),
  reason: text("reason"),
  decidedBy: text("decided_by"),
  decided: timestamp("decided", { withTimezone: true }),
  created: timestamp("created", { withTimezone: true }),
}).as(sql`
  select r.id, r.experiment_id, r.experiment, r.niche, r.locus, r.text, r.state, r.origin, r.angle,
    r.judge_score, r.reason, r.decided_by, r.decided, r.created
  from email_allele_records r
  join experiment_alleles a on a.id = r.id
  join experiment_journal j on j.id = a.journal_id and j.kind = 'candidate'`);

/** An experiment's journal, one line per event, newest first in the panel. */
export const emailExperimentJournal = pgView("email_experiment_journal", {
  experimentId: integer("experiment_id"),
  at: timestamp("at", { withTimezone: true }),
  kind: text("kind"),
  what: text("what"),
}).as(sql`
  select j.experiment_id, j.created_at at, j.kind::text kind,
    coalesce(j.locus || ': ', '') || case j.kind
      when 'start' then 'Started'
      when 'seed' then 'Seeded ' || replace(coalesce(j.detail->>'seeding', ''), '_', ' ')
      when 'snapshot' then 'Generation ' || j.generation || ' counted'
      when 'strategist' then 'Plan ' || (j.detail->>'mode') || ' on '
        || coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(j.detail->'loci') x), 'nothing')
        || coalesce('. ' || (j.detail->>'reason'), '')
      when 'check' then (j.detail->>'written') || ' written, '
        || coalesce(jsonb_array_length(j.detail->'dropped'), 0) || ' dropped'
        || coalesce('. ' || (j.detail->>'error'), '')
      when 'judge' then jsonb_array_length(j.detail->'scores') || ' scored'
      when 'candidate' then 'Candidate "' || (j.detail->>'text') || '"'
      when 'approve' then 'Approved "' || (j.detail->>'text') || '" by ' || (j.detail->>'by')
      when 'edit' then 'Edited to "' || (j.detail->>'text') || '" by ' || (j.detail->>'by')
      when 'reject' then 'Rejected "' || (j.detail->>'text') || '" by ' || (j.detail->>'by')
      when 'retire' then 'Retired ' || coalesce(j.detail->>'allele', 'options')
        || ' (' || replace(coalesce(j.detail->>'reason', ''), '_', ' ') || ')'
      when 'settle' then 'Settled on ' || coalesce(j.detail->>'allele', 'nothing')
      when 'switch' then (j.detail->>'key') || ' set to ' || (j.detail->'to')::text
      when 'import' then 'Imported a file edit'
      when 'stop' then 'Stopped (' || replace(coalesce(j.detail->>'reason', ''), '_', ' ') || ')'
      when 'pause' then 'Paused'
      when 'resume' then 'Resumed'
      else j.kind end what
  from experiment_journal j`);
