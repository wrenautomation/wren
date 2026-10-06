/**
 * Cold outreach on Reddit and LinkedIn: four tables, each one fact.
 *
 * - `reach_accounts`: the accounts we speak as, one row per autobrowse
 *   credential (`reddit@alt`, `linkedin@wren`), with the last health read
 *   (age, karma, suspended) the warmup protocol runs on.
 * - `reach_contacts`: a person on a platform, where a search found them,
 *   what their page said, and where their sequence stands. The sticky
 *   account lives here: one person is always reached from one account.
 * - `reach_messages`: every connect, message and reply, both ways. Outbound
 *   rows are written as intent (`sending`) before the platform is called, so
 *   a crash never sends twice.
 * - `reach_templates`: William's words for each slot code declares
 *   (sequences.ts). No row = empty = that step never goes.
 *
 * Opt-outs ("stop messaging me") are `suppressions` rows of kind `handle`
 * (core), the same table every channel reads.
 */
import { companies, people, runs } from "@wren/core/schema";
import { baseColumns, oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const PLATFORMS = ["reddit", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** `warming` = reads and organic steps only; `active` = may reach out; `paused` = nothing. */
export const ACCOUNT_STATES = ["warming", "active", "paused", "retired"] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

/**
 * new → enrolled → (connected →) replied | finished | unreachable. `opted_out`
 * = they said stop; `blocked` = the platform refused us on them.
 */
export const CONTACT_STATES = [
  "new",
  "enrolled",
  "connected",
  "replied",
  "finished",
  "unreachable",
  "opted_out",
  "blocked",
] as const;
export type ContactState = (typeof CONTACT_STATES)[number];

export const DIRECTIONS = ["out", "in"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** `connect` = an invite (LinkedIn); `sequence` = a cold step; `manual` = typed by the operator; `inbound` = theirs. */
export const MESSAGE_KINDS = ["connect", "sequence", "manual", "inbound"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** Outbound: queued → sending → sent | failed. `unknown` = the platform call's fate is lost; never resent. */
export const MESSAGE_STATES = [
  "queued",
  "sending",
  "sent",
  "failed",
  "unknown",
  "skipped",
  "received",
] as const;
export type MessageState = (typeof MESSAGE_STATES)[number];

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

export const reachContacts = pgTable(
  "reach_contacts",
  {
    id: serial("id"),
    platform: varchar("platform", { length: 16, enum: PLATFORMS }).notNull(),
    handle: varchar("handle", { length: 120 }).notNull(),
    url: text("url").notNull(),
    name: text("name"),
    headline: text("headline"),
    /** Where the search saw them (`r/startups`, `search:founder recruiting`, `company/acme`, `manual`). */
    foundIn: varchar("found_in", { length: 200 }).notNull(),
    companyId: integer("company_id"),
    personId: integer("person_id"),
    niche: varchar("niche", { length: 32 }),
    /** The page as `enrich` read it; null until read. */
    profile: jsonb("profile"),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    /** The sticky sender. */
    accountId: uuid("account_id"),
    state: varchar("state", { length: 16, enum: CONTACT_STATES }).notNull().default("new"),
    stateReason: text("state_reason"),
    sequence: varchar("sequence", { length: 64 }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
    /** LinkedIn: when the invite was accepted (relationship read as connected). */
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Last time the operator opened this thread; inbound after it is unread. */
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_reach_contacts" }),
    unique("uq_reach_contacts_platform_handle").on(t.platform, t.handle),
    index("ix_reach_contacts_state").on(t.state),
    index("ix_reach_contacts_company_id").on(t.companyId),
    index("ix_reach_contacts_person_id").on(t.personId),
    index("ix_reach_contacts_account_id").on(t.accountId),
    oneOf("ck_reach_contacts_platform", t.platform, PLATFORMS),
    oneOf("ck_reach_contacts_state", t.state, CONTACT_STATES),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_reach_contacts_company_id_companies",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_reach_contacts_person_id_people",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [reachAccounts.id],
      name: "fk_reach_contacts_account_id_reach_accounts",
    }).onDelete("set null"),
  ],
);

export const reachMessages = pgTable(
  "reach_messages",
  {
    id: serial("id"),
    contactId: integer("contact_id").notNull(),
    accountId: uuid("account_id"),
    direction: varchar("direction", { length: 4, enum: DIRECTIONS }).notNull(),
    kind: varchar("kind", { length: 16, enum: MESSAGE_KINDS }).notNull(),
    /** The sequence step (1-based) for `sequence` rows. */
    step: smallint("step"),
    /** The slot key the body was rendered from. */
    template: varchar("template", { length: 120 }),
    subject: text("subject"),
    body: text("body").notNull(),
    state: varchar("state", { length: 16, enum: MESSAGE_STATES }).notNull(),
    stateReason: text("state_reason"),
    /** Outbound: not before this. */
    dueAt: timestamp("due_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** The platform's id for it (an inbound message's name, a sent one's ref when given). */
    ref: varchar("ref", { length: 200 }),
    runId: uuid("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_reach_messages" }),
    index("ix_reach_messages_contact_id").on(t.contactId),
    index("ix_reach_messages_due").on(t.state, t.dueAt),
    index("ix_reach_messages_account_id").on(t.accountId),
    index("ix_reach_messages_run_id").on(t.runId),
    /** One inbound row per platform id. */
    uniqueIndex("uq_reach_messages_in_ref")
      .on(t.contactId, t.ref)
      .where(sql`(direction)::text = 'in'::text`),
    oneOf("ck_reach_messages_direction", t.direction, DIRECTIONS),
    oneOf("ck_reach_messages_kind", t.kind, MESSAGE_KINDS),
    oneOf("ck_reach_messages_state", t.state, MESSAGE_STATES),
    foreignKey({
      columns: [t.contactId],
      foreignColumns: [reachContacts.id],
      name: "fk_reach_messages_contact_id_reach_contacts",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [reachAccounts.id],
      name: "fk_reach_messages_account_id_reach_accounts",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_reach_messages_run_id_runs",
    }).onDelete("set null"),
  ],
);

export const reachTemplates = pgTable(
  "reach_templates",
  {
    /** A slot key: `<platform>:<sequence>#<step>` or `linkedin:connect-note`. */
    key: varchar("key", { length: 120 }).notNull(),
    body: text("body").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Who saved it: an operator's email, or `cli`. */
    updatedBy: varchar("updated_by", { length: 200 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.key], name: "pk_reach_templates" })],
);

/** What Reddit's inbox calls the message: a reply to our post, to our comment, or a mention of us. */
export const COMMENT_KINDS = ["post_reply", "comment_reply", "username_mention"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

/** What the sort read a comment as; `ours` = written by one of our accounts. */
export const COMMENT_SORTS = ["asked", "question", "chat", "hostile", "ours"] as const;
export type CommentSort = (typeof COMMENT_SORTS)[number];
/** `new` until sorted; `waiting` on William; `answered` in the thread; `dropped` by him or the sort. */
export const COMMENT_STATES = ["new", "waiting", "answered", "dropped"] as const;
export type CommentState = (typeof COMMENT_STATES)[number];

/**
 * Every comment on our posts and every answer to our comments, as the account's inbox listed it
 * (designs/2026-10-01-reach-reddit-linkedin.md, Comments). One row per platform id; nothing is
 * dropped, ours and removed ones included. Each new row leaves as a `comment` event on the spine.
 */
export const comments = pgTable(
  "comments",
  {
    id: serial("id"),
    platform: varchar("platform", { length: 16, enum: PLATFORMS }).notNull(),
    /** Whose inbox listed it: the account that answers it. */
    accountId: uuid("account_id").notNull(),
    ref: varchar("ref", { length: 200 }).notNull(),
    post: varchar("post", { length: 200 }).notNull(),
    parent: varchar("parent", { length: 200 }).notNull(),
    kind: varchar("kind", { length: 32, enum: COMMENT_KINDS }).notNull(),
    place: varchar("place", { length: 200 }),
    postTitle: text("post_title"),
    author: varchar("author", { length: 120 }).notNull(),
    body: text("body").notNull(),
    url: text("url").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    raw: jsonb("raw").notNull(),
    sort: varchar("sort", { length: 16, enum: COMMENT_SORTS }),
    why: text("why"),
    /** An answer for the thread, William's to edit and send. */
    draft: text("draft"),
    state: varchar("state", { length: 16, enum: COMMENT_STATES }).notNull().default("new"),
    answer: text("answer"),
    answerRef: varchar("answer_ref", { length: 200 }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    /** Their DM thread, once William wrote to them. */
    contactId: integer("contact_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_comments" }),
    unique("uq_comments_platform_ref").on(t.platform, t.ref),
    index("ix_comments_state").on(t.state),
    index("ix_comments_account_id").on(t.accountId),
    index("ix_comments_post").on(t.post),
    index("ix_comments_contact_id").on(t.contactId),
    oneOf("ck_comments_platform", t.platform, PLATFORMS),
    oneOf("ck_comments_kind", t.kind, COMMENT_KINDS),
    oneOf("ck_comments_sort", t.sort, COMMENT_SORTS),
    oneOf("ck_comments_state", t.state, COMMENT_STATES),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [reachAccounts.id],
      name: "fk_comments_account_id_reach_accounts",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.contactId],
      foreignColumns: [reachContacts.id],
      name: "fk_comments_contact_id_reach_contacts",
    }).onDelete("set null"),
  ],
);

export type ReachAccount = typeof reachAccounts.$inferSelect;
export type ReachContact = typeof reachContacts.$inferSelect;
export type ReachMessage = typeof reachMessages.$inferSelect;
export type Comment = typeof comments.$inferSelect;

/**
 * Reddit discovery (designs/2026-10-06-reddit-discovery.md): people, places and threads, all read
 * signed out through autobrowse's `reddit-public`. Raw reads are kept whole; the model's reading
 * sits beside them, each fact with the words it came from.
 */
export const PLACE_STATES = ["found", "watching", "skipped"] as const;
export const THREAD_STATES = [
  "new",
  "dropped",
  "ranked",
  "queued",
  "commented",
  "skipped",
] as const;
export const THREAD_KINDS = ["help", "tools", "story", "venting", "hiring", "other"] as const;

/** One fact the model read off their own words. */
export interface Quoted {
  value: string;
  quote: string;
}

/** What code reads off a profile, $0. */
export interface PersonFacts {
  ageDays: number | null;
  karma: number | null;
  /** Where they post most, by count. */
  places: { place: string; n: number }[];
  /** Domains they linked, by count. */
  domains: { domain: string; n: number }[];
  /** The UTC hour they post most, and a guessed offset from it. */
  peakHourUtc: number | null;
}

/** What the model reads off a profile: each fact quotes them. */
export interface PersonRead {
  role: Quoted | null;
  business: Quoted | null;
  size: Quoted | null;
  location: Quoted | null;
  website: Quoted | null;
  struggles: Quoted[];
  why: string;
}

export const redditPeople = pgTable(
  "reddit_people",
  {
    /** Lowercase: Reddit names ignore case. */
    handle: varchar("handle", { length: 64 }).notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    /** The three reads: about, last 100 posts, last 100 comments. */
    raw: jsonb("raw").notNull(),
    facts: jsonb("facts").$type<PersonFacts>().notNull(),
    read: jsonb("read").$type<PersonRead>(),
    fit: smallint("fit"),
    /** A domain they call their own, from their words; never guessed. */
    site: varchar("site", { length: 253 }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.handle], name: "pk_reddit_people" }),
    index("ix_reddit_people_read_at").on(t.readAt),
    check("ck_reddit_people_fit", sql`${t.fit} between 0 and 10`),
  ],
);

/** A subreddit's rules and pace in plain words, as the model read them. */
export interface PlaceJudged {
  fit: number;
  why: string;
  rules: string;
  mayComment: boolean;
  mayPost: boolean;
  linkOnly: boolean;
  karmaMin: number | null;
  ageMinDays: number | null;
  postsADay: number;
  medianComments: number;
}

export const redditPlaces = pgTable(
  "reddit_places",
  {
    /** Lowercase, without r/. */
    subreddit: varchar("subreddit", { length: 64 }).notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    /** "topic: <words>", "named" or "people": how it was found. */
    foundBy: text("found_by").notNull(),
    /** about, rules, top of the week and new, as read. */
    raw: jsonb("raw"),
    judged: jsonb("judged").$type<PlaceJudged>(),
    fit: smallint("fit"),
    subscribers: integer("subscribers"),
    state: varchar("state", { length: 16, enum: PLACE_STATES }).notNull().default("found"),
    /** The pool account that works it: one per place, so two of ours never meet. */
    accountId: uuid("account_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    threadsAt: timestamp("threads_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.subreddit], name: "pk_reddit_places" }),
    index("ix_reddit_places_state").on(t.state),
    index("ix_reddit_places_account_id").on(t.accountId),
    oneOf("ck_reddit_places_state", t.state, PLACE_STATES),
    check("ck_reddit_places_fit", sql`${t.fit} between 0 and 10`),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [reachAccounts.id],
      name: "fk_reddit_places_account_id_reach_accounts",
    }).onDelete("set null"),
  ],
);

export const redditThreads = pgTable(
  "reddit_threads",
  {
    /** The post's fullname, t3_…. */
    id: varchar("id", { length: 20 }).notNull(),
    subreddit: varchar("subreddit", { length: 64 }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    author: varchar("author", { length: 64 }).notNull(),
    url: text("url").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    comments: integer("comments").notNull(),
    raw: jsonb("raw").notNull(),
    /** Code's reason to drop it, $0; null when it passed. */
    dropped: text("dropped"),
    kind: varchar("kind", { length: 16, enum: THREAD_KINDS }),
    fit: smallint("fit"),
    angle: text("angle"),
    /** What to answer: the post (t3_…) or a comment in it that asks (t1_…). */
    target: varchar("target", { length: 20 }),
    targetText: text("target_text"),
    draft: text("draft"),
    /** What the draft read: the thread, the OP, our own facts. */
    sources: jsonb("sources").$type<{ label: string; text: string }[]>(),
    state: varchar("state", { length: 16, enum: THREAD_STATES }).notNull().default("new"),
    accountId: uuid("account_id"),
    answer: text("answer"),
    answerRef: varchar("answer_ref", { length: 20 }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    /** Our comment's score two days on: the place's hit rate. */
    score: integer("score"),
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_reddit_threads" }),
    index("ix_reddit_threads_subreddit").on(t.subreddit),
    index("ix_reddit_threads_state").on(t.state),
    index("ix_reddit_threads_account_id").on(t.accountId),
    oneOf("ck_reddit_threads_state", t.state, THREAD_STATES),
    oneOf("ck_reddit_threads_kind", t.kind, THREAD_KINDS),
    check("ck_reddit_threads_fit", sql`${t.fit} between 0 and 10`),
    foreignKey({
      columns: [t.subreddit],
      foreignColumns: [redditPlaces.subreddit],
      name: "fk_reddit_threads_subreddit_reddit_places",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [reachAccounts.id],
      name: "fk_reddit_threads_account_id_reach_accounts",
    }).onDelete("set null"),
  ],
);

export type RedditPerson = typeof redditPeople.$inferSelect;
export type RedditPlace = typeof redditPlaces.$inferSelect;
export type RedditThread = typeof redditThreads.$inferSelect;
