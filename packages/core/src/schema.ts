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
  type PgTableExtraConfigValue,
  pgTable,
  pgView,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { clients } from "./clients/schema.js";
import { EVENT_KINDS, type EventKind } from "./components.js";
import type { FieldMap } from "./door.js";
import {
  EXPERIMENT_GOALS,
  EXPERIMENT_STATES,
  type ExperimentGoal,
  type ExperimentState,
  type FlagRule,
  SURFACES,
  type Surface,
} from "./flags.js";
import type { Until } from "./logic.js";
import { REJECT_REASONS } from "./reject-reasons.js";
import {
  SURVEY_KINDS,
  SURVEY_STATES,
  SURVEY_SURFACES,
  type SurveyAudience,
  type SurveyKind,
  type SurveyState,
  type SurveySurface,
  type SurveyTrigger,
} from "./surveys.js";
import type { WorkflowEdits } from "./workflows.js";

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
 * Units held out of a stage (designs/2026-10-05-checks.md, src/checks.ts): one row per stage and
 * subject. A hold lasts 7 days, the unit is tried once more, and a second failure holds it until
 * a person releases it. `source:<name>` subjects are sources paused on that stage.
 */
export const unitHolds = pgTable(
  "unit_holds",
  {
    id: serial("id").notNull(),
    stage: varchar("stage", { length: 64 }).notNull(),
    subject: varchar("subject", { length: 200 }).notNull(),
    /** The latest reason, in words. */
    reason: text("reason").notNull(),
    heldAt: timestamp("held_at", { withTimezone: true }).defaultNow().notNull(),
    /** 'infinity' once its one retry is spent: a person releases it. */
    until: timestamp("until", { withTimezone: true }).notNull(),
    tries: integer("tries").default(1).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    /** An email, or `checks` when a later read settled it. */
    releasedBy: varchar("released_by", { length: 320 }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_unit_holds" }),
    unique("uq_unit_holds_stage_subject").on(t.stage, t.subject),
  ],
);
export type UnitHold = typeof unitHolds.$inferSelect;

/**
 * Every check's outcome: pass rates per stage and source, and the window that pauses a source.
 * ponytail: never pruned; ~60 bytes a row, prune past 90 days if it ever matters.
 */
export const checkOutcomes = pgTable(
  "check_outcomes",
  {
    id: serial("id").notNull(),
    stage: varchar("stage", { length: 64 }).notNull(),
    source: varchar("source", { length: 64 }).notNull(),
    check: varchar("check", { length: 120 }).notNull(),
    subject: varchar("subject", { length: 200 }),
    ok: boolean("ok").notNull(),
    reason: text("reason"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_check_outcomes" }),
    index("ix_check_outcomes_stage_source").on(t.stage, t.source, t.id),
  ],
);

/**
 * Holds as the console lists them (`console.hold`): held, retry due, needs a person, paused.
 * Its title names the unit and its stage: "Acme Co: Crawl", not "4821".
 */
export const unitHoldsNow = pgView("unit_holds_now", {
  id: integer("id"),
  stage: text("stage"),
  subject: text("subject"),
  reason: text("reason"),
  state: text("state"),
  heldAt: timestamp("held_at", { withTimezone: true }),
  until: timestamp("until", { withTimezone: true }),
  tries: integer("tries"),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  releasedBy: text("released_by"),
  title: text("title"),
}).as(sql`
  select id, stage, subject, reason,
    case when released_at is not null then 'released' when subject like 'source:%' then 'paused'
      when until = 'infinity' then 'stuck' when until > now() then 'held' else 'due' end state,
    held_at, nullif(until, 'infinity') until, tries, released_at, released_by,
    coalesce(who, subject) || ': ' || what title
  from unit_holds h,
  lateral (select case when stage = 'research.signals' and subject like '%:%' then
        initcap(split_part(subject, ':', 1)) || ' signal' else case split_part(stage, '.', 2)
      when 'fb-groups' then 'Facebook groups' when 'exa-search' then 'Exa search'
      when 'youtube-search' then 'YouTube search' when 'youtube' then 'YouTube'
      when 'opener' then 'Opener email' when 'ads' then 'Ad Library'
      else initcap(replace(coalesce(nullif(split_part(stage, '.', 2), ''), stage), '-', ' ')) end end what) w,
  lateral (select case
      when subject like 'source:%' then initcap(substr(subject, 8)) || ' source'
      when stage = 'research.signals' then (select coalesce(case
          when k ~ '^c[0-9]{1,9}$' then (select name from companies where id = substr(k, 2)::int)
          when k ~ '^p[0-9]{1,9}$' then (select full_name from people where id = substr(k, 2)::int)
          when k ~ '^(reddit:)?t3_' then (select '"' || t.title || '"' from reddit_threads t
            where t.id = regexp_replace(k, '^reddit:', '') limit 1) end, k)
        from (select substr(subject, strpos(subject, ':') + 1) k) s)
      when subject like 'post %' then (select coalesce(g.name, 'Group') || ', post by '
        || coalesce(nullif(p.author, ''), 'someone') from social_posts p
        left join social_groups g on g.id = p.group_id where p.ref = substr(subject, 6) limit 1)
      when subject like 'about %' then (select g.name || ', About page' from social_groups g
        where g.ref = substr(subject, 7) limit 1)
      when subject !~ '^[0-9]{1,9}$' then case when stage in ('research.exa-search',
        'research.youtube-search', 'research.ads') then '"' || subject || '"' end
      when stage in ('research.scan', 'research.extract', 'research.contacts') then
        (select c.name from documents d join companies c on c.id = d.company_id
          where d.id = subject::int)
      when stage = 'research.profiles' then (select full_name from people where id = subject::int)
      else (select name from companies where id = subject::int) end who) n`);

/** Each check's pass rate over 30 days, per stage and source (`console.check`). */
export const checkRates = pgView("check_rates", {
  id: text("id"),
  stage: text("stage"),
  source: text("source"),
  check: text("check"),
  total: integer("total"),
  passed: integer("passed"),
  rate: real("rate"),
  lastAt: timestamp("last_at", { withTimezone: true }),
  state: text("state"),
}).as(sql`
  select o.stage || ' ' || o.source || ' ' || o."check" id, o.stage, o.source, o."check",
    count(*)::int total, count(*) filter (where o.ok)::int passed,
    avg(o.ok::int)::real rate, max(o.at) last_at,
    case when exists (select 1 from unit_holds h where h.stage = o.stage
      and h.subject = 'source:' || o.source and h.released_at is null) then 'paused' else 'on' end state
  from check_outcomes o where o.at > now() - interval '30 days'
  group by o.stage, o.source, o."check"`);

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
    kind: varchar("kind", { length: 16 }).$type<EventKind>().notNull(),
    data: jsonb("data").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    /** Waiting on a wire until this time; null once it passed on. */
    due: timestamp("due", { withTimezone: true }),
    /** The Restate invocation that owns it, so a retried step runs again instead of skipping. */
    by: varchar("by", { length: 64 }).notNull(),
    /** Why its step failed after its retries: the event stopped here. */
    error: text("error"),
    /** What its step sent on, by output (`[{port, subject, kind, data}]`), cut to fit; and when. */
    sent: jsonb("sent").$type<SentEvent[]>(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /**
     * The `workflow_saves` id of the wiring its subject entered this workflow on, 0 the code's;
     * null is from before versions and walks the live one. A subject keeps its wiring until it's
     * done, while new ones take the live one.
     */
    version: integer("version"),
    /**
     * Held at a Wait until this event ("reply", "booking", "cancelled"; `UNTILS`), `due` its most.
     * That event about the same thing (`about`) sends it on by `out`, else time does by `timeout`.
     */
    until: varchar("until", { length: 16 }).$type<Until>(),
    /** What its subject is about, as a fired event finds it (`aboutOf`): "sms:42". */
    about: varchar("about", { length: 200 }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_events" }),
    unique("uq_events_entry").on(t.workflow, t.node, t.port, t.subject),
    index("ix_events_subject").on(t.subject),
    index("ix_events_until").on(t.until, t.about).where(sql`due is not null and until is not null`),
    // The error digest and Replay read failed steps only.
    index("ix_events_failed").on(t.workflow).where(sql`error is not null`),
    oneOf("ck_events_kind", t.kind, Object.keys(EVENT_KINDS)),
  ],
);
export type SpineRow = typeof events.$inferSelect;
/** One event a step sent on, as `events.sent` keeps it. */
export interface SentEvent {
  port: string;
  subject: string;
  kind: string;
  data: Record<string, unknown>;
}

/** The spine's arrivals as the console lists them (`console.event`): failed, waiting, or passed on. */
export const spineEvents = pgView("spine_events", {
  id: text("id"),
  workflow: text("workflow"),
  node: text("node"),
  port: text("port"),
  subject: text("subject"),
  kind: text("kind"),
  state: text("state"),
  at: timestamp("at", { withTimezone: true }),
  due: timestamp("due", { withTimezone: true }),
  until: text("until"),
  error: text("error"),
}).as(sql`
  select id::text id, workflow, node, port, subject, kind,
    case when error is not null then 'failed' when due is not null then 'waiting' else 'passed' end state,
    at, due, case when due is not null then until end until, error
  from events`);

/**
 * One subject's walk through one workflow (`console.execution`): when it entered, where it is now
 * (the failed node, else the waiting one, else the last it reached) and how many steps it took.
 * Its title names who and what: "Dana Lee: Re: pricing", not "mail:104".
 */
export const spineExecutions = pgView("spine_executions", {
  id: text("id"),
  workflow: text("workflow"),
  subject: text("subject"),
  kind: text("kind"),
  state: text("state"),
  node: text("node"),
  entered: timestamp("entered", { withTimezone: true }),
  lastAt: timestamp("last_at", { withTimezone: true }),
  due: timestamp("due", { withTimezone: true }),
  until: text("until"),
  error: text("error"),
  steps: integer("steps"),
  title: text("title"),
}).as(sql`
  select x.*, coalesce(case
      when subject ~ '^mail:[0-9]{1,9}$' then (select coalesce(nullif(m.from_name, ''),
        m.from_address) || ': ' || coalesce(nullif(m.subject, ''), 'Email')
        from watch.mail m where m.id = split_part(x.subject, ':', 2)::int)
      when subject ~ '^item:[0-9]{1,9}$' then (select i.title from learn.items i
        where i.id = split_part(x.subject, ':', 2)::int)
      when subject ~ '^(lead|reply):sms:[0-9]{1,9}$' then (select coalesce(nullif(s.name, ''),
        c.name, 'Lead') || case when x.subject like 'lead:%' then ': Text lead' else ': Text reply' end
        from sms_contacts s left join companies c on c.id = s.company_id
        where s.id = split_part(x.subject, ':', 3)::int)
      when subject ~ '^(lead|reply):reach:[0-9]{1,9}$' then (select coalesce(nullif(r.name, ''),
        r.handle) || case when x.subject like 'lead:%' then ': DM lead' else ': DM reply' end
        from reach_contacts r where r.id = split_part(x.subject, ':', 3)::int)
      when subject ~ '^(lead|reply):email:[0-9]{1,9}$' then (select coalesce(nullif(p.full_name, ''),
        c.name, e.to_email) || case when x.subject like 'lead:%' then ': Email lead'
        else ': Email reply' end
        from enrollments e left join people p on p.id = e.person_id
        left join companies c on c.id = e.company_id
        where e.id = split_part(x.subject, ':', 3)::int)
      when subject ~ '^company:[0-9]{1,9}$' then (select c.name from companies c
        where c.id = split_part(x.subject, ':', 2)::int)
      when subject ~ '^account:[0-9]{1,9}:' then (select initcap(a.site) || ': ' || a.ref
        from client_accounts a where a.id = split_part(x.subject, ':', 2)::int)
    end, case split_part(subject, ':', 1) when 'mail' then 'Email' when 'item' then 'Learn item'
      when 'company' then 'Company' when 'account' then 'Account'
      when 'lead' then case split_part(subject, ':', 2) when 'reach' then 'DM lead'
        when 'email' then 'Email lead' else 'Text lead' end
      when 'reply' then case split_part(subject, ':', 2) when 'reach' then 'DM reply'
        when 'email' then 'Email reply' else 'Text reply' end
    end || ' (gone)', subject) title
  from (select workflow || '/' || subject id, workflow, subject, min(kind) kind,
    case when bool_or(error is not null) then 'failed'
      when bool_or(due is not null) then 'waiting' else 'done' end state,
    (array_agg(node order by (error is not null) desc, (due is not null) desc, at desc))[1] node,
    min(at) entered, max(coalesce(sent_at, at)) last_at, min(due) due,
    (array_agg(until order by due nulls last) filter (where due is not null))[1] until,
    max(error) error, count(*)::int steps
  from events group by workflow, subject) x`);

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
    /** Where a lead's facts sit in the payload (`FieldMap`, ./door.ts); `{}` reads common names. */
    fields: jsonb("fields").$type<FieldMap>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastAt: timestamp("last_at", { withTimezone: true }),
    calls: integer("calls").default(0).notNull(),
    /** False: a post is refused (409) and counted. A template's door stays shut until approved. */
    open: boolean("open").default(true).notNull(),
    /** The token sealed with `WREN_HOOK_KEY` (./doors.ts), so the team can see it again; null without one. */
    sealed: text("sealed"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_hooks" }),
    unique("uq_hooks_token_hash").on(t.tokenHash),
    index("ix_hooks_client").on(t.client),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_hooks_client_clients",
    }).onDelete("cascade"),
  ],
);
export type Hook = typeof hooks.$inferSelect;

/**
 * Workflows saved on the canvas: one row per save of a workflow's routed wires and custom steps
 * for a client. The newest per client and workflow is the one that runs; the older ones are its
 * history. Main only.
 */
export const workflowSaves = pgTable(
  "workflow_saves",
  {
    id: serial("id").notNull(),
    /** Whose; null is Wren's. */
    client: varchar("client", { length: 40 }),
    workflow: varchar("workflow", { length: 64 }).notNull(),
    /** `WorkflowEdits`; null: back to the code's. */
    edits: jsonb("edits").$type<WorkflowEdits | null>(),
    /** False: a draft. It runs nowhere until Publish copies it into a live row. */
    live: boolean("live").default(true).notNull(),
    by: text("by").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_workflow_saves" }),
    index("ix_workflow_saves_client_workflow").on(t.client, t.workflow, t.id),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_workflow_saves_client_clients",
    }).onDelete("cascade"),
  ],
);

/**
 * A published workflow saved as a template (designs/2026-10-06-workflow-editor.md, step 5): its
 * live wiring under a name, sold beside the code's templates and installed the same way. Saving
 * the same name again moves it, so an install reads it as an update. Main only.
 */
export const workflowTemplates = pgTable(
  "workflow_templates",
  {
    /** The template's id, `saved_<name>`: what installs and To approve name it by. */
    id: varchar("id", { length: 64 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    blurb: text("blurb").default("").notNull(),
    /** The code's workflow it rewires. */
    workflow: varchar("workflow", { length: 64 }).notNull(),
    /** The live save's `WorkflowEdits` when saved; null: the code's wiring. */
    edits: jsonb("edits").$type<WorkflowEdits | null>(),
    /** Whose live workflow it was saved from; null is Wren's. */
    fromClient: varchar("from_client", { length: 40 }),
    by: text("by").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_workflow_templates" }),
    index("ix_workflow_templates_from_client").on(t.fromClient),
    foreignKey({
      columns: [t.fromClient],
      foreignColumns: [clients.id],
      name: "fk_workflow_templates_from_client_clients",
    }).onDelete("set null"),
  ],
);
export type WorkflowTemplateRow = typeof workflowTemplates.$inferSelect;

/**
 * Outbound webhooks (designs/2026-10-07-webhooks-out.md): a client's https URL and the events it
 * hears. The secret is sealed with `WREN_HOOK_KEY` and shown once; after a rotate the old one
 * signs too until `prev_until`. Main only.
 */
export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: uuid("id").defaultRandom().notNull(),
    /** Whose; null is Wren's. */
    client: varchar("client", { length: 40 }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    /** `WEBHOOK_EVENTS` names. */
    events: text("events").array().notNull(),
    /** `whsec_…`, sealed (`./doors.ts`). */
    secret: text("secret").notNull(),
    prevSecret: text("prev_secret"),
    prevUntil: timestamp("prev_until", { withTimezone: true }),
    /** Off: events are skipped, and a pending delivery stops. */
    active: boolean("active").default(true).notNull(),
    by: text("by").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    /** The first failed try since the last one that landed; null while it lands. */
    failingSince: timestamp("failing_since", { withTimezone: true }),
    /** Turned off by Wren after `DISABLE_AFTER_MS` of failures, and why; null when on or off by hand. */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledWhy: text("disabled_why"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_webhook_subscriptions" }),
    index("ix_webhook_subscriptions_client").on(t.client),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_webhook_subscriptions_client_clients",
    }).onDelete("cascade"),
  ],
);
export type WebhookSubscription = typeof webhookSubscriptions.$inferSelect;

export const DELIVERY_STATES = ["pending", "delivered", "failed"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/**
 * One event to one subscription: the body as signed, where it stands, and its last try. One row
 * per subscription and event id, so a retried call delivers once. Main only.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").defaultRandom().notNull(),
    subscription: uuid("subscription").notNull(),
    event: varchar("event", { length: 40 }).notNull(),
    /** The Standard Webhooks `webhook-id`: the same on every try. */
    eventId: varchar("event_id", { length: 80 }).notNull(),
    payload: jsonb("payload").notNull(),
    state: varchar("state", { length: 12, enum: DELIVERY_STATES })
      .$type<DeliveryState>()
      .default("pending")
      .notNull(),
    attempts: integer("attempts").default(0).notNull(),
    status: integer("status"),
    latencyMs: integer("latency_ms"),
    /** The first 1,000 characters of the last answer. */
    response: text("response"),
    error: text("error"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    lastAt: timestamp("last_at", { withTimezone: true }),
    /** When the next try runs, while a failed one waits on the ladder; null otherwise. */
    nextAt: timestamp("next_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_webhook_deliveries" }),
    unique("uq_webhook_deliveries_event").on(t.subscription, t.eventId),
    index("ix_webhook_deliveries_subscription_at").on(t.subscription, t.at),
    foreignKey({
      columns: [t.subscription],
      foreignColumns: [webhookSubscriptions.id],
      name: "fk_webhook_deliveries_subscription_webhook_subscriptions",
    }).onDelete("cascade"),
    oneOf("ck_webhook_deliveries_state", t.state, DELIVERY_STATES),
  ],
);
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;

/** Each try of a delivery: its status (null: no answer), time, what came back, or why not. */
export const webhookAttempts = pgTable(
  "webhook_attempts",
  {
    id: serial("id").notNull(),
    delivery: uuid("delivery").notNull(),
    n: integer("n").notNull(),
    status: integer("status"),
    latencyMs: integer("latency_ms").notNull(),
    response: text("response"),
    error: text("error"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_webhook_attempts" }),
    index("ix_webhook_attempts_delivery").on(t.delivery, t.n),
    foreignKey({
      columns: [t.delivery],
      foreignColumns: [webhookDeliveries.id],
      name: "fk_webhook_attempts_delivery_webhook_deliveries",
    }).onDelete("cascade"),
  ],
);
export type WebhookAttempt = typeof webhookAttempts.$inferSelect;

export const INSTALL_STATES = ["draft", "waiting", "live", "off"] as const;
/** draft: installed, nothing runs. waiting: in To approve. live: approved. off: uninstalled. */
export type InstallState = (typeof INSTALL_STATES)[number];

/** What a template install wrote, so an update knows the template's from the client's. */
export interface InstallApplied {
  /** Parts this install added; the ones the client had already are never touched. */
  added: string[];
  /** Each part's block as the install last wrote it; kept after uninstall. */
  blocks: Record<string, Record<string, unknown>>;
  /** The copy refs it put in the client's database. */
  copy: string[];
  /** The template's name when installed: To approve says it without the code's list. */
  name?: string;
  /** Each part's block as it was when uninstall took it off: a reinstall puts it back. */
  kept?: Record<string, Record<string, unknown>>;
}

/**
 * A template on a client (designs/2026-10-07-template-install.md): one row per client and
 * template, kept after uninstall. Main only.
 */
export const workflowInstalls = pgTable(
  "workflow_installs",
  {
    id: serial("id").notNull(),
    client: varchar("client", { length: 40 }).notNull(),
    /** The Shop's id for it: the part it is the inside of, else the workflow's. */
    template: varchar("template", { length: 64 }).notNull(),
    workflow: varchar("workflow", { length: 64 }).notNull(),
    /** The template's hash when last applied: a newer one is an update to read first. */
    version: varchar("version", { length: 16 }).notNull(),
    state: varchar("state", { length: 16, enum: INSTALL_STATES }).default("draft").notNull(),
    applied: jsonb("applied").$type<InstallApplied>().notNull(),
    /** Its door, when it has one. */
    hook: uuid("hook"),
    by: text("by").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    askedBy: text("asked_by"),
    askedAt: timestamp("asked_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    removedBy: text("removed_by"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_workflow_installs" }),
    unique("uq_workflow_installs_client_template").on(t.client, t.template),
    index("ix_workflow_installs_hook").on(t.hook),
    oneOf("ck_workflow_installs_state", t.state, INSTALL_STATES),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_workflow_installs_client_clients",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.hook],
      foreignColumns: [hooks.id],
      name: "fk_workflow_installs_hook_hooks",
    }).onDelete("set null"),
  ],
);
export type WorkflowInstall = typeof workflowInstalls.$inferSelect;

/** Who made a change: a person, or Claude's patch a person accepted. */
export const CHANGE_VIAS = ["person", "claude"] as const;
export type ChangeVia = (typeof CHANGE_VIAS)[number];

/**
 * Every edit to a record that declares `edits` (`./edits.ts`): the fields it set, before and
 * after, who, and the run (Claude's ask) it came from. History reads it; Undo writes the before
 * back as a new row that `undoes` this one, once. Main only.
 */
export const changes = pgTable(
  "changes",
  {
    id: serial("id").notNull(),
    /** The record type: "marketing.text_copy". */
    record: varchar("record", { length: 64 }).notNull(),
    recordId: varchar("record_id", { length: 200 }).notNull(),
    /** Only the fields it set, as they were and as they became. */
    before: jsonb("before").$type<Record<string, unknown>>().notNull(),
    after: jsonb("after").$type<Record<string, unknown>>().notNull(),
    /** The values' version once it landed: the next edit's `expect`. */
    version: varchar("version", { length: 16 }).notNull(),
    by: varchar("by", { length: 200 }).notNull(),
    via: varchar("via", { length: 16, enum: CHANGE_VIAS }).notNull(),
    runId: uuid("run_id"),
    undoes: integer("undoes"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.id], name: "pk_changes" }),
    oneOf("ck_changes_via", t.via, CHANGE_VIAS),
    index("ix_changes_record_record_id").on(t.record, t.recordId, t.id),
    index("ix_changes_run_id").on(t.runId),
    // An undo lands once; a second Undo of the same change is refused.
    unique("uq_changes_undoes").on(t.undoes),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_changes_run_id_runs",
    }),
    foreignKey({
      columns: [t.undoes],
      foreignColumns: [t.id],
      name: "fk_changes_undoes_changes",
    }),
  ],
);
export type Change = typeof changes.$inferSelect;

/** What a draft is (designs/2026-10-07-training-record.md); the last two are written on `posting`. */
export const DRAFT_RECORD_KINDS = [
  "post",
  "comment",
  "thread",
  "dm",
  "invite",
  "video",
  "invite_note",
  "linkedin_comment",
] as const;
export type DraftRecordKind = (typeof DRAFT_RECORD_KINDS)[number];
/** One step in a draft's life. `generated` is its first words, whoever wrote them. */
export const DRAFT_EVENTS = [
  "generated",
  "edited",
  "approved",
  "rejected",
  "scheduled",
  "sent",
  "failed",
] as const;
export type DraftEvent = (typeof DRAFT_EVENTS)[number];
/** Who took the step: the model, William, Claude at his ask, or Wren itself (a scheduler, an import). */
export const DRAFT_VIAS = ["model", "person", "claude", "wren"] as const;
export type DraftVia = (typeof DRAFT_VIAS)[number];
export { REJECT_REASONS, type RejectReason } from "./reject-reasons.js";

/**
 * Every draft's record, one row per step, for viewing and training (`./draft-record.ts`).
 * Append-only: a row is never updated, so a `generated` row's `llm` is the immutable copy of
 * what the model was asked. `item` is the Inbox id; `round` counts a DM contact's drafts.
 */
export const draftEvents = pgTable(
  "draft_events",
  {
    id: serial("id").notNull(),
    item: varchar("item", { length: 200 }).notNull(),
    round: integer("round").notNull().default(1),
    kind: varchar("kind", { length: 16, enum: DRAFT_RECORD_KINDS }).notNull(),
    platform: varchar("platform", { length: 16 }),
    event: varchar("event", { length: 16, enum: DRAFT_EVENTS }).notNull(),
    via: varchar("via", { length: 8, enum: DRAFT_VIAS }).notNull(),
    /** The model's name, his email, `cli`, `console`, `scheduler`. */
    by: varchar("by", { length: 200 }),
    text: text("text"),
    title: text("title"),
    /** His words to Claude, or his redraft note. */
    ask: text("ask"),
    reason: varchar("reason", { length: 16, enum: REJECT_REASONS }),
    /** A reject's free text, a failure's error. */
    note: text("note"),
    /** On a model's `generated`: stage, model, provider, system, prompt, max_tokens, usage, raw_text. */
    llm: jsonb("llm").$type<Record<string, unknown>>(),
    /** Approved or scheduled for this time. */
    slot: timestamp("slot", { withTimezone: true }),
    externalId: varchar("external_id", { length: 255 }),
    url: text("url"),
    /** Links: idea, redraft_of, redrafted_as, message, playbook, undo. */
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    runId: uuid("run_id"),
    /** The backfill's key: a second run adds nothing. */
    ref: varchar("ref", { length: 200 }),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.id], name: "pk_draft_events" }),
    index("ix_draft_events_item_id").on(t.item, t.id),
    index("ix_draft_events_kind_at").on(t.kind, t.at),
    unique("uq_draft_events_ref").on(t.ref),
    oneOf("ck_draft_events_kind", t.kind, DRAFT_RECORD_KINDS),
    oneOf("ck_draft_events_event", t.event, DRAFT_EVENTS),
    oneOf("ck_draft_events_via", t.via, DRAFT_VIAS),
    oneOf("ck_draft_events_reason", t.reason, REJECT_REASONS),
  ],
);
export type DraftEventRow = typeof draftEvents.$inferSelect;

/**
 * A list's filters, search, sort and columns kept under a name (`./saved-views.ts`): the viewer's
 * own, or `shared` with everyone in the workspace (that needs `manage`). `workspace` is a client's
 * id, or "wren" for Wren's own apps. `params` is the list's address, as a query string.
 */
export const savedViews = pgTable(
  "saved_views",
  {
    id: serial("id").notNull(),
    workspace: varchar("workspace", { length: 64 }).notNull(),
    viewer: varchar("viewer", { length: 200 }).notNull(),
    record: varchar("record", { length: 64 }).notNull(),
    name: varchar("name", { length: 60 }).notNull(),
    params: text("params").notNull(),
    shared: boolean("shared").default(false).notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.id], name: "pk_saved_views" }),
    index("ix_saved_views_workspace_record").on(t.workspace, t.record, t.position),
  ],
);
export type SavedView = typeof savedViews.$inferSelect;

/**
 * What a viewer arranged, by key (`./saved-views.ts`): a list's last view and columns
 * (`list:<record>`), the rail's pins and order, the Overview's tiles, favorites. Reset deletes.
 */
export const viewerPrefs = pgTable(
  "viewer_prefs",
  {
    workspace: varchar("workspace", { length: 64 }).notNull(),
    viewer: varchar("viewer", { length: 200 }).notNull(),
    key: varchar("key", { length: 100 }).notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.workspace, t.viewer, t.key], name: "pk_viewer_prefs" }),
  ],
);

/** A saved reply or block, inserted from any draft editor or reply box (the Library). */
export const snippets = pgTable(
  "snippets",
  {
    id: serial("id").notNull(),
    workspace: varchar("workspace", { length: 64 }).notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    body: text("body").notNull(),
    /** Free text, shared by the team. */
    tags: text("tags").array().default(sql`'{}'::text[]`).notNull(),
    /** Where it fits: "email", "sms", "dm", "comment"; null fits anywhere. */
    channel: varchar("channel", { length: 16 }),
    createdBy: varchar("created_by", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.id], name: "pk_snippets" }),
    index("ix_snippets_workspace").on(t.workspace, t.title),
  ],
);
export type Snippet = typeof snippets.$inferSelect;

/**
 * Feature flags (`./flags.ts`): variants, ordered rules (first match wins), a fallback and a
 * kill switch. `surface` says who reads it: the portal, the lander (pushed to its edge), or both.
 */
export const flags = pgTable(
  "flags",
  {
    key: varchar("key", { length: 60 }).notNull(),
    about: text("about").default("").notNull(),
    variants: text("variants").array().default(sql`'{off,on}'::text[]`).notNull(),
    rules: jsonb("rules").$type<FlagRule[]>().default(sql`'[]'::jsonb`).notNull(),
    fallback: varchar("fallback", { length: 40 }).default("off").notNull(),
    killed: boolean("killed").default(false).notNull(),
    surface: varchar("surface", { length: 8 }).$type<Surface>().default("portal").notNull(),
    createdBy: varchar("created_by", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.key], name: "pk_flags" }),
    oneOf("ck_flags_surface", t.surface, SURFACES),
    check("ck_flags_fallback", sql`${t.fallback} = ANY(${t.variants})`),
  ],
);
export type Flag = typeof flags.$inferSelect;

/**
 * A site flag under test (`./experiment-store.ts`): its goal, state, and the bandit's latest
 * shares and P(best) by variant, which the edge serves in place of the flag's rules while it runs.
 */
export const flagExperiments = pgTable(
  "flag_experiments",
  {
    flag: varchar("flag", { length: 60 }).notNull(),
    goal: varchar("goal", { length: 8 }).$type<ExperimentGoal>().notNull(),
    state: varchar("state", { length: 10 }).$type<ExperimentState>().default("draft").notNull(),
    shares: jsonb("shares").$type<Record<string, number>>().default(sql`'{}'::jsonb`).notNull(),
    pBest: jsonb("p_best").$type<Record<string, number>>().default(sql`'{}'::jsonb`).notNull(),
    /** Variants the bandit dropped (P(best) under 2% after enough visitors). */
    retired: text("retired").array().default(sql`'{}'::text[]`).notNull(),
    best: varchar("best", { length: 40 }),
    winner: varchar("winner", { length: 40 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    startedBy: varchar("started_by", { length: 200 }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: varchar("ended_by", { length: 200 }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdBy: varchar("created_by", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.flag], name: "pk_flag_experiments" }),
    oneOf("ck_flag_experiments_goal", t.goal, EXPERIMENT_GOALS),
    oneOf("ck_flag_experiments_state", t.state, EXPERIMENT_STATES),
    foreignKey({
      columns: [t.flag],
      foreignColumns: [flags.key],
      name: "fk_flag_experiments_flag_flags",
    }).onDelete("cascade"),
  ],
);
export type FlagExperiment = typeof flagExperiments.$inferSelect;

/**
 * Each site flag's variants per day of first exposure and first-touch channel: visitors who saw
 * it (`exp.seen`, cookie yes), and how many of them went on to a form, a call, a payment.
 * Rolled up from the lander's export by SearchWatch (`@wren/channel-search` flag-days), whole.
 */
export const flagDays = pgTable(
  "flag_days",
  {
    flag: varchar("flag", { length: 60 }).notNull(),
    day: date("day").notNull(),
    variant: varchar("variant", { length: 40 }).notNull(),
    channel: varchar("channel", { length: 40 }).notNull(),
    visitors: integer("visitors").default(0).notNull(),
    forms: integer("forms").default(0).notNull(),
    calls: integer("calls").default(0).notNull(),
    paid: integer("paid").default(0).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.flag, t.day, t.variant, t.channel], name: "pk_flag_days" }),
  ],
);
export type FlagDay = typeof flagDays.$inferSelect;

/**
 * One question for site visitors or client logins (`./survey-store.ts`): its kind and choices,
 * when it shows and who sees it. Live on the site, it rides the edge push with the site flags.
 */
export const surveys = pgTable(
  "surveys",
  {
    key: varchar("key", { length: 60 }).notNull(),
    question: text("question").notNull(),
    kind: varchar("kind", { length: 8 }).$type<SurveyKind>().notNull(),
    choices: text("choices").array().default(sql`'{}'::text[]`).notNull(),
    surface: varchar("surface", { length: 8 }).$type<SurveySurface>().default("site").notNull(),
    trigger: jsonb("trigger").$type<SurveyTrigger>().default(sql`'{"on":"view"}'::jsonb`).notNull(),
    audience: jsonb("audience").$type<SurveyAudience>().default(sql`'{}'::jsonb`).notNull(),
    state: varchar("state", { length: 8 }).$type<SurveyState>().default("draft").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    startedBy: varchar("started_by", { length: 200 }),
    createdBy: varchar("created_by", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.key], name: "pk_surveys" }),
    oneOf("ck_surveys_kind", t.kind, SURVEY_KINDS),
    oneOf("ck_surveys_surface", t.surface, SURVEY_SURFACES),
    oneOf("ck_surveys_state", t.state, SURVEY_STATES),
  ],
);
export type Survey = typeof surveys.$inferSelect;

/**
 * Site answers per survey, day, value and first-touch channel, rolled up from the lander's
 * export by SearchWatch (`@wren/channel-search` survey-days), whole. A text answer counts under
 * the value `text`; the words are read live from the export.
 */
export const surveyDays = pgTable(
  "survey_days",
  {
    survey: varchar("survey", { length: 60 }).notNull(),
    day: date("day").notNull(),
    value: varchar("value", { length: 80 }).notNull(),
    channel: varchar("channel", { length: 40 }).notNull(),
    answers: integer("answers").default(0).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.survey, t.day, t.value, t.channel], name: "pk_survey_days" }),
    foreignKey({
      columns: [t.survey],
      foreignColumns: [surveys.key],
      name: "fk_survey_days_survey_surveys",
    }).onDelete("cascade"),
  ],
);

/** A client login's answer to a portal survey: one per survey, client and person. */
export const surveyAnswers = pgTable(
  "survey_answers",
  {
    id: serial("id").notNull(),
    survey: varchar("survey", { length: 60 }).notNull(),
    client: varchar("client", { length: 40 }).notNull(),
    person: varchar("person", { length: 200 }).notNull(),
    value: text("value").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.id], name: "pk_survey_answers" }),
    unique("uq_survey_answers_survey_client_person").on(t.survey, t.client, t.person),
    index("ix_survey_answers_client").on(t.client),
    foreignKey({
      columns: [t.survey],
      foreignColumns: [surveys.key],
      name: "fk_survey_answers_survey_surveys",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_survey_answers_client_clients",
    }).onDelete("cascade"),
  ],
);
export type SurveyAnswer = typeof surveyAnswers.$inferSelect;

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
    // Firms no niche has claimed: the assignment and render selectors read only these.
    index("ix_companies_unassigned").on(t.id).where(sql`niche IS NULL`),
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
    /** The person this address belongs to, set where a candidate is linked to the lead. */
    personId: integer("person_id"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_leads" }),
    index("ix_leads_person_id").on(t.personId),
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
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_leads_person_id_people",
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

// ---- Templates (designs/2026-10-06-edits-claude-templates.md, 3; 2026-10-07-templates-live-copy.md) ----

/** What a template is: kept here as well as in `slots/kinds.ts`, which the schema can't import. */
export const TEMPLATE_KIND_VALUES = ["email", "sms", "dm", "post", "prompt"] as const;

/** Where a version came from: a default file, a person's edit, a restore, a model, an import. */
export const TEMPLATE_ORIGINS = ["default", "edit", "restore", "ai", "import"] as const;
export type TemplateOrigin = (typeof TEMPLATE_ORIGINS)[number];

/**
 * Copy for one step on one channel, or a model's prompt: who and when live elsewhere. Its words
 * are its versions; `live_version_id` is the one that goes out, `draft_version_id` the newest save
 * nobody published, `waiting_version_id` one asked to go live that waits on a person's yes. Live
 * null: it follows the newest default, or sends nothing when there is none.
 */
export const templates = pgTable(
  "templates",
  {
    id: serial("id").notNull(),
    kind: varchar("kind", { length: 16, enum: TEMPLATE_KIND_VALUES }).notNull(),
    /** Whose copy: a niche for email, `texts`, `reach`, or the package that asks a prompt. */
    system: varchar("system", { length: 32 }).notNull(),
    /** Its key in that system: `book-first/opener`, `recruiting-sms#1`, `reactivation/compose`. */
    name: varchar("name", { length: 64 }).notNull(),
    liveVersionId: integer("live_version_id"),
    draftVersionId: integer("draft_version_id"),
    /** Asked to go live (a send's copy): an item in To approve until a person says yes or no. */
    waitingVersionId: integer("waiting_version_id"),
    waitingBy: varchar("waiting_by", { length: 200 }),
    /** Where it shows in the browser (`a/b`); display only, so moving it never breaks a ref. */
    folder: text("folder").default("").notNull(),
    /** True: live is the newest default version, and a synced default goes live at once. */
    followsDefault: boolean("follows_default").default(false).notNull(),
    /** Why its live version last changed: a publish, an approval or a reset. */
    why: text("why"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.id], name: "pk_templates" }),
    unique("uq_templates_kind_system_name").on(t.kind, t.system, t.name),
    oneOf("ck_templates_kind", t.kind, TEMPLATE_KIND_VALUES),
    index("ix_templates_live_version_id").on(t.liveVersionId),
    index("ix_templates_draft_version_id").on(t.draftVersionId),
    index("ix_templates_waiting_version_id").on(t.waitingVersionId),
    foreignKey({
      columns: [t.waitingVersionId],
      foreignColumns: [templateVersions.id],
      name: "fk_templates_waiting_version_id_template_versions",
    }),
    foreignKey({
      columns: [t.liveVersionId],
      foreignColumns: [templateVersions.id],
      name: "fk_templates_live_version_id_template_versions",
    }),
    foreignKey({
      columns: [t.draftVersionId],
      foreignColumns: [templateVersions.id],
      name: "fk_templates_draft_version_id_template_versions",
    }),
  ],
);

/**
 * Every save of a template, numbered 1, 2, 3 per template. `version` is the hash of its words, so
 * a send's `template_version` names exactly what it said; a restore repeats an old hash under a
 * new number. Never updated but for `published_*`; never deleted. `niche` and `template` repeat
 * the template's system and name: email's experiments read by them.
 */
export const templateVersions = pgTable(
  "template_versions",
  {
    id: serial("id").notNull(),
    templateId: integer("template_id").notNull(),
    niche: varchar("niche", { length: 32 }).notNull(),
    template: varchar("template", { length: 64 }).notNull(),
    version: varchar("version", { length: 12 }).notNull(),
    /** 1, 2, 3 within its template: what a person reads and passes back (`--expect`). */
    number: integer("number").notNull(),
    source: text("source").notNull(),
    origin: varchar("origin", { length: 16, enum: TEMPLATE_ORIGINS }).default("edit").notNull(),
    /** Why it was written, in one line. */
    why: text("why"),
    /** The version the editor had open when this one was saved. */
    openedFrom: integer("opened_from"),
    /** A default's file hash (sha256 of its bytes): sync writes a new one only when it moved. */
    defaultHash: varchar("default_hash", { length: 64 }),
    /** The genome this one was made from; null for a file's version. */
    parentVersion: varchar("parent_version", { length: 12 }),
    /** The email experiment that made it (`experiments.id`). */
    experimentId: integer("experiment_id"),
    /** An operator's address, or a machine as `<what>:<which>` (`import:files`, `pipeline:compose`). */
    createdBy: varchar("created_by", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** When it last went live, and who did it. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: varchar("published_by", { length: 200 }),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.id], name: "pk_template_versions" }),
    index("ix_template_versions_niche").on(t.niche, t.template, t.version),
    unique("uq_template_versions_template_id_number").on(t.templateId, t.number),
    index("ix_template_versions_opened_from")
      .using("btree", t.openedFrom.asc().nullsLast().op("int4_ops"))
      .where(sql`(opened_from IS NOT NULL)`),
    oneOf("ck_template_versions_origin", t.origin, TEMPLATE_ORIGINS),
    foreignKey({
      columns: [t.openedFrom],
      foreignColumns: [t.id],
      name: "fk_template_versions_opened_from_template_versions",
    }),
    foreignKey({
      columns: [t.templateId],
      foreignColumns: [templates.id],
      name: "fk_template_versions_template_id_templates",
    }),
    index("ix_template_versions_experiment_id")
      .using("btree", t.experimentId.asc().nullsLast().op("int4_ops"))
      .where(sql`(experiment_id IS NOT NULL)`),
  ],
);

export type TemplateRow = typeof templates.$inferSelect;
export type TemplateVersion = typeof templateVersions.$inferSelect;
export type NewTemplateVersion = typeof templateVersions.$inferInsert;

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
