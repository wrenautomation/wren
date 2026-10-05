import { ROLE_LOCALPARTS } from "@wren/core/emails";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  integer,
  numeric,
  pgView,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const emailLlmCalls = pgView("email_llm_calls", {
  enrichmentId: integer("enrichment_id"),
  threadEventId: integer("thread_event_id"),
  runId: uuid("run_id"),
  kind: text("kind"),
  model: text("model"),
  provider: text("provider"),
  promptVersion: text("prompt_version"),
  companyId: integer("company_id"),
  documentId: integer("document_id"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  reasoningTokens: integer("reasoning_tokens"),
  latencyMs: integer("latency_ms"),
  finishReason: text("finish_reason"),
  rejected: boolean("rejected"),
  parseFailed: boolean("parse_failed"),
  hasCallRecord: boolean("has_call_record"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }),
}).as(
  sql`SELECT e.id AS enrichment_id, NULL::integer AS thread_event_id, e.run_id, e.kind::text AS kind, e.model::text AS model, (e.output -> 'call'::text) ->> 'provider'::text AS provider, e.prompt_version::text AS prompt_version, e.company_id, e.document_id, (((e.output -> 'call'::text) -> 'usage'::text) ->> 'input'::text)::integer AS input_tokens, (((e.output -> 'call'::text) -> 'usage'::text) ->> 'output'::text)::integer AS output_tokens, (((e.output -> 'call'::text) -> 'usage'::text) ->> 'total'::text)::integer AS total_tokens, (((e.output -> 'call'::text) -> 'usage'::text) ->> 'reasoning'::text)::integer AS reasoning_tokens, ((e.output -> 'call'::text) ->> 'latency_ms'::text)::integer AS latency_ms, (e.output -> 'call'::text) ->> 'finish_reason'::text AS finish_reason, COALESCE(((e.output -> 'call'::text) ->> 'rejected'::text)::boolean, false) AS rejected, (e.output ->> 'parse_error'::text) IS NOT NULL AS parse_failed, e.output ? 'call'::text AS has_call_record, e.applied_at, e.created_at FROM enrichments e WHERE e.model::text <> 'deterministic'::text AND jsonb_typeof(e.output -> 'call'::text) IS DISTINCT FROM 'null'::text UNION ALL SELECT NULL::integer AS enrichment_id, te.id AS thread_event_id, ((te.classification -> 'call'::text) ->> 'run_id'::text)::uuid AS run_id, 'reply_disposition'::text AS kind, te.classification ->> 'model'::text AS model, (te.classification -> 'call'::text) ->> 'provider'::text AS provider, te.classification ->> 'prompt_version'::text AS prompt_version, en.company_id, NULL::integer AS document_id, (((te.classification -> 'call'::text) -> 'usage'::text) ->> 'input'::text)::integer AS input_tokens, (((te.classification -> 'call'::text) -> 'usage'::text) ->> 'output'::text)::integer AS output_tokens, (((te.classification -> 'call'::text) -> 'usage'::text) ->> 'total'::text)::integer AS total_tokens, (((te.classification -> 'call'::text) -> 'usage'::text) ->> 'reasoning'::text)::integer AS reasoning_tokens, ((te.classification -> 'call'::text) ->> 'latency_ms'::text)::integer AS latency_ms, (te.classification -> 'call'::text) ->> 'finish_reason'::text AS finish_reason, COALESCE(((te.classification -> 'call'::text) ->> 'rejected'::text)::boolean, false) AS rejected, (te.classification ->> 'parse_error'::text) IS NOT NULL AS parse_failed, te.classification ? 'call'::text AS has_call_record, CASE WHEN te.disposition_source::text = 'llm'::text THEN te.classified_at ELSE NULL::timestamp with time zone END AS applied_at, (te.classification ->> 'classified_at'::text)::timestamp with time zone AS created_at FROM thread_events te JOIN enrollments en ON en.id = te.enrollment_id WHERE te.classification IS NOT NULL AND jsonb_typeof(te.classification -> 'call'::text) IS DISTINCT FROM 'null'::text`,
);

export const emailStageCosts = pgView("email_stage_costs", {
  runId: uuid("run_id"),
  command: varchar("command", { length: 64 }),
  niche: varchar("niche", { length: 64 }),
  kind: text("kind"),
  model: text("model"),
  provider: text("provider"),
  calls: bigint("calls", { mode: "number" }),
  rejectedCalls: bigint("rejected_calls", { mode: "number" }),
  parseFailures: bigint("parse_failures", { mode: "number" }),
  inputTokens: bigint("input_tokens", { mode: "number" }),
  outputTokens: bigint("output_tokens", { mode: "number" }),
  totalTokens: bigint("total_tokens", { mode: "number" }),
  reasoningTokens: bigint("reasoning_tokens", { mode: "number" }),
  avgLatencyMs: integer("avg_latency_ms"),
  maxLatencyMs: integer("max_latency_ms"),
  firstCallAt: timestamp("first_call_at", { withTimezone: true }),
  lastCallAt: timestamp("last_call_at", { withTimezone: true }),
}).as(
  sql`SELECT c.run_id, r.command, r.niche, c.kind, c.model, c.provider, count(*) AS calls, count(*) FILTER (WHERE c.rejected) AS rejected_calls, count(*) FILTER (WHERE c.parse_failed) AS parse_failures, sum(c.input_tokens) AS input_tokens, sum(c.output_tokens) AS output_tokens, sum(c.total_tokens) AS total_tokens, sum(c.reasoning_tokens) AS reasoning_tokens, avg(c.latency_ms)::integer AS avg_latency_ms, max(c.latency_ms) AS max_latency_ms, min(c.created_at) AS first_call_at, max(c.created_at) AS last_call_at FROM email_llm_calls c LEFT JOIN runs r ON r.id = c.run_id GROUP BY c.run_id, r.command, r.niche, c.kind, c.model, c.provider`,
);

export const openOutcomes = pgView("open_outcomes", {
  niche: varchar({ length: 32 }),
  sequenceName: varchar("sequence_name", { length: 64 }),
  step: integer("step"),
  template: varchar("template", { length: 64 }),
  trackedSent: bigint("tracked_sent", { mode: "number" }),
  openedRaw: bigint("opened_raw", { mode: "number" }),
  openedHumanPlausible: bigint("opened_human_plausible", { mode: "number" }),
  fetches: numeric("fetches", { mode: "number" }),
  openRateRaw: numeric("open_rate_raw", { mode: "number" }),
  openRateHumanPlausible: numeric("open_rate_human_plausible", { mode: "number" }),
}).as(
  sql`WITH tracked AS ( SELECT m.id, m.sent_at, m.template, e.niche, e.sequence_name, m.step FROM messages m JOIN enrollments e ON e.id = m.enrollment_id WHERE m.state::text = 'sent'::text AND m.open_token IS NOT NULL ), hits AS ( SELECT t_1.id, count(oe.id) AS fetches, count(oe.id) FILTER (WHERE (oe.seen_at - t_1.sent_at) >= '00:02:00'::interval) AS slow_fetches FROM tracked t_1 LEFT JOIN open_events oe ON oe.message_id = t_1.id GROUP BY t_1.id ) SELECT t.niche, t.sequence_name, t.step, t.template, count(*) AS tracked_sent, count(*) FILTER (WHERE h.fetches > 0) AS opened_raw, count(*) FILTER (WHERE h.slow_fetches > 0) AS opened_human_plausible, sum(h.fetches) AS fetches, count(*) FILTER (WHERE h.fetches > 0)::numeric / NULLIF(count(*), 0)::numeric AS open_rate_raw, count(*) FILTER (WHERE h.slow_fetches > 0)::numeric / NULLIF(count(*), 0)::numeric AS open_rate_human_plausible FROM tracked t JOIN hits h ON h.id = t.id GROUP BY t.niche, t.sequence_name, t.step, t.template ORDER BY t.niche, t.sequence_name, t.step`,
);

export const replyByArmStep = pgView("reply_by_arm_step", {
  niche: varchar({ length: 32 }),
  arm: varchar("arm"),
  step: integer("step"),
  template: varchar("template", { length: 64 }),
  templateVersion: varchar("template_version", { length: 12 }),
  sent: bigint("sent", { mode: "number" }),
  replies: bigint("replies", { mode: "number" }),
  interested: bigint("interested", { mode: "number" }),
  hardBounces: bigint("hard_bounces", { mode: "number" }),
  replyRatePct: numeric("reply_rate_pct", { mode: "number" }),
}).as(
  sql`SELECT e.niche, CASE WHEN strpos(o.template::text, '/'::text) > 0 THEN split_part(o.template::text, '/'::text, 1)::character varying ELSE o.template END AS arm, m.step, m.template, m.template_version, count(DISTINCT m.id) FILTER (WHERE m.state::text = 'sent'::text) AS sent, count(DISTINCT te.id) FILTER (WHERE te.kind::text = 'reply'::text) AS replies, count(DISTINCT te.id) FILTER (WHERE te.kind::text = 'reply'::text AND (te.disposition::text = ANY (ARRAY['interested'::character varying, 'meeting_booked'::character varying]::text[]))) AS interested, count(DISTINCT te.id) FILTER (WHERE te.kind::text = 'bounce'::text AND te.bounce_class::text = 'hard'::text) AS hard_bounces, round(100.0 * count(DISTINCT te.id) FILTER (WHERE te.kind::text = 'reply'::text)::numeric / NULLIF(count(DISTINCT m.id) FILTER (WHERE m.state::text = 'sent'::text), 0)::numeric, 2) AS reply_rate_pct FROM messages m JOIN enrollments e ON e.id = m.enrollment_id JOIN messages o ON o.enrollment_id = e.id AND o.step = 0 LEFT JOIN thread_events te ON te.in_reply_to_message_id = m.id GROUP BY e.niche, o.template, m.step, m.template, m.template_version`,
);

export const rejectionsByReason = pgView("rejections_by_reason", {
  niche: varchar({ length: 32 }),
  template: varchar("template", { length: 64 }),
  templateVersion: varchar("template_version", { length: 12 }),
  reason: varchar("reason"),
  rejected: bigint("rejected", { mode: "number" }),
}).as(
  sql`SELECT e.niche, m.template, m.template_version, COALESCE(m.review_reason, 'unspecified'::character varying) AS reason, count(*) AS rejected FROM messages m JOIN enrollments e ON e.id = m.enrollment_id WHERE m.state::text = 'rejected'::text GROUP BY e.niche, m.template, m.template_version, (COALESCE(m.review_reason, 'unspecified'::character varying))`,
);

export const verificationYield = pgView("verification_yield", {
  niche: varchar({ length: 32 }),
  evidence: varchar("evidence", { length: 32 }),
  candidates: bigint("candidates", { mode: "number" }),
  verified: bigint("verified", { mode: "number" }),
  valid: bigint("valid", { mode: "number" }),
  invalid: bigint("invalid", { mode: "number" }),
  risky: bigint("risky", { mode: "number" }),
  catchAll: bigint("catch_all", { mode: "number" }),
  validRatePct: numeric("valid_rate_pct", { mode: "number" }),
}).as(
  sql`WITH newest AS ( SELECT DISTINCT ON (cc_1.id) cc_1.id AS candidate_id, v.result FROM contact_candidates cc_1 JOIN verifications v ON v.contact_candidate_id = cc_1.id OR cc_1.lead_id IS NOT NULL AND v.lead_id = cc_1.lead_id ORDER BY cc_1.id, v.checked_at DESC, v.id DESC ) SELECT c.niche, cc.evidence, count(*) AS candidates, count(n.candidate_id) AS verified, count(*) FILTER (WHERE n.result::text = 'valid'::text) AS valid, count(*) FILTER (WHERE n.result::text = 'invalid'::text) AS invalid, count(*) FILTER (WHERE n.result::text = 'risky'::text) AS risky, count(*) FILTER (WHERE n.result::text = 'catch_all'::text) AS catch_all, round(100.0 * count(*) FILTER (WHERE n.result::text = 'valid'::text)::numeric / NULLIF(count(n.candidate_id), 0)::numeric, 2) AS valid_rate_pct FROM contact_candidates cc JOIN people p ON p.id = cc.person_id JOIN companies c ON c.id = p.company_id LEFT JOIN newest n ON n.candidate_id = cc.id GROUP BY c.niche, cc.evidence`,
);

export const sendHealth = pgView("send_health", {
  sender: varchar({ length: 320 }),
  domain: text("domain"),
  day: date("day"),
  sent: bigint("sent", { mode: "number" }),
  hardBounces: bigint("hard_bounces", { mode: "number" }),
  softBounces: bigint("soft_bounces", { mode: "number" }),
  replies: bigint("replies", { mode: "number" }),
  autoReplies: bigint("auto_replies", { mode: "number" }),
  unsubscribes: bigint("unsubscribes", { mode: "number" }),
  complaints: bigint("complaints", { mode: "number" }),
  bounceRate: numeric("bounce_rate", { mode: "number" }),
}).as(
  sql`SELECT sender, split_part(sender::text, '@'::text, 2) AS domain, day, sum(sent) AS sent, sum(hard_bounces) AS hard_bounces, sum(soft_bounces) AS soft_bounces, sum(replies) AS replies, sum(auto_replies) AS auto_replies, sum(unsubscribes) AS unsubscribes, sum(complaints) AS complaints, sum(hard_bounces)::numeric / NULLIF(sum(sent), 0)::numeric AS bounce_rate FROM ( SELECT e.sender, (m.sent_at AT TIME ZONE 'UTC'::text)::date AS day, 1 AS sent, 0 AS hard_bounces, 0 AS soft_bounces, 0 AS replies, 0 AS auto_replies, 0 AS unsubscribes, 0 AS complaints FROM messages m JOIN enrollments e ON e.id = m.enrollment_id WHERE m.state::text = 'sent'::text UNION ALL SELECT e.sender, COALESCE((origin.sent_at AT TIME ZONE 'UTC'::text)::date, (te.received_at AT TIME ZONE 'UTC'::text)::date) AS day, 0 AS sent, CASE WHEN te.kind::text = 'bounce'::text AND te.bounce_class::text = 'hard'::text THEN 1 ELSE 0 END AS hard_bounces, CASE WHEN te.kind::text = 'bounce'::text AND te.bounce_class::text = 'soft'::text THEN 1 ELSE 0 END AS soft_bounces, CASE WHEN te.kind::text = 'reply'::text THEN 1 ELSE 0 END AS replies, CASE WHEN te.kind::text = 'auto_reply'::text THEN 1 ELSE 0 END AS auto_replies, CASE WHEN te.kind::text = 'unsubscribe'::text THEN 1 ELSE 0 END AS unsubscribes, CASE WHEN te.kind::text = 'complaint'::text THEN 1 ELSE 0 END AS complaints FROM thread_events te JOIN enrollments e ON e.id = te.enrollment_id LEFT JOIN messages origin ON origin.id = te.in_reply_to_message_id WHERE te.kind::text <> 'note'::text) rows GROUP BY sender, day`,
);

export const replyOutcomes = pgView("reply_outcomes", {
  eventId: integer("event_id"),
  enrollmentId: integer("enrollment_id"),
  niche: varchar("niche", { length: 32 }),
  sequenceName: varchar("sequence_name", { length: 64 }),
  enrollmentKind: varchar("enrollment_kind", { length: 32 }),
  sender: varchar("sender", { length: 320 }),
  companyId: integer("company_id"),
  toEmail: varchar("to_email", { length: 320 }),
  kind: varchar("kind", { length: 32 }),
  bounceClass: varchar("bounce_class", { length: 32 }),
  disposition: varchar("disposition", { length: 32 }),
  dispositionSource: varchar("disposition_source", { length: 32 }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  repliedToStep: integer("replied_to_step"),
  repliedToTemplate: varchar("replied_to_template", { length: 64 }),
  repliedToTemplateVersion: varchar("replied_to_template_version", { length: 12 }),
}).as(
  sql`SELECT te.id AS event_id, te.enrollment_id, e.niche, e.sequence_name, e.kind AS enrollment_kind, e.sender, e.company_id, e.to_email, te.kind, te.bounce_class, te.disposition, te.disposition_source, te.received_at, origin.step AS replied_to_step, origin.template AS replied_to_template, origin.template_version AS replied_to_template_version FROM thread_events te JOIN enrollments e ON e.id = te.enrollment_id LEFT JOIN messages origin ON origin.id = te.in_reply_to_message_id`,
);

export const campaignFunnel = pgView("campaign_funnel", {
  niche: varchar({ length: 32 }),
  sequenceName: varchar("sequence_name", { length: 64 }),
  enrollmentKind: varchar("enrollment_kind", { length: 32 }),
  enrolled: bigint("enrolled", { mode: "number" }),
  active: bigint("active", { mode: "number" }),
  finished: bigint("finished", { mode: "number" }),
  stoppedReply: bigint("stopped_reply", { mode: "number" }),
  stoppedBounce: bigint("stopped_bounce", { mode: "number" }),
  stoppedOptOut: bigint("stopped_opt_out", { mode: "number" }),
  stoppedComplaint: bigint("stopped_complaint", { mode: "number" }),
  stoppedManual: bigint("stopped_manual", { mode: "number" }),
  openersSent: numeric("openers_sent", { mode: "number" }),
  followupsSent: numeric("followups_sent", { mode: "number" }),
  replies: numeric("replies", { mode: "number" }),
  interested: numeric("interested", { mode: "number" }),
  autoReplies: numeric("auto_replies", { mode: "number" }),
  hardBounces: numeric("hard_bounces", { mode: "number" }),
  unsubscribes: numeric("unsubscribes", { mode: "number" }),
  /** Companies on their second or later cold sequence (lead recycling). */
  recycled: boolean("recycled"),
}).as(
  sql`WITH sends AS ( SELECT m.enrollment_id, count(*) FILTER (WHERE m.step = 0) AS openers_sent, count(*) FILTER (WHERE m.step > 0) AS followups_sent FROM messages m WHERE m.state::text = 'sent'::text GROUP BY m.enrollment_id ), inbound AS ( SELECT te.enrollment_id, count(*) FILTER (WHERE te.kind::text = 'reply'::text) AS replies, count(*) FILTER (WHERE te.disposition::text = ANY (ARRAY['interested'::character varying, 'meeting_booked'::character varying]::text[])) AS interested, count(*) FILTER (WHERE te.kind::text = 'auto_reply'::text) AS auto_replies, count(*) FILTER (WHERE te.kind::text = 'bounce'::text AND te.bounce_class::text = 'hard'::text) AS hard_bounces, count(*) FILTER (WHERE te.kind::text = 'unsubscribe'::text) AS unsubscribes FROM thread_events te GROUP BY te.enrollment_id ) SELECT e.niche, e.sequence_name, e.kind AS enrollment_kind, count(*) AS enrolled, count(*) FILTER (WHERE e.state::text = 'active'::text) AS active, count(*) FILTER (WHERE e.state::text = 'finished'::text) AS finished, count(*) FILTER (WHERE e.stop_reason::text = 'reply'::text) AS stopped_reply, count(*) FILTER (WHERE e.stop_reason::text = 'bounce'::text) AS stopped_bounce, count(*) FILTER (WHERE e.stop_reason::text = 'opt_out'::text) AS stopped_opt_out, count(*) FILTER (WHERE e.stop_reason::text = 'complaint'::text) AS stopped_complaint, count(*) FILTER (WHERE e.stop_reason::text = 'manual'::text) AS stopped_manual, COALESCE(sum(sends.openers_sent), 0::numeric) AS openers_sent, COALESCE(sum(sends.followups_sent), 0::numeric) AS followups_sent, COALESCE(sum(inbound.replies), 0::numeric) AS replies, COALESCE(sum(inbound.interested), 0::numeric) AS interested, COALESCE(sum(inbound.auto_replies), 0::numeric) AS auto_replies, COALESCE(sum(inbound.hard_bounces), 0::numeric) AS hard_bounces, COALESCE(sum(inbound.unsubscribes), 0::numeric) AS unsubscribes, e.contact_round > 1 AS recycled FROM enrollments e LEFT JOIN sends ON sends.enrollment_id = e.id LEFT JOIN inbound ON inbound.enrollment_id = e.id GROUP BY e.niche, e.sequence_name, e.kind, (e.contact_round > 1)`,
);

export const enrollmentOutcomes = pgView("enrollment_outcomes", {
  enrollmentId: integer("enrollment_id"),
  niche: varchar("niche", { length: 32 }),
  sequenceName: varchar("sequence_name", { length: 64 }),
  enrollmentKind: varchar("enrollment_kind", { length: 32 }),
  companyId: integer("company_id"),
  personId: integer("person_id"),
  toEmail: varchar("to_email", { length: 320 }),
  sender: varchar("sender", { length: 320 }),
  state: varchar("state", { length: 32 }),
  stopReason: varchar("stop_reason", { length: 32 }),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
  openerTemplate: varchar("opener_template", { length: 64 }),
  openerTemplateVersion: varchar("opener_template_version", { length: 12 }),
  openerState: varchar("opener_state", { length: 32 }),
  evidence: text("evidence"),
  verificationResult: text("verification_result"),
  pickMethod: text("pick_method"),
  leadId: integer("lead_id"),
  candidateId: integer("candidate_id"),
  sourceDocumentId: integer("source_document_id"),
  sourceUrl: text("source_url"),
  stepsSent: bigint("steps_sent", { mode: "number" }),
  firstSentAt: timestamp("first_sent_at", { withTimezone: true }),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  replies: bigint("replies", { mode: "number" }),
  replied: boolean("replied"),
  interested: boolean("interested"),
  disposition: varchar("disposition"),
  hardBounced: boolean("hard_bounced"),
  softBounced: boolean("soft_bounced"),
  unsubscribed: boolean("unsubscribed"),
  complained: boolean("complained"),
  autoReplied: boolean("auto_replied"),
  firstReplyAt: timestamp("first_reply_at", { withTimezone: true }),
  contactRound: integer("contact_round"),
}).as(
  sql`WITH opener AS ( SELECT m.enrollment_id, m.template AS opener_template, m.template_version AS opener_template_version, m.state AS opener_state, m.provenance -> 'address'::text AS address FROM messages m WHERE m.step = 0 ), sends AS ( SELECT m.enrollment_id, count(*) FILTER (WHERE m.state::text = 'sent'::text) AS steps_sent, min(m.sent_at) AS first_sent_at, max(m.sent_at) AS last_sent_at FROM messages m GROUP BY m.enrollment_id ), events AS ( SELECT te.enrollment_id, count(*) FILTER (WHERE te.kind::text = 'reply'::text) AS replies, bool_or(te.kind::text = 'reply'::text) AS replied, bool_or(te.kind::text = 'reply'::text AND (te.disposition::text = ANY (ARRAY['interested'::character varying, 'meeting_booked'::character varying]::text[]))) AS interested, bool_or(te.kind::text = 'bounce'::text AND te.bounce_class::text = 'hard'::text) AS hard_bounced, bool_or(te.kind::text = 'bounce'::text AND te.bounce_class::text = 'soft'::text) AS soft_bounced, bool_or(te.kind::text = 'unsubscribe'::text) AS unsubscribed, bool_or(te.kind::text = 'complaint'::text) AS complained, bool_or(te.kind::text = 'auto_reply'::text) AS auto_replied, min(te.received_at) FILTER (WHERE te.kind::text = 'reply'::text) AS first_reply_at, (array_agg(te.disposition ORDER BY te.received_at DESC, te.id DESC) FILTER (WHERE te.kind::text = 'reply'::text AND te.disposition IS NOT NULL))[1] AS disposition FROM thread_events te GROUP BY te.enrollment_id ) SELECT e.id AS enrollment_id, e.niche, e.sequence_name, e.kind AS enrollment_kind, e.company_id, e.person_id, e.to_email, e.sender, e.state, e.stop_reason, e.created_at AS enrolled_at, o.opener_template, o.opener_template_version, o.opener_state, o.address ->> 'evidence'::text AS evidence, o.address ->> 'verification_result'::text AS verification_result, o.address ->> 'pick_method'::text AS pick_method, (o.address ->> 'lead_id'::text)::integer AS lead_id, (o.address ->> 'candidate_id'::text)::integer AS candidate_id, (o.address ->> 'document_id'::text)::integer AS source_document_id, o.address ->> 'source_url'::text AS source_url, COALESCE(s.steps_sent, 0::bigint) AS steps_sent, s.first_sent_at, s.last_sent_at, COALESCE(ev.replies, 0::bigint) AS replies, COALESCE(ev.replied, false) AS replied, COALESCE(ev.interested, false) AS interested, ev.disposition, COALESCE(ev.hard_bounced, false) AS hard_bounced, COALESCE(ev.soft_bounced, false) AS soft_bounced, COALESCE(ev.unsubscribed, false) AS unsubscribed, COALESCE(ev.complained, false) AS complained, COALESCE(ev.auto_replied, false) AS auto_replied, ev.first_reply_at, e.contact_round FROM enrollments e LEFT JOIN opener o ON o.enrollment_id = e.id LEFT JOIN sends s ON s.enrollment_id = e.id LEFT JOIN events ev ON ev.enrollment_id = e.id`,
);

/**
 * One row per enrollment: how it ended, in lead recycling's terms (src/recontact.ts),
 * and when the company last heard from us or we from it. Rest runs from `last_touch_at`.
 * The newest reply decides between a classified outcome and `needs_a_look`; any warm
 * reply or opt-out ever wins.
 */
export const contactOutcomes = pgView("contact_outcomes", {
  enrollmentId: integer("enrollment_id"),
  companyId: integer("company_id"),
  niche: varchar("niche", { length: 32 }),
  sequenceName: varchar("sequence_name", { length: 64 }),
  offer: varchar("offer", { length: 64 }),
  toEmail: varchar("to_email", { length: 320 }),
  contactRound: integer("contact_round"),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
  lastTouchAt: timestamp("last_touch_at", { withTimezone: true }),
  outcome: text("outcome"),
}).as(
  sql`WITH sent AS ( SELECT m.enrollment_id, max(m.sent_at) AS last_sent_at FROM messages m WHERE m.state::text = 'sent'::text GROUP BY m.enrollment_id ), ev AS ( SELECT te.enrollment_id, max(te.received_at) AS last_event_at, bool_or(te.kind::text = ANY (ARRAY['unsubscribe'::text, 'complaint'::text])) AS opted_out, bool_or(te.kind::text = 'reply'::text AND (te.disposition::text = ANY (ARRAY['interested'::text, 'meeting_booked'::text]))) AS warm, COALESCE((array_agg(COALESCE(te.disposition::text, 'other'::text) ORDER BY te.received_at DESC, te.id DESC) FILTER (WHERE te.kind::text = 'reply'::text))[1] = 'other'::text, false) AS needs_a_look, bool_or(te.kind::text = 'bounce'::text AND te.bounce_class::text = 'hard'::text) AS hard_bounced, (array_agg(te.disposition ORDER BY te.received_at DESC, te.id DESC) FILTER (WHERE te.kind::text = 'reply'::text AND te.disposition IS NOT NULL))[1] AS disposition FROM thread_events te GROUP BY te.enrollment_id ) SELECT e.id AS enrollment_id, e.company_id, e.niche, e.sequence_name, e.offer, e.to_email, e.contact_round, e.created_at AS enrolled_at, GREATEST(e.created_at, e.stopped_at, s.last_sent_at, ev.last_event_at) AS last_touch_at, CASE WHEN e.state::text = 'active'::text THEN 'active'::text WHEN (e.stop_reason::text = ANY (ARRAY['opt_out'::text, 'complaint'::text])) OR ev.opted_out THEN 'opted_out'::text WHEN ev.warm OR e.stop_reason::text = 'booked'::text OR (EXISTS ( SELECT 1 FROM call_bookings cb WHERE cb.enrollment_id = e.id)) THEN 'warm'::text WHEN e.stop_reason::text = 'manual'::text THEN 'stopped_by_hand'::text WHEN ev.needs_a_look THEN 'needs_a_look'::text WHEN ev.disposition::text = ANY (ARRAY['not_interested'::text, 'not_now'::text, 'wrong_person'::text, 'referral'::text]) THEN ev.disposition::text WHEN e.stop_reason::text = 'bounce'::text OR ev.hard_bounced THEN 'bounced'::text ELSE 'no_reply'::text END AS outcome FROM enrollments e LEFT JOIN sent s ON s.enrollment_id = e.id LEFT JOIN ev ON ev.enrollment_id = e.id`,
);

export const replyByEvidence = pgView("reply_by_evidence", {
  niche: varchar({ length: 32 }),
  enrollmentKind: varchar("enrollment_kind", { length: 32 }),
  evidence: text("evidence"),
  verificationResult: text("verification_result"),
  pickMethod: text("pick_method"),
  enrolled: bigint("enrolled", { mode: "number" }),
  opened: bigint("opened", { mode: "number" }),
  replied: bigint("replied", { mode: "number" }),
  interested: bigint("interested", { mode: "number" }),
  hardBounced: bigint("hard_bounced", { mode: "number" }),
  unsubscribed: bigint("unsubscribed", { mode: "number" }),
  replyRatePct: numeric("reply_rate_pct", { mode: "number" }),
  bounceRatePct: numeric("bounce_rate_pct", { mode: "number" }),
}).as(
  sql`SELECT niche, enrollment_kind, evidence, COALESCE(verification_result, 'none'::text) AS verification_result, pick_method, count(*) AS enrolled, count(*) FILTER (WHERE first_sent_at IS NOT NULL) AS opened, count(*) FILTER (WHERE replied) AS replied, count(*) FILTER (WHERE interested) AS interested, count(*) FILTER (WHERE hard_bounced) AS hard_bounced, count(*) FILTER (WHERE unsubscribed) AS unsubscribed, round(100.0 * count(*) FILTER (WHERE replied)::numeric / NULLIF(count(*) FILTER (WHERE first_sent_at IS NOT NULL), 0)::numeric, 2) AS reply_rate_pct, round(100.0 * count(*) FILTER (WHERE hard_bounced)::numeric / NULLIF(count(*) FILTER (WHERE first_sent_at IS NOT NULL), 0)::numeric, 2) AS bounce_rate_pct FROM enrollment_outcomes eo GROUP BY niche, enrollment_kind, evidence, (COALESCE(verification_result, 'none'::text)), pick_method`,
);

export const reviewOutcomes = pgView("review_outcomes", {
  niche: varchar({ length: 32 }),
  template: varchar("template", { length: 64 }),
  templateVersion: varchar("template_version", { length: 12 }),
  drafted: bigint("drafted", { mode: "number" }),
  awaiting: bigint("awaiting", { mode: "number" }),
  edited: bigint("edited", { mode: "number" }),
  approved: bigint("approved", { mode: "number" }),
  autoApproved: bigint("auto_approved", { mode: "number" }),
  rejected: bigint("rejected", { mode: "number" }),
  sent: bigint("sent", { mode: "number" }),
  reviewed: bigint("reviewed", { mode: "number" }),
  editRatePct: numeric("edit_rate_pct", { mode: "number" }),
  rejectRatePct: numeric("reject_rate_pct", { mode: "number" }),
}).as(
  sql`SELECT e.niche, m.template, m.template_version, count(*) AS drafted, count(*) FILTER (WHERE m.state::text = 'draft'::text) AS awaiting, count(*) FILTER (WHERE m.edited_at IS NOT NULL) AS edited, count(*) FILTER (WHERE m.approved_by::text = 'operator'::text) AS approved, count(*) FILTER (WHERE m.approved_by::text = 'auto'::text) AS auto_approved, count(*) FILTER (WHERE m.state::text = 'rejected'::text) AS rejected, count(*) FILTER (WHERE m.state::text = 'sent'::text) AS sent, count(*) FILTER (WHERE m.approved_by::text = 'operator'::text OR m.state::text = 'rejected'::text) AS reviewed, round(100.0 * count(*) FILTER (WHERE m.edited_at IS NOT NULL)::numeric / NULLIF(count(*) FILTER (WHERE m.approved_by::text = 'operator'::text OR m.state::text = 'rejected'::text), 0)::numeric, 2) AS edit_rate_pct, round(100.0 * count(*) FILTER (WHERE m.state::text = 'rejected'::text)::numeric / NULLIF(count(*) FILTER (WHERE m.approved_by::text = 'operator'::text OR m.state::text = 'rejected'::text), 0)::numeric, 2) AS reject_rate_pct FROM messages m JOIN enrollments e ON e.id = m.enrollment_id GROUP BY e.niche, m.template, m.template_version`,
);

export const funnelLatency = pgView("funnel_latency", {
  companyId: integer("company_id"),
  niche: varchar("niche", { length: 32 }),
  domain: varchar("domain", { length: 255 }),
  importedAt: timestamp("imported_at", { withTimezone: true }),
  firstFetchAt: timestamp("first_fetch_at", { withTimezone: true }),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
  firstSendAt: timestamp("first_send_at", { withTimezone: true }),
  firstReplyAt: timestamp("first_reply_at", { withTimezone: true }),
  daysImportToFetch: numeric("days_import_to_fetch", { mode: "number" }),
  daysImportToEnroll: numeric("days_import_to_enroll", { mode: "number" }),
  daysEnrollToSend: numeric("days_enroll_to_send", { mode: "number" }),
  daysImportToSend: numeric("days_import_to_send", { mode: "number" }),
  daysSendToReply: numeric("days_send_to_reply", { mode: "number" }),
}).as(
  sql`WITH stamps AS ( SELECT c.id AS company_id, c.niche, c.domain, c.created_at AS imported_at, ( SELECT min(d.fetched_at) AS min FROM documents d WHERE d.company_id = c.id) AS first_fetch_at, ( SELECT min(e.created_at) AS min FROM enrollments e WHERE e.company_id = c.id) AS enrolled_at, ( SELECT min(m.sent_at) AS min FROM messages m JOIN enrollments e ON e.id = m.enrollment_id WHERE e.company_id = c.id AND m.step = 0 AND m.state::text = 'sent'::text) AS first_send_at, ( SELECT min(te.received_at) AS min FROM thread_events te JOIN enrollments e ON e.id = te.enrollment_id WHERE e.company_id = c.id AND te.kind::text = 'reply'::text) AS first_reply_at FROM companies c ) SELECT company_id, niche, domain, imported_at, first_fetch_at, enrolled_at, first_send_at, first_reply_at, EXTRACT(epoch FROM first_fetch_at - imported_at) / 86400.0 AS days_import_to_fetch, EXTRACT(epoch FROM enrolled_at - imported_at) / 86400.0 AS days_import_to_enroll, EXTRACT(epoch FROM first_send_at - enrolled_at) / 86400.0 AS days_enroll_to_send, EXTRACT(epoch FROM first_send_at - imported_at) / 86400.0 AS days_import_to_send, EXTRACT(epoch FROM first_reply_at - first_send_at) / 86400.0 AS days_send_to_reply FROM stamps s`,
);

/**
 * The lead pipeline per niche, firms still in play: a domain, a crawl, a named person, a
 * verified lead for that person. Each step counts firms.
 */
export const pipelineFunnel = pgView("pipeline_funnel", {
  niche: varchar({ length: 32 }),
  inPlay: bigint("in_play", { mode: "number" }),
  withDomain: bigint("with_domain", { mode: "number" }),
  crawled: bigint("crawled", { mode: "number" }),
  namedPerson: bigint("named_person", { mode: "number" }),
  verifiedNamedLead: bigint("verified_named_lead", { mode: "number" }),
}).as(
  sql`SELECT c.niche, count(*) AS in_play, count(*) FILTER (WHERE c.domain IS NOT NULL) AS with_domain, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM documents d WHERE d.company_id = c.id)) AS crawled, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM people p WHERE p.company_id = c.id)) AS named_person, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM leads l WHERE l.company_id = c.id AND l.status::text = 'verified'::text AND l.first_name IS NOT NULL)) AS verified_named_lead FROM companies c WHERE c.decline_reason IS NULL GROUP BY c.niche`,
);

/**
 * Where named people stall, per niche: leads whose latest check said catch-all or risky, firms
 * whose candidates wait in the resolution queue with no named lead yet, and crawled firms (real
 * pages, not shells) where no one was named.
 */
export const pipelineLeaks = pgView("pipeline_leaks", {
  niche: varchar({ length: 32 }),
  catchAllLeads: bigint("catch_all_leads", { mode: "number" }),
  riskyLeads: bigint("risky_leads", { mode: "number" }),
  queuedFirms: bigint("queued_firms", { mode: "number" }),
  crawledNoPersonFirms: bigint("crawled_no_person_firms", { mode: "number" }),
}).as(
  sql`WITH firms AS ( SELECT c.id, c.niche, EXISTS ( SELECT 1 FROM people p WHERE p.company_id = c.id) AS has_person, EXISTS ( SELECT 1 FROM leads l WHERE l.company_id = c.id AND l.first_name IS NOT NULL) AS has_named_lead, EXISTS ( SELECT 1 FROM documents d WHERE d.company_id = c.id AND NOT d.is_shell) AS crawled, EXISTS ( SELECT 1 FROM contact_candidates cc JOIN people p ON p.id = cc.person_id WHERE p.company_id = c.id AND cc.state::text = 'queued'::text) AS queued FROM companies c WHERE c.decline_reason IS NULL ), latest AS ( SELECT DISTINCT ON (v.lead_id) v.lead_id, v.result FROM verifications v WHERE v.lead_id IS NOT NULL ORDER BY v.lead_id, v.checked_at DESC ), named AS ( SELECT f.niche, lt.result FROM leads l JOIN firms f ON f.id = l.company_id JOIN latest lt ON lt.lead_id = l.id WHERE l.first_name IS NOT NULL ) SELECT f.niche, ( SELECT count(*) FROM named n WHERE n.niche::text = f.niche::text AND n.result::text = 'catch_all'::text) AS catch_all_leads, ( SELECT count(*) FROM named n WHERE n.niche::text = f.niche::text AND n.result::text = 'risky'::text) AS risky_leads, count(*) FILTER (WHERE f.queued AND NOT f.has_named_lead) AS queued_firms, count(*) FILTER (WHERE f.crawled AND NOT f.has_person) AS crawled_no_person_firms FROM firms f GROUP BY f.niche`,
);

/** Model calls and tokens per month and model: `email_llm_calls` summed, for the console. */
export const llmUsageByMonth = pgView("llm_usage_by_month", {
  month: date("month"),
  kind: text("kind"),
  model: text("model"),
  provider: text("provider"),
  calls: bigint("calls", { mode: "number" }),
  inputTokens: bigint("input_tokens", { mode: "number" }),
  outputTokens: bigint("output_tokens", { mode: "number" }),
  rejectedCalls: bigint("rejected_calls", { mode: "number" }),
  parseFailures: bigint("parse_failures", { mode: "number" }),
}).as(
  sql`SELECT date_trunc('month'::text, c.created_at)::date AS month, c.kind, c.model, c.provider, count(*) AS calls, sum(c.input_tokens) AS input_tokens, sum(c.output_tokens) AS output_tokens, count(*) FILTER (WHERE c.rejected) AS rejected_calls, count(*) FILTER (WHERE c.parse_failed) AS parse_failures FROM email_llm_calls c GROUP BY (date_trunc('month'::text, c.created_at)::date), c.kind, c.model, c.provider`,
);

const ROLE_LIST = sql.raw(
  [...ROLE_LOCALPARTS]
    .sort()
    .map((l) => `'${l.replace(/'/g, "''")}'`)
    .join(", "),
);

/**
 * The lead sheet: one row per lead, its 13 columns (design 2026-10-03-lead-sheet).
 * The person is the lead's newest candidate; a role inbox has none. Company
 * columns prefer the firm's LinkedIn page (findings kind `profile`, trusted only
 * when its website is the firm's domain); else the import (`geo`, Overture's
 * category, SBA's NAICS); else the homepage's meta description (inline HTML only: an archived page's
 * HTML lives in the pages bucket, out of SQL's reach). `checks` and `verified`
 * fold `lead_checks`: yes = mail ok, firm domain, works there, and the mailbox
 * fits the name (or is a role inbox); wrong person = the mailbox fits someone
 * else or they moved on; else partial. The newest verdict is two index lookups
 * (by lead, by candidate), never an OR: the OR scanned all of verifications per row.
 */
export const leadSheet = pgView("lead_sheet", {
  leadId: integer("lead_id"),
  niche: varchar({ length: 32 }),
  personId: integer("person_id"),
  companyId: integer("company_id"),
  personName: text("person_name"),
  resultTitle: text("result_title"),
  linkedinUrl: varchar("linkedin_url", { length: 512 }),
  email: varchar({ length: 320 }),
  validEmailOn: date("valid_email_on"),
  emailType: text("email_type"),
  mailStatus: text("mail_status"),
  companyName: varchar("company_name"),
  companyDomain: varchar("company_domain"),
  companyLinkedin: varchar("company_linkedin", { length: 512 }),
  phone: varchar({ length: 512 }),
  socials: text("socials"),
  companyLocation: text("company_location"),
  industry: text("industry"),
  description: text("description"),
  checks: text("checks"),
  verified: text("verified"),
}).as(
  sql`SELECT l.id AS lead_id, c.niche, p.id AS person_id, c.id AS company_id,
  COALESCE(NULLIF(p.full_name, ''), NULLIF(concat_ws(' ', l.first_name, l.last_name), '')) AS person_name,
  COALESCE(NULLIF(p.title, ''), there.title, NULLIF(l.title, '')) AS result_title,
  COALESCE(p.linkedin_url, pub.person_linkedin) AS linkedin_url, l.email,
  (v.checked_at AT TIME ZONE 'UTC')::date AS valid_email_on,
  m.email_type, m.mail_status,
  c.name AS company_name, c.domain AS company_domain,
  COALESCE(c.linkedin_url, pub.company_linkedin) AS company_linkedin, pub.phone, pub.socials,
  COALESCE(NULLIF(prof.value ->> 'location', ''), NULLIF(c.raw ->> 'geo', ''), NULLIF(l.geo, '')) AS company_location,
  COALESCE(NULLIF(prof.value ->> 'industry', ''),
    NULLIF(replace(c.raw -> 'overture' -> 'categories' ->> 'primary', '_', ' '), ''),
    'NAICS ' || NULLIF(c.raw -> 'sba' ->> 'naics_primary', '')) AS industry,
  COALESCE(NULLIF(prof.value ->> 'description', ''), home.description) AS description,
  concat_ws(' · ', 'mail ' || m.mail_status,
    CASE WHEN m.email_type = 'role' THEN 'role inbox' WHEN ck.fits_name = 'pass' THEN 'fits name' WHEN ck.fits_name = 'fail' THEN 'fits someone else' END,
    CASE ck.domain_is_firm WHEN 'pass' THEN 'firm domain' WHEN 'fail' THEN 'other domain' END,
    CASE ck.works_there WHEN 'pass' THEN 'works there' WHEN 'fail' THEN 'moved on' END,
    CASE ck.title_agrees WHEN 'pass' THEN 'title agrees' WHEN 'fail' THEN 'title differs' END,
    CASE ck.page_is_firm WHEN 'pass' THEN 'firm page' WHEN 'fail' THEN 'no firm page' END,
    CASE ck.phone_agrees WHEN 'pass' THEN 'phone agrees' WHEN 'fail' THEN 'phone differs' END) AS checks,
  CASE WHEN ck.fits_name = 'fail' OR ck.works_there = 'fail' THEN 'wrong person'
    WHEN m.mail_status = 'ok' AND ck.domain_is_firm = 'pass' AND ck.works_there = 'pass'
      AND (ck.fits_name = 'pass' OR m.email_type = 'role') THEN 'yes'
    ELSE 'partial' END AS verified
FROM leads l
LEFT JOIN companies c ON c.id = l.company_id
LEFT JOIN LATERAL (SELECT cc.person_id FROM contact_candidates cc WHERE cc.lead_id = l.id ORDER BY cc.id DESC LIMIT 1) cand ON true
LEFT JOIN people p ON p.id = cand.person_id
LEFT JOIN LATERAL (SELECT x.result, x.checked_at FROM (
  (SELECT vv.result, vv.checked_at, vv.id FROM verifications vv WHERE vv.lead_id = l.id
    ORDER BY vv.checked_at DESC, vv.id DESC LIMIT 1)
  UNION ALL
  (SELECT vv.result, vv.checked_at, vv.id FROM contact_candidates cc JOIN verifications vv ON vv.contact_candidate_id = cc.id
    WHERE cc.lead_id = l.id ORDER BY vv.checked_at DESC, vv.id DESC LIMIT 1)
  ) x ORDER BY x.checked_at DESC, x.id DESC LIMIT 1) v ON true
CROSS JOIN LATERAL (SELECT
  CASE WHEN split_part(split_part(lower(l.email), '@', 1), '+', 1) IN (${ROLE_LIST}) THEN 'role' ELSE 'person' END AS email_type,
  CASE v.result WHEN 'valid' THEN 'ok' WHEN 'risky' THEN 'risky' WHEN 'catch_all' THEN 'risky' WHEN 'invalid' THEN 'bad' ELSE 'unchecked' END AS mail_status) m
LEFT JOIN LATERAL (SELECT
  max(lc.result) FILTER (WHERE lc.kind = 'mailbox_fits_name') AS fits_name,
  max(lc.result) FILTER (WHERE lc.kind = 'domain_is_firm') AS domain_is_firm,
  max(lc.result) FILTER (WHERE lc.kind = 'works_there') AS works_there,
  max(lc.result) FILTER (WHERE lc.kind = 'title_agrees') AS title_agrees,
  max(lc.result) FILTER (WHERE lc.kind = 'page_is_firm') AS page_is_firm,
  max(lc.result) FILTER (WHERE lc.kind = 'phone_agrees') AS phone_agrees
  FROM lead_checks lc WHERE lc.lead_id = l.id) ck ON true
LEFT JOIN LATERAL (SELECT NULLIF(f.value ->> 'title', '') AS title FROM findings f
  WHERE f.person_id = p.id AND f.kind = 'still_there' ORDER BY f.observed_at DESC, f.id DESC LIMIT 1) there ON true
LEFT JOIN LATERAL (SELECT f.value FROM findings f
  WHERE f.company_id = c.id AND f.kind = 'profile' ORDER BY f.observed_at DESC, f.id DESC LIMIT 1) prof ON true
LEFT JOIN LATERAL (SELECT NULLIF(btrim(COALESCE(
    substring(d.html FROM '(?i)<meta[^>]*name=["'']description["''][^>]*content="([^"]*)"'),
    substring(d.html FROM '(?i)<meta[^>]*content="([^"]*)"[^>]*name=["'']description["'']'))), '') AS description
  FROM documents d WHERE d.company_id = c.id AND d.kind = 'webpage' AND d.html IS NOT NULL
  ORDER BY length(COALESCE(d.final_url, d.url)), d.id LIMIT 1) home ON true
LEFT JOIN LATERAL (SELECT
  (SELECT cp.value FROM own_contact_points cp WHERE cp.company_id = c.id AND cp.kind = 'phone'
    ORDER BY cp.value ~ '^[+]18(00|33|44|55|66|77|88)', cp.source, cp.pages DESC, cp.id LIMIT 1) AS phone,
  (SELECT cp.value FROM own_contact_points cp WHERE cp.company_id = c.id AND cp.kind = 'linkedin_company'
    ORDER BY cp.pages DESC, cp.id LIMIT 1) AS company_linkedin,
  (SELECT cp.value FROM own_contact_points cp WHERE cp.person_id = p.id AND cp.kind = 'linkedin_person'
    ORDER BY cp.pages DESC, cp.id LIMIT 1) AS person_linkedin,
  (SELECT string_agg(s.value, ' ' ORDER BY s.kind) FROM (SELECT DISTINCT ON (cp.kind) cp.kind, cp.value
    FROM own_contact_points cp WHERE cp.company_id = c.id AND cp.kind IN ('x', 'instagram', 'facebook', 'youtube', 'tiktok')
    ORDER BY cp.kind, cp.pages DESC, cp.id) s) AS socials) pub ON true`,
);

/** What the console may read by name (`ConsolePortal/view`): numbers only, no rows about a person. */
export const EMAIL_CONSOLE_VIEWS = [
  "pipeline_funnel",
  "pipeline_leaks",
  "campaign_funnel",
  "send_health",
  "reply_by_arm_step",
  "verification_yield",
] as const;
/** The console's cost views: for whoever holds `money` at Wren. */
export const EMAIL_COST_VIEWS = ["email_stage_costs", "llm_usage_by_month"] as const;
