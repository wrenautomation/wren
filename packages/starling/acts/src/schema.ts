/**
 * The act base's tables (designs/2026-11-02-starling.md, review 2026-11-03): the accounts Wren
 * acts as, the account a person picked for a draft, and the ledger of sends that must land at
 * most once. Every channel's turn stores (outbound, conversations) key on `reach_accounts`.
 */
import { baseColumns, oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

/** The platforms Wren holds reach logins on. */
export const PLATFORMS = ["reddit", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** `warming` = reads and organic steps only; `active` = may reach out; `paused` = nothing. */
export const ACCOUNT_STATES = ["warming", "active", "paused", "retired"] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

export const reachAccounts = pgTable(
  "reach_accounts",
  {
    ...baseColumns,
    platform: varchar("platform", { length: 16, enum: PLATFORMS }).notNull(),
    /** The autobrowse credential key this account speaks as. */
    account: varchar("account", { length: 120 }).notNull(),
    /** The platform's handle, from the last health read. */
    handle: varchar("handle", { length: 120 }),
    state: varchar("state", { length: 16, enum: ACCOUNT_STATES }).notNull().default("warming"),
    pausedReason: text("paused_reason"),
    /** Day one of outreach from this account (fleet time): the LinkedIn ramp counts from here. */
    startedOn: date("started_on").notNull(),
    /** The last `health()` answer, as the adapter gave it. */
    health: jsonb("health"),
    healthAt: timestamp("health_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_reach_accounts" }),
    unique("uq_reach_accounts_platform_account").on(t.platform, t.account),
    oneOf("ck_reach_accounts_platform", t.platform, PLATFORMS),
    oneOf("ck_reach_accounts_state", t.state, ACCOUNT_STATES),
    check(
      "ck_reach_accounts_paused_reason_iff_paused",
      sql`((state)::text = 'paused'::text) = (paused_reason IS NOT NULL)`,
    ),
  ],
);

/**
 * The account a draft goes out as, when a person picked one (designs/2026-10-15-accounts-first-class.md):
 * one row per draft item (`thread:<id>`, `comment:<id>`, `dm:<id>`, `onpost:<id>`, `draft:<id>`).
 * No row: the item's own account (its place's, the one they spoke to). Every send reads it.
 */
export const draftAccounts = pgTable(
  "draft_accounts",
  {
    item: varchar("item", { length: 120 }).notNull(),
    /** The login's key (`reddit@alt`, `linkedin@wren`). */
    account: varchar("account", { length: 120 }).notNull(),
    /** Who picked it: an email, or null for the console. */
    by: varchar("by", { length: 255 }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.item], name: "pk_draft_accounts" })],
);
export type DraftAccount = typeof draftAccounts.$inferSelect;
export type ReachAccount = typeof reachAccounts.$inferSelect;
/**
 * One send that must land at most once (designs/2026-10-16-maybe-sent.md): a thread comment, an
 * answer, a comment on someone's post, a DM. `sending` while a call is out (a second invocation
 * is refused); `sent` once it went out or our words were found on the site; `unsure` when a send
 * may have gone out and no read could tell. An unsure row with `recheck_at` is asked again
 * (WA-1012); else it waits in To approve for a person: open it on the site, mark it posted, or
 * send it again. Nothing resends it by itself.
 */
export const SEND_ATTEMPT_STATES = ["sending", "sent", "unsure"] as const;
export type SendAttemptState = (typeof SEND_ATTEMPT_STATES)[number];
export const sendAttempts = pgTable(
  "send_attempts",
  {
    /** The item's typed id: `thread:<id>`, `comment:<id>`, `onpost:<id>`, `dm:<message id>`. */
    item: varchar("item", { length: 80 }).notNull(),
    state: varchar("state", { length: 12, enum: SEND_ATTEMPT_STATES }).notNull(),
    platform: varchar("platform", { length: 16 }).notNull(),
    /** The login it went out as (`reddit@alt`); null = the platform's default. */
    account: varchar("account", { length: 80 }),
    /** The words sent, as sent. */
    words: text("words").notNull(),
    /** Where: a post or comment ref, or a handle. */
    target: varchar("target", { length: 200 }).notNull(),
    /** The page to check it on. */
    url: text("url"),
    /** Calls made to the site: at most two before a person decides. */
    tries: smallint("tries").notNull().default(0),
    /** The invocation holding it while `sending`. */
    invocation: varchar("invocation", { length: 120 }),
    /**
     * This send's key (designs/2026-10-16-send-verdicts.md): autobrowse keeps one verdict per
     * key. A claim makes it, a take-over keeps it, a send again makes a new one. Null on a row
     * from before keys, or one parked without a send.
     */
    sendKey: varchar("send_key", { length: 200 }),
    /** The platform's id for what went out, when found or given. */
    ref: varchar("ref", { length: 200 }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Why it is unsure: the failure's words and what the read said. */
    why: text("why"),
    /** Who sent it: `wren` (a rule, like a keyword) or null (a person's send). */
    via: varchar("via", { length: 12, enum: ["person", "wren"] }),
    /** `found` (read back on the site), `sent`, or the person who marked it. */
    settledBy: varchar("settled_by", { length: 120 }),
    /**
     * When the sender asks autobrowse's verdict again (WA-1012); null: a person decides. Set only
     * on an unsure row whose write says where to ask (`ask_service`, `ask_key`).
     */
    recheckAt: timestamp("recheck_at", { withTimezone: true }),
    /** `healthy`: the read failed or the account is held. `time`: the site's list lags. */
    recheckWhen: varchar("recheck_when", { length: 8, enum: ["healthy", "time"] }),
    /** The service whose send journal holds the write (`sites`, `desk`), and the write's key. */
    askService: varchar("ask_service", { length: 40 }),
    askKey: varchar("ask_key", { length: 200 }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.item], name: "pk_send_attempts" }),
    index("ix_send_attempts_state").on(t.state),
    oneOf("ck_send_attempts_state", t.state, SEND_ATTEMPT_STATES),
  ],
);

export type SendAttempt = typeof sendAttempts.$inferSelect;
