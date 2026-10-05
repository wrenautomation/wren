import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ---- Ported from emails_gen (exact DDL; integer ids kept for data continuity) ----

export const IMPORT_ERROR_KINDS = ["rejected", "domain_conflict", "domain_changed"] as const;
export type ImportErrorKind = (typeof IMPORT_ERROR_KINDS)[number];
export const PERSON_ORIGINS = [
  "registry",
  "website",
  "document",
  "manual",
  "linkedin",
  "crm",
] as const;
export type PersonOrigin = (typeof PERSON_ORIGINS)[number];
export const LEAD_STATUSES = ["imported", "verified", "suppressed", "undeliverable"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const SUPPRESSION_KINDS = ["email", "domain", "phone"] as const;
export type SuppressionKind = (typeof SUPPRESSION_KINDS)[number];
export const SUPPRESSION_REASONS = ["opt_out", "bounce", "complaint", "manual", "lifted"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

// Opt-in marketing (designs/2026-10-04-borrowed-ui.md): consent per address, channel and topic.
export const MARKETING_CHANNELS = ["email", "sms"] as const;
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];
export const CONSENT_STATES = ["pending", "confirmed", "withdrawn"] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];
export const CONSENT_SOURCES = [
  "lander_form",
  "meta_lead_form",
  "sms_keyword",
  "calcom_booking",
  "preference_center",
] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];
/** How often a person lets one channel market to them: as sent, or at most once a week or month. */
export const FREQUENCIES = ["as_sent", "weekly", "monthly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
/** A consent's history: its three states, plus the person's own settings and each send. */
export const CONSENT_EVENTS = [...CONSENT_STATES, "frequency", "paused", "sent"] as const;
export type ConsentEventKind = (typeof CONSENT_EVENTS)[number];

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").notNull(),
    command: varchar("command", { length: 64 }).notNull(),
    argv: jsonb("argv").notNull(),
    niche: varchar("niche", { length: 64 }),
    model: varchar("model", { length: 64 }),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    stats: jsonb("stats"),
  },
  (t) => [primaryKey({ columns: [t.id], name: "pk_runs" })],
);

/** What a feed line says happened: a step began, did something, found something, parked, failed or ended. */
export const RUN_EVENT_KINDS = ["started", "did", "found", "waiting", "failed", "done"] as const;
export type RunEventKind = (typeof RUN_EVENT_KINDS)[number];

/**
 * A run's feed: plain-words lines a stage writes as it works, so a person can
 * watch it. `seq` is the cursor a viewer polls after. Never secrets, prompts or
 * page text; `detail` is the technical why (an error), for operators only.
 */
export const runEvents = pgTable(
  "run_events",
  {
    seq: serial("seq").notNull(),
    runId: uuid("run_id").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    /** The stage or step, in the product's own words ("lookup"). */
    step: varchar("step", { length: 64 }).notNull(),
    kind: varchar("kind", { length: 16, enum: RUN_EVENT_KINDS }).notNull(),
    line: text("line").notNull(),
    /** Who or what it is about ("Jane Doe", "Acme"): the chip that moves through the graph. */
    subject: text("subject"),
    count: integer("count"),
    /** Where it came from: `{ label, href }`. */
    source: jsonb("source"),
    detail: text("detail"),
    /** The W3C trace this line belongs to, to join a run's spans. */
    traceId: varchar("trace_id", { length: 32 }),
  },
  (t) => [
    primaryKey({ columns: [t.seq], name: "pk_run_events" }),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_run_events_run_id_runs",
    }).onDelete("cascade"),
    index("ix_run_events_run_id_seq").on(t.runId, t.seq),
    oneOf("ck_run_events_kind", t.kind, RUN_EVENT_KINDS),
  ],
);
export type RunEvent = typeof runEvents.$inferSelect;

/**
 * The spine's log (designs/2026-10-05-workflows.md, src/spine.ts): one row per event arriving at
 * a node's input, keyed by workflow, node path and port and subject, so nothing enters twice. A
 * row with `due` is an event waiting on a wire until then. Main holds Wren's; each client's
 * database holds theirs.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().notNull(),
    /** The workflow the walk started in. */
    workflow: varchar("workflow", { length: 64 }).notNull(),
    /** Node ids from that workflow down, dotted ("warm.follow"); "out" is the workflow's own output. */
    node: varchar("node", { length: 200 }).notNull(),
    port: varchar("port", { length: 64 }).notNull(),
    /** Who or what it is about, unique per thing: "lead:42", "mail:<message id>". */
    subject: varchar("subject", { length: 200 }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    data: jsonb("data").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    /** Waiting on a wire until this time; null once it passed on. */
    due: timestamp("due", { withTimezone: true }),
    /** The Restate invocation that owns it, so a retried step runs again instead of skipping. */
    by: varchar("by", { length: 64 }).notNull(),
    /** Why its step failed after its retries: the event stopped here. */
    error: text("error"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_events" }),
    unique("uq_events_entry").on(t.workflow, t.node, t.port, t.subject),
    index("ix_events_subject").on(t.subject),
  ],
);
export type SpineRow = typeof events.$inferSelect;

/**
 * The door's hooks: `POST /hooks/<token>` on the phone Worker enters `workflow` at its input
 * `input`, the payload as the event's data. Main only. The token is shown once; kept as its hash.
 */
export const hooks = pgTable(
  "hooks",
  {
    id: uuid("id").defaultRandom().notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    name: text("name").notNull(),
    /** Whose database the events land in; null is Wren's. */
    client: varchar("client", { length: 40 }),
    workflow: varchar("workflow", { length: 64 }).notNull(),
    input: varchar("input", { length: 64 }).notNull(),
    /** The payload field that says who it is about, dotted ("data.email"). */
    subject: varchar("subject", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastAt: timestamp("last_at", { withTimezone: true }),
    calls: integer("calls").default(0).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_hooks" }),
    unique("uq_hooks_token_hash").on(t.tokenHash),
  ],
);
export type Hook = typeof hooks.$inferSelect;

export const imports = pgTable(
  "imports",
  {
    id: serial("id").notNull(),
    sourceType: varchar("source_type", { length: 32 }).notNull(),
    sourceRef: text("source_ref").notNull(),
    stats: jsonb("stats").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).defaultNow().notNull(),
    contentHash: varchar("content_hash", { length: 64 }),
    asOf: date("as_of"),
    supersededBy: integer("superseded_by"),
    defaults: jsonb("defaults"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_imports" }),
    index("ix_imports_superseded_by").on(t.supersededBy),
    foreignKey({
      columns: [t.supersededBy],
      foreignColumns: [t.id],
      name: "fk_imports_superseded_by_imports",
    }),
  ],
);

export const importErrors = pgTable(
  "import_errors",
  {
    id: serial("id").notNull(),
    importId: integer("import_id").notNull(),
    rowNumber: integer("row_number").notNull(),
    kind: varchar("kind", { length: 32, enum: IMPORT_ERROR_KINDS }).notNull(),
    reason: text("reason").notNull(),
    raw: jsonb("raw"),
    companyId: integer("company_id"),
    claimantCompanyId: integer("claimant_company_id"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_import_errors" }),
    index("ix_import_errors_company_id").on(t.companyId),
    index("ix_import_errors_claimant_company_id").on(t.claimantCompanyId),
    index("ix_import_errors_import_id").on(t.importId),
    foreignKey({
      columns: [t.claimantCompanyId],
      foreignColumns: [companies.id],
      name: "fk_import_errors_claimant_company_id_companies",
    }),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_import_errors_company_id_companies",
    }),
    foreignKey({
      columns: [t.importId],
      foreignColumns: [imports.id],
      name: "fk_import_errors_import_id_imports",
    }),
    oneOf("ck_import_errors_importerrorkind", t.kind, IMPORT_ERROR_KINDS),
  ],
);

export const companies = pgTable(
  "companies",
  {
    id: serial("id").notNull(),
    domain: varchar("domain", { length: 255 }),
    name: varchar("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    importId: integer("import_id"),
    raw: jsonb("raw"),
    sourceKey: varchar("source_key", { length: 64 }),
    socialUrl: varchar("social_url", { length: 512 }),
    /** The firm's LinkedIn page (`https://www.linkedin.com/company/<handle>/`), trusted only when its website is `domain`. */
    linkedinUrl: varchar("linkedin_url", { length: 512 }),
    country: varchar("country", { length: 2 }),
    domainVerifiedAt: timestamp("domain_verified_at", { withTimezone: true }),
    niche: varchar("niche", { length: 32 }),
    timezone: varchar("timezone", { length: 64 }),
    /** Why the niche's screen says this firm is no buyer (chain, public_body, ...); NULL = in play. */
    declineReason: varchar("decline_reason", { length: 32 }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_companies" }),
    index("ix_companies_import_id").on(t.importId),
    // Covers `email_firm_records`: the console's firm counts read this, not the wide heap.
    index("ix_companies_firm_records")
      .on(t.id, t.niche, t.declineReason, t.domain, t.createdAt, t.name)
      .where(sql`niche is not null`),
    foreignKey({
      columns: [t.importId],
      foreignColumns: [imports.id],
      name: "fk_companies_import_id_imports",
    }),
    unique("uq_companies_domain").on(t.domain),
    unique("uq_companies_source_key").on(t.sourceKey),
    check("ck_companies_identified", sql`(domain IS NOT NULL) OR (source_key IS NOT NULL)`),
  ],
);

export const people = pgTable(
  "people",
  {
    id: serial("id").notNull(),
    sourceKey: varchar("source_key", { length: 64 }),
    companyId: integer("company_id").notNull(),
    fullName: text("full_name").notNull(),
    firstName: varchar("first_name"),
    lastName: varchar("last_name"),
    title: text("title"),
    isCompliance: boolean("is_compliance").notNull(),
    origin: varchar("origin", { length: 32, enum: PERSON_ORIGINS }).notNull(),
    originRef: text("origin_ref").notNull(),
    asOf: date("as_of"),
    linkedinUrl: varchar("linkedin_url", { length: 512 }),
    notes: text("notes"),
    importId: integer("import_id"),
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    isTestimonial: boolean("is_testimonial").default(false).notNull(),
    testimonialOrg: text("testimonial_org"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_people" }),
    index("ix_people_import_id").on(t.importId),
    index("ix_people_company_created").on(t.companyId, t.createdAt),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_people_company_id_companies",
    }),
    foreignKey({
      columns: [t.importId],
      foreignColumns: [imports.id],
      name: "fk_people_import_id_imports",
    }),
    unique("uq_people_source_key").on(t.sourceKey),
    oneOf("ck_people_personorigin", t.origin, PERSON_ORIGINS),
  ],
);

export const sightings = pgTable(
  "sightings",
  {
    id: serial("id").notNull(),
    companyId: integer("company_id"),
    leadId: integer("lead_id"),
    importId: integer("import_id").notNull(),
    rowNumber: integer("row_number").notNull(),
    raw: jsonb("raw").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).defaultNow().notNull(),
    personId: integer("person_id"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_sightings" }),
    index("ix_sightings_import_id").on(t.importId),
    index("ix_sightings_company_id").on(t.companyId),
    index("ix_sightings_lead_id").on(t.leadId),
    index("ix_sightings_person_id").on(t.personId),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_sightings_company_id_companies",
    }),
    foreignKey({
      columns: [t.importId],
      foreignColumns: [imports.id],
      name: "fk_sightings_import_id_imports",
    }),
    foreignKey({
      columns: [t.leadId],
      foreignColumns: [leads.id],
      name: "fk_sightings_lead_id_leads",
    }),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_sightings_person_id_people",
    }),
    check(
      "ck_sightings_one_entity",
      sql`((((company_id IS NOT NULL))::integer + ((lead_id IS NOT NULL))::integer) + ((person_id IS NOT NULL))::integer) = 1`,
    ),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: serial("id").notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    firstName: varchar("first_name"),
    lastName: varchar("last_name"),
    title: varchar("title"),
    persona: varchar("persona", { length: 64 }),
    source: varchar("source", { length: 64 }),
    geo: varchar("geo", { length: 64 }),
    status: varchar("status", { length: 32, enum: LEAD_STATUSES }).notNull(),
    raw: jsonb("raw").notNull(),
    companyId: integer("company_id"),
    importId: integer("import_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    country: varchar("country", { length: 2 }),
    suppressionId: integer("suppression_id"),
    socialUrl: varchar("social_url", { length: 512 }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_leads" }),
    index("ix_leads_suppression_id").on(t.suppressionId),
    index("ix_leads_import_id").on(t.importId),
    index("ix_leads_company_id").on(t.companyId),
    index("ix_leads_company_verified")
      .on(t.companyId, t.createdAt)
      .where(sql`status = 'verified' and first_name is not null`),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_leads_company_id_companies",
    }),
    foreignKey({
      columns: [t.importId],
      foreignColumns: [imports.id],
      name: "fk_leads_import_id_imports",
    }),
    foreignKey({
      columns: [t.suppressionId],
      foreignColumns: [suppressions.id],
      name: "fk_leads_suppression_id_suppressions",
    }),
    unique("uq_leads_email").on(t.email),
    oneOf("ck_leads_leadstatus", t.status, LEAD_STATUSES),
  ],
);

export const suppressions = pgTable(
  "suppressions",
  {
    id: serial("id").notNull(),
    kind: varchar("kind", { length: 32, enum: SUPPRESSION_KINDS }).notNull(),
    value: varchar("value", { length: 320 }).notNull(),
    reason: varchar("reason", { length: 32, enum: SUPPRESSION_REASONS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_suppressions" }),
    unique("uq_suppressions_kind").on(t.kind, t.value),
    oneOf("ck_suppressions_suppressionkind", t.kind, SUPPRESSION_KINDS),
    oneOf("ck_suppressions_suppressionreason", t.reason, SUPPRESSION_REASONS),
  ],
);

export const suppressionEvents = pgTable(
  "suppression_events",
  {
    id: serial("id").notNull(),
    suppressionId: integer("suppression_id").notNull(),
    reason: varchar("reason", { length: 32, enum: SUPPRESSION_REASONS }).notNull(),
    evidence: jsonb("evidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_suppression_events" }),
    index("ix_suppression_events_suppression_id").on(t.suppressionId),
    foreignKey({
      columns: [t.suppressionId],
      foreignColumns: [suppressions.id],
      name: "fk_suppression_events_suppression_id_suppressions",
    }),
    oneOf("ck_suppression_events_suppressionreason", t.reason, SUPPRESSION_REASONS),
  ],
);

/** What someone can sign up for. `name` is ours; subscribers only ever see `publicName`. */
export const topics = pgTable(
  "topics",
  {
    id: serial("id").notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    publicName: varchar("public_name", { length: 120 }).notNull(),
    line: text("line").notNull(),
    channel: varchar("channel", { length: 16, enum: MARKETING_CHANNELS }).notNull(),
    cadence: varchar("cadence", { length: 64 }).notNull(),
    /** Shows in the preference center. */
    public: boolean("public").default(false).notNull(),
    /** SMS only: texting this word alone (any case) signs up. Upper case letters and digits. */
    keyword: varchar("keyword", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_topics" }),
    unique("uq_topics_name").on(t.name),
    unique("uq_topics_keyword").on(t.keyword),
    oneOf("ck_topics_channel", t.channel, MARKETING_CHANNELS),
    check(
      "ck_topics_keyword",
      sql`${t.keyword} IS NULL OR (${t.channel} = 'sms' AND ${t.keyword} ~ '^[A-Z0-9]{2,32}$')`,
    ),
  ],
);

/** One per address, channel and topic. Only `../marketing.ts` writes it. */
export const consents = pgTable(
  "consents",
  {
    id: serial("id").notNull(),
    channel: varchar("channel", { length: 16, enum: MARKETING_CHANNELS }).notNull(),
    address: varchar("address", { length: 320 }).notNull(),
    topicId: integer("topic_id").notNull(),
    state: varchar("state", { length: 16, enum: CONSENT_STATES }).notNull(),
    source: varchar("source", { length: 32, enum: CONSENT_SOURCES }).notNull(),
    /** The version of the words the person agreed to. */
    textVersion: varchar("text_version", { length: 64 }).notNull(),
    frequency: varchar("frequency", { length: 16, enum: FREQUENCIES }).default("as_sent").notNull(),
    pausedUntil: timestamp("paused_until", { withTimezone: true }),
    pendingAt: timestamp("pending_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_consents" }),
    unique("uq_consents_channel").on(t.channel, t.address, t.topicId),
    index("ix_consents_topic_id").on(t.topicId),
    foreignKey({
      columns: [t.topicId],
      foreignColumns: [topics.id],
      name: "fk_consents_topic_id_topics",
    }),
    oneOf("ck_consents_channel", t.channel, MARKETING_CHANNELS),
    oneOf("ck_consents_state", t.state, CONSENT_STATES),
    oneOf("ck_consents_source", t.source, CONSENT_SOURCES),
    oneOf("ck_consents_frequency", t.frequency, FREQUENCIES),
  ],
);

/** Append only: every change to a consent, with its proof. Same pattern as `suppression_events`. */
export const consentEvents = pgTable(
  "consent_events",
  {
    id: serial("id").notNull(),
    consentId: integer("consent_id").notNull(),
    kind: varchar("kind", { length: 16, enum: CONSENT_EVENTS }).notNull(),
    /** Who did it: "subscriber", "lander:form", "meta:lead-form", an operator's email. */
    by: varchar("by", { length: 320 }).notNull(),
    evidence: jsonb("evidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_consent_events" }),
    index("ix_consent_events_consent_id").on(t.consentId, t.createdAt),
    foreignKey({
      columns: [t.consentId],
      foreignColumns: [consents.id],
      name: "fk_consent_events_consent_id_consents",
    }),
    oneOf("ck_consent_events_kind", t.kind, CONSENT_EVENTS),
  ],
);

export type Topic = typeof topics.$inferSelect;
export type Consent = typeof consents.$inferSelect;
export type ConsentEvent = typeof consentEvents.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type ImportBatch = typeof imports.$inferSelect;
export type ImportError = typeof importErrors.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Person = typeof people.$inferSelect;
export type Sighting = typeof sightings.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Suppression = typeof suppressions.$inferSelect;
export type SuppressionEvent = typeof suppressionEvents.$inferSelect;
