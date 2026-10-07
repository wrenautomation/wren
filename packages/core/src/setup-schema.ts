/**
 * Accounts, their facts and their setups (designs/2026-10-07-setup-and-vendors.md). Main only:
 * Wren's team reads across clients and the Shop gates parts on facts. A row with no client is
 * Wren's own, as `hooks` does it.
 */
import { oneOf } from "@wren/db/columns";
import {
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
  varchar,
} from "drizzle-orm/pg-core";
import { clients, SETUP_MODES, type SetupMode } from "./clients/schema.js";

/** A fact's state: true now, not yet, or was true and failed a check since. */
export const FACT_STATES = ["ok", "waiting", "lost"] as const;
export type FactState = (typeof FACT_STATES)[number];

/**
 * Where a setup run is. `waiting_client`: a step the client does. `waiting_wren`: a step Wren's
 * team or its agent does, or one that waits on William's yes. `checking`: nobody acts, a check
 * waits on a status. `stuck`: past its step's `within`. `lost`: a fact it set failed a recheck.
 */
export const SETUP_STATES = [
  "checking",
  "waiting_client",
  "waiting_wren",
  "done",
  "stuck",
  "lost",
] as const;
export type SetupState = (typeof SETUP_STATES)[number];

/**
 * One account an owner has on a site: a phone number, a sending domain, an inbox, a Search
 * Console property, an ad account, a login. `clients.accounts` keeps the Shop's one per site;
 * saving one there writes a row here too (`registerAccounts`), so this is the superset.
 */
export const clientAccounts = pgTable(
  "client_accounts",
  {
    id: serial("id").notNull(),
    /** Whose; null is Wren's. */
    client: varchar("client", { length: 40 }),
    /** A registry site (`REGISTRY_SITES`): `telnyx`, `domain`, `inbox`, `search_console`. */
    site: varchar("site", { length: 32 }).notNull(),
    /** What it is on that site: `+15550100`, `example.com`, `act_123`. */
    ref: varchar("ref", { length: 200 }).notNull(),
    /** What it's for: `main`, `sends`, `research`. */
    role: varchar("role", { length: 32 }).default("main").notNull(),
    mode: varchar("mode", { length: 8, enum: SETUP_MODES })
      .$type<SetupMode>()
      .default("self")
      .notNull(),
    /** The credvault login Wren signs in with, done for you; its value never sits here. */
    login: varchar("login", { length: 120 }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_client_accounts" }),
    unique("uq_client_accounts_ref").on(t.client, t.site, t.ref).nullsNotDistinct(),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_client_accounts_client",
    }).onDelete("cascade"),
    oneOf("ck_client_accounts_mode", t.mode, SETUP_MODES),
  ],
);
export type AccountRow = typeof clientAccounts.$inferSelect;

/** A named truth about one account: `telnyx.campaign_approved`, set by a check or a person. */
export const accountFacts = pgTable(
  "account_facts",
  {
    accountId: integer("account_id").notNull(),
    fact: varchar("fact", { length: 80 }).notNull(),
    state: varchar("state", { length: 8, enum: FACT_STATES }).$type<FactState>().notNull(),
    /** Said to a person: what the last check saw, or what's left to do. */
    why: text("why"),
    /** What the check read, as data. */
    seen: jsonb("seen"),
    /** `check:<name>`, `agent`, or the login that marked it. */
    by: varchar("by", { length: 320 }).notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
    /** When it last became true. */
    okAt: timestamp("ok_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.fact], name: "pk_account_facts" }),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [clientAccounts.id],
      name: "fk_account_facts_account",
    }).onDelete("cascade"),
    oneOf("ck_account_facts_state", t.state, FACT_STATES),
  ],
);
export type FactRow = typeof accountFacts.$inferSelect;

/**
 * One setup on one account. Its events walk the spine in the owner's database under subject
 * `account:<id>:g<gen>`; a restart after a lost fact is the next generation.
 */
export const setupRuns = pgTable(
  "setup_runs",
  {
    id: serial("id").notNull(),
    accountId: integer("account_id").notNull(),
    /** The setup workflow's id: `setup.phone`. */
    setup: varchar("setup", { length: 64 }).notNull(),
    gen: integer("gen").default(1).notNull(),
    mode: varchar("mode", { length: 8, enum: SETUP_MODES }).$type<SetupMode>().notNull(),
    state: varchar("state", { length: 16, enum: SETUP_STATES }).$type<SetupState>().notNull(),
    /** The step it waits on; null once done. */
    step: varchar("step", { length: 40 }),
    why: text("why"),
    /** Checks made at the current step. */
    rounds: integer("rounds").default(0).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    /** When it reached its current step: `within` counts from here. */
    stepSince: timestamp("step_since", { withTimezone: true }).defaultNow().notNull(),
    doneAt: timestamp("done_at", { withTimezone: true }),
    /** The next check: a waiting step's round, or a done run's repeat. */
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    by: varchar("by", { length: 320 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_setup_runs" }),
    unique("uq_setup_runs_account").on(t.accountId, t.setup),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [clientAccounts.id],
      name: "fk_setup_runs_account",
    }).onDelete("cascade"),
    index("ix_setup_runs_due").on(t.state, t.nextCheckAt),
    oneOf("ck_setup_runs_mode", t.mode, SETUP_MODES),
    oneOf("ck_setup_runs_state", t.state, SETUP_STATES),
  ],
);
export type SetupRunRow = typeof setupRuns.$inferSelect;

/**
 * What a setup alert reports: a fact lost, a step stuck past its `within`, a step waiting on a
 * person, a setup done, or a part paused or resumed because of a fact.
 */
export const ALERT_KINDS = ["lost", "stuck", "waiting", "done", "paused", "resumed"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** Who must act on it: the client's people, or Wren's team. */
export const ALERT_FOR = ["client", "wren"] as const;
export type AlertFor = (typeof ALERT_FOR)[number];

export const ALERT_LEVELS = ["info", "action", "warning"] as const;

/**
 * One setup alert per state change (`key`), never one per check round. Open until the state it
 * reports changes (`cleared_at`); kept after, as the account's timeline. Shown on Now and the
 * Accounts badge, never in an Inbox. `told_at`: the team's lane heard it; `digest_at`: the last
 * daily digest that named it, still open.
 */
export const setupAlerts = pgTable(
  "setup_alerts",
  {
    id: serial("id").notNull(),
    /** `<kind>:<account>:...`: the state change it reports, once. */
    key: varchar("key", { length: 200 }).notNull(),
    /** Whose; null is Wren's. */
    client: varchar("client", { length: 40 }),
    accountId: integer("account_id").notNull(),
    kind: varchar("kind", { length: 8, enum: ALERT_KINDS }).$type<AlertKind>().notNull(),
    for: varchar("for", { length: 8, enum: ALERT_FOR }).$type<AlertFor>().notNull(),
    level: varchar("level", { length: 8, enum: ALERT_LEVELS })
      .$type<(typeof ALERT_LEVELS)[number]>()
      .notNull(),
    setup: varchar("setup", { length: 64 }),
    step: varchar("step", { length: 40 }),
    fact: varchar("fact", { length: 80 }),
    /** The part paused or resumed: a component id. */
    part: varchar("part", { length: 64 }),
    /** Said to a person, no secrets: "Sending domain example.com: SPF, DKIM and DMARC lost". */
    title: text("title").notNull(),
    body: text("body"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    toldAt: timestamp("told_at", { withTimezone: true }),
    digestAt: timestamp("digest_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_setup_alerts" }),
    unique("uq_setup_alerts_key").on(t.key),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [clientAccounts.id],
      name: "fk_setup_alerts_account",
    }).onDelete("cascade"),
    index("ix_setup_alerts_open").on(t.client, t.clearedAt),
    index("ix_setup_alerts_account").on(t.accountId, t.at),
    oneOf("ck_setup_alerts_kind", t.kind, ALERT_KINDS),
    oneOf("ck_setup_alerts_for", t.for, ALERT_FOR),
    oneOf("ck_setup_alerts_level", t.level, ALERT_LEVELS),
  ],
);
export type AlertRow = typeof setupAlerts.$inferSelect;
