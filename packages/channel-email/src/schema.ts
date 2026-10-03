import { companies, leads, people, runs } from "@wren/core/schema";
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/** `crm`: the address a client's own CRM holds for the person. */
export const CANDIDATE_EVIDENCE = ["scraped", "derived_pattern", "guessed_pattern", "crm"] as const;
export type CandidateEvidence = (typeof CANDIDATE_EVIDENCE)[number];
export const CANDIDATE_STATES = ["candidate", "queued", "verified", "rejected"] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];
export const VERIFICATION_RESULTS = ["valid", "invalid", "risky", "catch_all"] as const;
export type VerificationResult = (typeof VERIFICATION_RESULTS)[number];
export const ENROLLMENT_KINDS = ["person", "role_inbox"] as const;
export type EnrollmentKind = (typeof ENROLLMENT_KINDS)[number];
export const ENROLLMENT_STATES = ["active", "finished", "stopped"] as const;
export type EnrollmentState = (typeof ENROLLMENT_STATES)[number];
/** `undeliverable`: the address's newest verdict turned invalid before a step went out. */
export const STOP_REASONS = [
  "reply",
  "bounce",
  "opt_out",
  "complaint",
  "manual",
  "undeliverable",
] as const;
export type StopReason = (typeof STOP_REASONS)[number];
/** `client`: approved by the client in the portal (their own list, their own name on it). */
export const APPROVAL_SOURCES = ["operator", "auto", "client"] as const;
export type ApprovalSource = (typeof APPROVAL_SOURCES)[number];
export const MESSAGE_STATES = [
  "draft",
  "approved",
  "rejected",
  "sending",
  "sent",
  "skipped",
  "failed",
  "unknown",
] as const;
export type MessageState = (typeof MESSAGE_STATES)[number];
export const REJECT_REASONS = [
  "wrong_fact",
  "too_salesy",
  "generic_opener",
  "bad_tone",
  "wrong_person",
  "bad_address",
  "other",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];
export const BOUNCE_CLASSES = ["hard", "soft"] as const;
export type BounceClass = (typeof BOUNCE_CLASSES)[number];
export const DISPOSITION_SOURCES = ["rule", "operator", "llm"] as const;
export type DispositionSource = (typeof DISPOSITION_SOURCES)[number];
export const REPLY_DISPOSITIONS = [
  "interested",
  "meeting_booked",
  "not_interested",
  "not_now",
  "wrong_person",
  "referral",
  "other",
] as const;
export type ReplyDisposition = (typeof REPLY_DISPOSITIONS)[number];
export const THREAD_EVENT_KINDS = [
  "reply",
  "bounce",
  "auto_reply",
  "unsubscribe",
  "complaint",
  "note",
] as const;
export type ThreadEventKind = (typeof THREAD_EVENT_KINDS)[number];
export const PAUSE_SOURCES = ["kill_switch", "operator"] as const;
export type PauseSource = (typeof PAUSE_SOURCES)[number];

export const contactCandidates = pgTable(
  "contact_candidates",
  {
    id: serial("id").notNull(),
    personId: integer("person_id").notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    domain: varchar("domain", { length: 255 }).notNull(),
    evidence: varchar("evidence", { length: 32, enum: CANDIDATE_EVIDENCE }).notNull(),
    pattern: varchar("pattern", { length: 32 }),
    rank: integer("rank").notNull(),
    state: varchar("state", { length: 32, enum: CANDIDATE_STATES }).notNull(),
    sourceRef: text("source_ref").notNull(),
    leadId: integer("lead_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_contact_candidates" }),
    index("ix_contact_candidates_domain").on(t.domain),
    index("ix_contact_candidates_person_id").on(t.personId),
    foreignKey({
      columns: [t.leadId],
      foreignColumns: [leads.id],
      name: "fk_contact_candidates_lead_id_leads",
    }),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_contact_candidates_person_id_people",
    }),
    unique("uq_contact_candidates_person_id").on(t.personId, t.email),
    oneOf("ck_contact_candidates_candidateevidence", t.evidence, CANDIDATE_EVIDENCE),
    oneOf("ck_contact_candidates_candidatestate", t.state, CANDIDATE_STATES),
  ],
);

/**
 * People whose addresses buildCandidates already minted. Minting is once per person: a
 * person here is never minted again, even after their unverified guesses are deleted.
 */
export const candidateMints = pgTable(
  "candidate_mints",
  {
    personId: integer("person_id").notNull(),
    mintedAt: timestamp("minted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.personId], name: "pk_candidate_mints" }),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_candidate_mints_person_id_people",
    }).onDelete("cascade"),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: serial("id").notNull(),
    leadId: integer("lead_id"),
    verifier: varchar("verifier", { length: 64 }).notNull(),
    result: varchar("result", { length: 32, enum: VERIFICATION_RESULTS }).notNull(),
    raw: jsonb("raw").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
    email: varchar("email", { length: 320 }),
    contactCandidateId: integer("contact_candidate_id"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_verifications" }),
    index("ix_verifications_contact_candidate_id").on(t.contactCandidateId),
    index("ix_verifications_lead_id").on(t.leadId),
    // The send walk's newest-verdict read, per address.
    index("ix_verifications_email_checked_at").on(t.email, t.checkedAt),
    foreignKey({
      columns: [t.contactCandidateId],
      foreignColumns: [contactCandidates.id],
      name: "fk_verifications_contact_candidate_id_contact_candidates",
    }),
    foreignKey({
      columns: [t.leadId],
      foreignColumns: [leads.id],
      name: "fk_verifications_lead_id_leads",
    }),
    check(
      "ck_verifications_attributed",
      sql`(lead_id IS NOT NULL) OR (contact_candidate_id IS NOT NULL)`,
    ),
    oneOf("ck_verifications_verificationresult", t.result, VERIFICATION_RESULTS),
  ],
);

export const templateVersions = pgTable(
  "template_versions",
  {
    id: serial("id").notNull(),
    niche: varchar("niche", { length: 32 }).notNull(),
    template: varchar("template", { length: 64 }).notNull(),
    version: varchar("version", { length: 12 }).notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_template_versions" }),
    unique("uq_template_versions_niche").on(t.niche, t.template, t.version),
  ],
);

export const enrollments = pgTable(
  "enrollments",
  {
    id: serial("id").notNull(),
    personId: integer("person_id"),
    niche: varchar("niche", { length: 32 }).notNull(),
    sequenceName: varchar("sequence_name", { length: 64 }).notNull(),
    sequenceSnapshot: jsonb("sequence_snapshot").notNull(),
    /** The offer this enrollment pitches (an @wren/offers id), fixed when it was composed. */
    offer: varchar("offer", { length: 64 }).notNull(),
    state: varchar("state", { length: 32, enum: ENROLLMENT_STATES }).notNull(),
    stopReason: varchar("stop_reason", { length: 32, enum: STOP_REASONS }),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    companyId: integer("company_id").notNull(),
    kind: varchar("kind", { length: 32, enum: ENROLLMENT_KINDS }).notNull(),
    toEmail: varchar("to_email", { length: 320 }).notNull(),
    sender: varchar("sender", { length: 320 }).notNull(),
    runId: uuid("run_id"),
    /** The company's Nth cold sequence: 1 = first contact, 2+ = it came back (lead recycling). */
    contactRound: integer("contact_round").default(1).notNull(),
    /** Their out-of-office said they're away through this day: the next step waits for the sending day after. */
    awayUntil: date("away_until"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_enrollments" }),
    index("ix_enrollments_company_id").on(t.companyId),
    index("ix_enrollments_person_id").on(t.personId),
    index("ix_enrollments_run_id").on(t.runId),
    index("ix_enrollments_offer").on(t.offer),
    uniqueIndex("uq_enrollments_active_address")
      .on(sql`lower((to_email)::text)`)
      .where(sql`(state)::text = 'active'::text`),
    uniqueIndex("uq_enrollments_active_company")
      .on(t.companyId)
      .where(sql`(state)::text = 'active'::text`),
    uniqueIndex("uq_enrollments_active_person")
      .on(t.personId)
      .where(sql`(state)::text = 'active'::text`),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_enrollments_company_id_companies",
    }),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_enrollments_person_id_people",
    }),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_enrollments_run_id_runs",
    }),
    oneOf("ck_enrollments_enrollmentkind", t.kind, ENROLLMENT_KINDS),
    oneOf("ck_enrollments_enrollmentstate", t.state, ENROLLMENT_STATES),
    check(
      "ck_enrollments_person_unless_role_inbox",
      sql`(person_id IS NOT NULL) OR ((kind)::text = 'role_inbox'::text)`,
    ),
    check(
      "ck_enrollments_stop_reason_iff_stopped",
      sql`((state)::text = 'stopped'::text) = (stop_reason IS NOT NULL)`,
    ),
    oneOf("ck_enrollments_stopreason", t.stopReason, STOP_REASONS),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").notNull(),
    enrollmentId: integer("enrollment_id").notNull(),
    step: integer("step").notNull(),
    template: varchar("template", { length: 64 }).notNull(),
    templateVersion: varchar("template_version", { length: 12 }).notNull(),
    toEmail: varchar("to_email", { length: 320 }).notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    provenance: jsonb("provenance").notNull(),
    state: varchar("state", { length: 32, enum: MESSAGE_STATES }).notNull(),
    messageId: varchar("message_id", { length: 255 }),
    detail: text("detail"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    gmailId: varchar("gmail_id", { length: 64 }),
    threadId: varchar("thread_id", { length: 64 }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    transport: varchar("transport", { length: 32 }),
    runId: uuid("run_id"),
    sentRunId: uuid("sent_run_id"),
    reviewReason: varchar("review_reason", { length: 32, enum: REJECT_REASONS }),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    openToken: varchar("open_token", { length: 64 }),
    /** The `?r=` on this message's site link: the lander records it, `wren site visits` names the click. */
    linkCode: varchar("link_code", { length: 40 }),
    approvedBy: varchar("approved_by", { length: 32, enum: APPROVAL_SOURCES }),
    /** The call times `{call.times}` offered when this message sent (ISO instants), for the reply that picks one. */
    offeredTimes: jsonb("offered_times").$type<string[]>(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_messages" }),
    index("ix_messages_enrollment_id").on(t.enrollmentId),
    index("ix_messages_run_id").on(t.runId),
    index("ix_messages_sent_run_id").on(t.sentRunId),
    foreignKey({
      columns: [t.enrollmentId],
      foreignColumns: [enrollments.id],
      name: "fk_messages_enrollment_id_enrollments",
    }),
    foreignKey({ columns: [t.runId], foreignColumns: [runs.id], name: "fk_messages_run_id_runs" }),
    foreignKey({
      columns: [t.sentRunId],
      foreignColumns: [runs.id],
      name: "fk_messages_sent_run_id_runs",
    }),
    unique("uq_messages_enrollment_id").on(t.enrollmentId, t.step),
    unique("uq_messages_open_token").on(t.openToken),
    unique("uq_messages_link_code").on(t.linkCode),
    oneOf("ck_messages_approvalsource", t.approvedBy, APPROVAL_SOURCES),
    check(
      "ck_messages_approved_by_iff_approved_at",
      sql`(approved_by IS NULL) = (approved_at IS NULL)`,
    ),
    check(
      "ck_messages_message_id_before_send",
      sql`((state)::text <> ALL ((ARRAY['sending'::character varying, 'sent'::character varying, 'unknown'::character varying])::text[])) OR (message_id IS NOT NULL)`,
    ),
    oneOf("ck_messages_messagestate", t.state, MESSAGE_STATES),
    oneOf("ck_messages_rejectreason", t.reviewReason, REJECT_REASONS),
    check(
      "ck_messages_review_reason_only_on_reject",
      sql`(review_reason IS NULL) OR ((state)::text = 'rejected'::text)`,
    ),
    check(
      "ck_messages_sent_at_iff_sent",
      sql`(sent_at IS NOT NULL) = ((state)::text = 'sent'::text)`,
    ),
    check("ck_messages_transport_iff_attempted", sql`(attempted_at IS NULL) = (transport IS NULL)`),
  ],
);

export const threadEvents = pgTable(
  "thread_events",
  {
    id: serial("id").notNull(),
    enrollmentId: integer("enrollment_id").notNull(),
    inReplyToMessageId: integer("in_reply_to_message_id"),
    kind: varchar("kind", { length: 32, enum: THREAD_EVENT_KINDS }).notNull(),
    bounceClass: varchar("bounce_class", { length: 32, enum: BOUNCE_CLASSES }),
    disposition: varchar("disposition", { length: 32, enum: REPLY_DISPOSITIONS }),
    dispositionSource: varchar("disposition_source", { length: 32, enum: DISPOSITION_SOURCES }),
    classifiedAt: timestamp("classified_at", { withTimezone: true }),
    gmailId: varchar("gmail_id", { length: 64 }),
    gmailThreadId: varchar("gmail_thread_id", { length: 64 }),
    fromAddress: varchar("from_address", { length: 320 }),
    subject: text("subject"),
    snippet: text("snippet"),
    headers: jsonb("headers"),
    detail: text("detail"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    runId: uuid("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    bodyText: text("body_text"),
    classification: jsonb("classification"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_thread_events" }),
    index("ix_thread_events_enrollment_id").on(t.enrollmentId),
    index("ix_thread_events_run_id").on(t.runId),
    uniqueIndex("uq_thread_events_gmail_id").on(t.gmailId).where(sql`gmail_id IS NOT NULL`),
    foreignKey({
      columns: [t.enrollmentId],
      foreignColumns: [enrollments.id],
      name: "fk_thread_events_enrollment_id_enrollments",
    }),
    foreignKey({
      columns: [t.inReplyToMessageId],
      foreignColumns: [messages.id],
      name: "fk_thread_events_in_reply_to_message_id_messages",
    }),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_thread_events_run_id_runs",
    }),
    check(
      "ck_thread_events_bounce_class_iff_bounce",
      sql`((kind)::text = 'bounce'::text) = (bounce_class IS NOT NULL)`,
    ),
    oneOf("ck_thread_events_bounceclass", t.bounceClass, BOUNCE_CLASSES),
    check(
      "ck_thread_events_disposition_only_on_reply",
      sql`(disposition IS NULL) OR ((kind)::text = 'reply'::text)`,
    ),
    check(
      "ck_thread_events_disposition_source_iff_disposition",
      sql`(disposition IS NULL) = (disposition_source IS NULL)`,
    ),
    oneOf("ck_thread_events_dispositionsource", t.dispositionSource, DISPOSITION_SOURCES),
    oneOf("ck_thread_events_replydisposition", t.disposition, REPLY_DISPOSITIONS),
    oneOf("ck_thread_events_threadeventkind", t.kind, THREAD_EVENT_KINDS),
  ],
);

/**
 * What happened to one warm reply. Code proposes, William decides (10-02): a
 * `proposed` row holds the time code read and the reply it drafted; William's
 * approve books it (cal.com emails the invite) and sends the reply, or just sends
 * it (`sent`, a demo link or his own words). Anything code can't read is
 * `needs_you`; William passing on a proposal is `dropped`. `booking` is written
 * BEFORE the calendar is called, so a crash between the two is never retried:
 * a lead is never booked twice.
 */
export const CALL_INVITE_STATES = [
  "proposed",
  "booking",
  "booked",
  "sent",
  "already_booked",
  "needs_you",
  "dropped",
] as const;
export type CallInviteState = (typeof CALL_INVITE_STATES)[number];

export const callInvites = pgTable(
  "call_invites",
  {
    id: serial("id").notNull(),
    threadEventId: integer("thread_event_id").notNull(),
    enrollmentId: integer("enrollment_id").notNull(),
    state: varchar("state", { length: 32, enum: CALL_INVITE_STATES }).notNull(),
    start: timestamp("start", { withTimezone: true }),
    timeZone: varchar("time_zone", { length: 64 }),
    email: varchar("email", { length: 320 }).notNull(),
    bookingUid: varchar("booking_uid", { length: 64 }),
    /** Why it needs William, or what the calendar said. */
    detail: text("detail"),
    /** The time-reading step's proposal and verdict, the audit record. */
    reading: jsonb("reading"),
    runId: uuid("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    /** The reply code drafted for William to approve (a `messages` row on the thread). */
    replyMessageId: integer("reply_message_id"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_call_invites" }),
    index("ix_call_invites_reply_message_id").on(t.replyMessageId),
    foreignKey({
      columns: [t.replyMessageId],
      foreignColumns: [messages.id],
      name: "fk_call_invites_reply_message_id_messages",
    }).onDelete("set null"),
    unique("uq_call_invites_thread_event_id").on(t.threadEventId),
    index("ix_call_invites_enrollment_id").on(t.enrollmentId),
    foreignKey({
      columns: [t.threadEventId],
      foreignColumns: [threadEvents.id],
      name: "fk_call_invites_thread_event_id_thread_events",
    }),
    foreignKey({
      columns: [t.enrollmentId],
      foreignColumns: [enrollments.id],
      name: "fk_call_invites_enrollment_id_enrollments",
    }),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_call_invites_run_id_runs",
    }),
    oneOf("ck_call_invites_callinvitestate", t.state, CALL_INVITE_STATES),
    check(
      "ck_call_invites_booked_has_uid",
      sql`((state)::text <> 'booked'::text) OR (booking_uid IS NOT NULL AND start IS NOT NULL)`,
    ),
  ],
);

export type CallInvite = typeof callInvites.$inferSelect;

export const openEvents = pgTable(
  "open_events",
  {
    id: serial("id").notNull(),
    messageId: integer("message_id").notNull(),
    remoteId: bigint("remote_id", { mode: "number" }).notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
    runId: uuid("run_id"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_open_events" }),
    index("ix_open_events_message_id").on(t.messageId),
    index("ix_open_events_run_id").on(t.runId),
    index("ix_open_events_seen_at").on(t.seenAt),
    foreignKey({
      columns: [t.messageId],
      foreignColumns: [messages.id],
      name: "fk_open_events_message_id_messages",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_open_events_run_id_runs",
    }),
    unique("uq_open_events_remote_id").on(t.remoteId),
  ],
);

export const openSyncs = pgTable(
  "open_syncs",
  {
    baseUrl: varchar("base_url", { length: 255 }).notNull(),
    cursorId: bigint("cursor_id", { mode: "number" }).default(0).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    stats: jsonb("stats"),
  },
  (t) => [primaryKey({ columns: [t.baseUrl], name: "pk_open_syncs" })],
);

export const inboxSyncs = pgTable(
  "inbox_syncs",
  {
    sender: varchar("sender", { length: 320 }).notNull(),
    cursorMs: bigint("cursor_ms", { mode: "number" }).default(0).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    stats: jsonb("stats"),
  },
  (t) => [primaryKey({ columns: [t.sender], name: "pk_inbox_syncs" })],
);

export const senderPauses = pgTable(
  "sender_pauses",
  {
    id: serial("id").notNull(),
    sender: varchar("sender", { length: 320 }).notNull(),
    domain: varchar("domain", { length: 255 }).notNull(),
    reason: text("reason").notNull(),
    source: varchar("source", { length: 32, enum: PAUSE_SOURCES }).notNull(),
    pausedAt: timestamp("paused_at", { withTimezone: true }).defaultNow().notNull(),
    liftedAt: timestamp("lifted_at", { withTimezone: true }),
    liftedBy: varchar("lifted_by", { length: 64 }),
    detail: jsonb("detail"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_sender_pauses" }),
    index("ix_sender_pauses_sender").on(t.sender),
    uniqueIndex("uq_sender_pauses_active").on(t.sender).where(sql`lifted_at IS NULL`),
    oneOf("ck_sender_pauses_pausesource", t.source, PAUSE_SOURCES),
  ],
);

export const postmasterDays = pgTable(
  "postmaster_days",
  {
    domain: varchar("domain", { length: 253 }).notNull(),
    day: date("day").notNull(),
    spamRate: doublePrecision("spam_rate"),
    domainReputation: varchar("domain_reputation", { length: 32 }),
    spfSuccessRatio: doublePrecision("spf_success_ratio"),
    dkimSuccessRatio: doublePrecision("dkim_success_ratio"),
    dmarcSuccessRatio: doublePrecision("dmarc_success_ratio"),
    raw: jsonb("raw").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
    runId: uuid("run_id"),
    deliveryErrorRate: doublePrecision("delivery_error_rate"),
    tlsOutboundCount: bigint("tls_outbound_count", { mode: "number" }),
    tlsInboundCount: bigint("tls_inbound_count", { mode: "number" }),
  },
  (t) => [
    index("ix_postmaster_days_run_id").on(t.runId),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_postmaster_days_run_id_runs",
    }),
    primaryKey({ columns: [t.domain, t.day], name: "pk_postmaster_days" }),
  ],
);

export const REPORT_KINDS = ["weekly"] as const;

/**
 * A generated report (E8): the numbers as data and the text as sent, so the
 * next one can say what changed and the operator can re-read any week.
 */
export const reports = pgTable(
  "reports",
  {
    id: serial("id").notNull(),
    kind: varchar("kind", { length: 32, enum: REPORT_KINDS }).notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    stats: jsonb("stats").notNull(),
    body: text("body").notNull(),
    /** Where it went, or null when it was only stored. */
    sentTo: varchar("sent_to", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    runId: uuid("run_id"),
  },
  (t) => [
    index("ix_reports_kind_period_end").on(t.kind, t.periodEnd),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_reports_run_id_runs",
    }),
    primaryKey({ columns: [t.id], name: "pk_reports" }),
  ],
);

// Row types
export type ContactCandidate = typeof contactCandidates.$inferSelect;
export type NewContactCandidate = typeof contactCandidates.$inferInsert;
export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;
export type TemplateVersion = typeof templateVersions.$inferSelect;
export type NewTemplateVersion = typeof templateVersions.$inferInsert;
export type Enrollment = typeof enrollments.$inferSelect;
export type NewEnrollment = typeof enrollments.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type ThreadEvent = typeof threadEvents.$inferSelect;
export type NewThreadEvent = typeof threadEvents.$inferInsert;
export type OpenEvent = typeof openEvents.$inferSelect;
export type NewOpenEvent = typeof openEvents.$inferInsert;
export type OpenSync = typeof openSyncs.$inferSelect;
export type NewOpenSync = typeof openSyncs.$inferInsert;
export type InboxSync = typeof inboxSyncs.$inferSelect;
export type NewInboxSync = typeof inboxSyncs.$inferInsert;
export type SenderPause = typeof senderPauses.$inferSelect;
export type NewSenderPause = typeof senderPauses.$inferInsert;
export type PostmasterDay = typeof postmasterDays.$inferSelect;
export type NewPostmasterDay = typeof postmasterDays.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
