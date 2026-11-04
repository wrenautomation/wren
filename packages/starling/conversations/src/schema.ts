/**
 * The turn stores (designs/2026-11-02-starling.md, R2): DM contacts and messages, comments and
 * their threads, and the Inbox protocol tables (WA-1017). Table names are wire names.
 */
import {
  PLATFORMS as CONTENT_PLATFORMS,
  type Platform as ContentPlatform,
} from "@wren/core/autobrowse";
import { platformObjects } from "@wren/core/objects-schema";
import type { Profile } from "@wren/core/outreach";
import { companies, people, runs } from "@wren/core/schema";
import { oneOf } from "@wren/db/columns";
import { PLATFORMS, type Platform, reachAccounts } from "@wren/starling-acts/schema";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
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

export const INBOX_STATUSES = ["open", "waiting", "closed"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

/**
 * One Inbox thread's team state, by its typed id (`dm:5`, `text:8`). No row or no `status`: its
 * status follows the channel's own state. A message in after `status_at` opens it again.
 */
export const inboxThreads = pgTable(
  "inbox_threads",
  {
    thread: varchar("thread", { length: 80 }).notNull(),
    assignee: varchar("assignee", { length: 200 }),
    status: varchar("status", { length: 8, enum: INBOX_STATUSES }),
    statusAt: timestamp("status_at", { withTimezone: true }),
    snoozeUntil: timestamp("snooze_until", { withTimezone: true }),
    updatedBy: varchar("updated_by", { length: 200 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.thread], name: "pk_inbox_threads" }),
    index("ix_inbox_threads_assignee").on(t.assignee),
    oneOf("ck_inbox_threads_status", t.status, INBOX_STATUSES),
  ],
);
export type InboxThread = typeof inboxThreads.$inferSelect;

export const INBOX_CHANNELS = ["email", "text", "dm", "comment", "chat"] as const;
export type InboxChannel = (typeof INBOX_CHANNELS)[number];
/** `queued`: said yes to, held by the frequency cap, and sends itself once they have room. */
export const INBOX_REPLY_STATES = ["waiting", "queued", "sent", "dropped", "failed"] as const;
export type InboxReplyState = (typeof INBOX_REPLY_STATES)[number];

/**
 * A reply from the Inbox that waits on a yes (Ask to send): To approve lists it as `reply:<id>`,
 * and Approve sends it on the channel's own path. `target` is that path's id: the reach contact,
 * the text contact, the comment, the email's call invite or reply.
 */
export const inboxReplies = pgTable(
  "inbox_replies",
  {
    id: serial("id").notNull(),
    thread: varchar("thread", { length: 80 }).notNull(),
    channel: varchar("channel", { length: 8, enum: INBOX_CHANNELS }).notNull(),
    target: varchar("target", { length: 80 }).notNull(),
    who: text("who"),
    body: text("body").notNull(),
    why: text("why"),
    state: varchar("state", { length: 8, enum: INBOX_REPLY_STATES }).notNull().default("waiting"),
    detail: text("detail"),
    /** A `queued` reply's turn: the cap's `until`, when the delayed release sends it. */
    sendAt: timestamp("send_at", { withTimezone: true }),
    askedBy: varchar("asked_by", { length: 200 }).notNull(),
    askedAt: timestamp("asked_at", { withTimezone: true }).notNull().defaultNow(),
    decidedBy: varchar("decided_by", { length: 200 }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_inbox_replies" }),
    index("ix_inbox_replies_state").on(t.state, t.askedAt),
    index("ix_inbox_replies_thread").on(t.thread),
    oneOf("ck_inbox_replies_channel", t.channel, INBOX_CHANNELS),
    oneOf("ck_inbox_replies_state", t.state, INBOX_REPLY_STATES),
  ],
);
export type InboxReply = typeof inboxReplies.$inferSelect;

/**
 * A site chat (designs/2026-10-09-site-chat.md): one visitor's thread from the bubble on the
 * owner's site. The visitor holds the key; we keep its hash. Name and contact are what they typed.
 */
export const chatThreads = pgTable(
  "chat_threads",
  {
    id: serial("id").notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    name: varchar("name", { length: 1200 }),
    email: varchar("email", { length: 200 }),
    phone: varchar("phone", { length: 32 }),
    /** The page it started on. */
    page: text("page"),
    /** SHA-256 of the IP that started it, for the per-visitor cap. Never the IP. */
    ipHash: varchar("ip_hash", { length: 64 }),
    /** Their last message: the Inbox orders and opens on it. */
    lastInAt: timestamp("last_in_at", { withTimezone: true }).notNull().defaultNow(),
    /** When someone on our side last opened it. */
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_chat_threads" }),
    unique("uq_chat_threads_key").on(t.keyHash),
    index("ix_chat_threads_last").on(t.lastInAt),
    index("ix_chat_threads_created").on(t.createdAt),
    index("ix_chat_threads_ip").on(t.ipHash, t.createdAt),
  ],
);
export type ChatThread = typeof chatThreads.$inferSelect;

export const CHAT_DIRECTIONS = ["in", "out"] as const;
export type ChatDirection = (typeof CHAT_DIRECTIONS)[number];

/** One message in a site chat: theirs (`in`) or ours (`out`, with who sent it). */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").notNull(),
    threadId: integer("thread_id").notNull(),
    direction: varchar("direction", { length: 3, enum: CHAT_DIRECTIONS }).notNull(),
    body: text("body").notNull(),
    by: varchar("by", { length: 200 }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_chat_messages" }),
    foreignKey({
      columns: [t.threadId],
      foreignColumns: [chatThreads.id],
      name: "fk_chat_messages_thread",
    }).onDelete("cascade"),
    index("ix_chat_messages_thread").on(t.threadId, t.id),
    oneOf("ck_chat_messages_direction", t.direction, CHAT_DIRECTIONS),
  ],
);
export type ChatMessage = typeof chatMessages.$inferSelect;

/** What happens when someone writes in (designs/2026-10-09-auto-reply.md). */
export const AUTO_REPLY_MODES = ["off", "suggest", "auto"] as const;
export type AutoReplyMode = (typeof AUTO_REPLY_MODES)[number];

/**
 * Auto-reply, per channel, in the database that holds the threads: Wren's in main, a client's in
 * its own. No row is Suggest.
 */
export const autoReplies = pgTable(
  "auto_replies",
  {
    channel: varchar("channel", { length: 8, enum: INBOX_CHANNELS }).notNull(),
    mode: varchar("mode", { length: 8, enum: AUTO_REPLY_MODES }).notNull(),
    updatedBy: varchar("updated_by", { length: 200 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.channel], name: "pk_auto_replies" }),
    oneOf("ck_auto_replies_channel", t.channel, INBOX_CHANNELS),
    oneOf("ck_auto_replies_mode", t.mode, AUTO_REPLY_MODES),
  ],
);

/**
 * Where a DM thread can be: Wren's reach logins, plus a client's connected Facebook Page,
 * Instagram and X (designs/2026-10-07-client-social.md), whose DMs come in through `SocialInbox`.
 */
export const DM_PLATFORMS = [...PLATFORMS, "facebook", "instagram", "x"] as const;
export type DmPlatform = (typeof DM_PLATFORMS)[number];
/** A contact reach itself writes to: Reddit or LinkedIn, on Wren's logins. */
export const isReachPlatform = (p: string): p is Platform =>
  (PLATFORMS as readonly string[]).includes(p);

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

/**
 * `connect` = an invite (LinkedIn); `sequence` = a cold step; `manual` = typed by the operator;
 * `inbound` = theirs; `follow_up` = a Follow-up or Nurture touch on a thread we wrote on.
 */
/** A DM body's cap, every platform. */
export const MESSAGE_MAX = 2000;
export const MESSAGE_KINDS = ["connect", "sequence", "manual", "inbound", "follow_up"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/**
 * Outbound: queued → sending → sent | failed. `unknown` = the platform call's fate is lost; never
 * resent. `proposed` = an invite the sweep picked, waiting on William's yes in To approve; only
 * `queued` sends.
 */
export const MESSAGE_STATES = [
  "proposed",
  "queued",
  "sending",
  "sent",
  "failed",
  "unknown",
  "skipped",
  "received",
] as const;
export type MessageState = (typeof MESSAGE_STATES)[number];

/** Why an invite was proposed: the person, their firm's size and how they found us. */
export interface InviteFit {
  /** One line: "Founder at Acme, 51-200 people. Reacted to our post." */
  why: string;
  title: string | null;
  company: string | null;
  /** Employees, the top of a range ("11-50" = 50); null = not known. */
  employees: number | null;
  /** The size as its source said it ("11-50", "10 - 49", "12"). */
  size: string | null;
  /** How they engaged with us on LinkedIn (`reaction`, `mention`, `follow`); null = not seen. */
  engaged: string | null;
}

export const reachContacts = pgTable(
  "reach_contacts",
  {
    id: serial("id"),
    platform: varchar("platform", { length: 16, enum: DM_PLATFORMS }).notNull(),
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
    /** The metro campaign it was enrolled for; its messages inherit it. Null = the default. */
    campaign: text("campaign"),
    /** LinkedIn: when the invite was accepted (relationship read as connected). */
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    /** LinkedIn: when we withdrew the invite (still pending after `withdrawAfterDays`). */
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Last time the operator opened this thread; inbound after it is unread. */
    readAt: timestamp("read_at", { withTimezone: true }),
    /** Our next message, written for William to edit and send (drafts.ts); null = none waiting. */
    draft: text("draft"),
    draftAt: timestamp("draft_at", { withTimezone: true }),
    /** The inbound message the draft answers; a newer one makes it stale. Null = a first message. */
    draftFor: integer("draft_for"),
    /** LinkedIn invites: why the sweep picked them, as To approve shows it. */
    fit: jsonb("fit").$type<InviteFit>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_reach_contacts" }),
    unique("uq_reach_contacts_platform_handle").on(t.platform, t.handle),
    index("ix_reach_contacts_state").on(t.state),
    index("ix_reach_contacts_company_id").on(t.companyId),
    index("ix_reach_contacts_person_id").on(t.personId),
    index("ix_reach_contacts_account_id").on(t.accountId),
    oneOf("ck_reach_contacts_platform", t.platform, DM_PLATFORMS),
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
    /** The `template_versions` hash of the body's words; null before 2026-10-06. */
    templateVersion: varchar("template_version", { length: 12 }),
    /** The variant picks behind this body (`{version, seed, picks}`), as email keeps them. */
    provenance: jsonb("provenance"),
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
    /** Sends that may have left (tick.ts `markSending`; a not-sent try gives its one back). */
    tries: smallint("tries").default(0).notNull(),
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
    /** One follow-up DM per contact and node (`provenance.follow`). */
    uniqueIndex("uq_reach_messages_follow_up")
      .on(t.contactId, sql`(${t.provenance} ->> 'follow')`)
      .where(sql`(kind)::text = 'follow_up'::text`),
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

/** What Reddit's inbox calls the message: a reply to our post, to our comment, or a mention of us. */
/** `review`: a review of the business itself (designs/2026-10-09-review-replies.md). */
/**
 * `thread_reply`: said in the conversation under our comment but not to us: a reply to their
 * own reply, or to someone else in it. The inbox never lists one; the thread watch reads it
 * (designs/2026-10-15-engage-threads.md).
 */
export const COMMENT_KINDS = [
  "post_reply",
  "comment_reply",
  "username_mention",
  "review",
  "thread_reply",
] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

/**
 * What the sort read a comment as; `ours` = written by one of our accounts; `noise` = nothing to
 * answer, settled in words (`noiseInWords`) and dropped without a model call.
 */
export const COMMENT_SORTS = ["asked", "question", "chat", "hostile", "ours", "noise"] as const;
export type CommentSort = (typeof COMMENT_SORTS)[number];
/** `new` until sorted; `waiting` on William; `answered` in the thread; `dropped` by him or the sort. */
export const COMMENT_STATES = ["new", "waiting", "answered", "dropped"] as const;
export type CommentState = (typeof COMMENT_STATES)[number];
/** `reach` = an outreach account's inbox (answered as that account); `content` = our own posts. */
export const COMMENT_CHANNELS = ["reach", "content"] as const;
export type CommentChannel = (typeof COMMENT_CHANNELS)[number];

/**
 * Every comment on our posts and every answer to our comments (designs/2026-10-01-reach-reddit-linkedin.md,
 * Comments; designs/2026-10-06-social-inbox.md). Reach rows come from an account's inbox; content rows
 * from SocialWatch reading our published posts. One row per platform id; nothing is dropped, ours and
 * removed ones included. Each new row leaves as a `comment` event on the executor.
 */
export const comments = pgTable(
  "comments",
  {
    id: serial("id"),
    platform: varchar("platform", { length: 16 }).$type<ContentPlatform>().notNull(),
    /** Whose inbox listed it: the account that answers it. Null on a content comment. */
    accountId: uuid("account_id"),
    channel: varchar("channel", { length: 16, enum: COMMENT_CHANNELS }).notNull().default("reach"),
    /** The comment's ref in `platform_objects`; so are `post`, `parent` (a comment, or the post) and `answerRef`. */
    ref: varchar("ref", { length: 200 }).notNull(),
    post: varchar("post", { length: 200 }).notNull(),
    parent: varchar("parent", { length: 200 }).notNull(),
    kind: varchar("kind", { length: 32, enum: COMMENT_KINDS }).notNull(),
    place: varchar("place", { length: 200 }),
    /** A review's stars, 1 to 5; null on anything else. */
    stars: smallint("stars"),
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
    index("ix_comments_platform_post").on(t.platform, t.post),
    index("ix_comments_platform_parent").on(t.platform, t.parent),
    index("ix_comments_platform_answer_ref").on(t.platform, t.answerRef),
    index("ix_comments_contact_id").on(t.contactId),
    oneOf("ck_comments_platform", t.platform, CONTENT_PLATFORMS),
    oneOf("ck_comments_channel", t.channel, COMMENT_CHANNELS),
    check(
      "ck_comments_reach_has_account",
      sql`((channel)::text <> 'reach'::text) OR (account_id IS NOT NULL)`,
    ),
    oneOf("ck_comments_kind", t.kind, COMMENT_KINDS),
    check("ck_comments_stars", sql`stars IS NULL OR (stars BETWEEN 1 AND 5)`),
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
    // Every ref a row holds is a `platform_objects` row, spelled by `canonRef`: one spelling per
    // object, so two readers meet on the unique key instead of keeping a comment twice.
    foreignKey({
      columns: [t.platform, t.ref],
      foreignColumns: [platformObjects.platform, platformObjects.ref],
      name: "fk_comments_platform_ref_platform_objects",
    }).onUpdate("cascade"),
    foreignKey({
      columns: [t.platform, t.post],
      foreignColumns: [platformObjects.platform, platformObjects.ref],
      name: "fk_comments_platform_post_platform_objects",
    }).onUpdate("cascade"),
    foreignKey({
      columns: [t.platform, t.parent],
      foreignColumns: [platformObjects.platform, platformObjects.ref],
      name: "fk_comments_platform_parent_platform_objects",
    }).onUpdate("cascade"),
    foreignKey({
      columns: [t.platform, t.answerRef],
      foreignColumns: [platformObjects.platform, platformObjects.ref],
      name: "fk_comments_platform_answer_ref_platform_objects",
    }).onUpdate("cascade"),
  ],
);

/** One comment in a watched thread, as the snapshot keeps it (`ThreadNode` in `@wren/core/outreach`). */
export interface ThreadNodeRow {
  ref: string;
  parent: string;
  handle: string;
  text: string;
  at: string;
  url: string;
}

/**
 * A conversation we are in, watched for what the inbox never lists (designs/2026-10-15-engage-
 * threads.md): one row per post a reach account's comment landed under. While `until` is ahead,
 * the watch probes its comment count with the account's reads and reads it in full when it moves;
 * each read keeps the post and every comment as a snapshot, the Engage context view's source.
 */
export const commentThreads = pgTable(
  "comment_threads",
  {
    id: serial("id"),
    platform: varchar("platform", { length: 16 }).$type<ContentPlatform>().notNull(),
    post: varchar("post", { length: 200 }).notNull(),
    /** The reach account that reads it: the one whose comment is in it. */
    accountId: uuid("account_id").notNull(),
    postTitle: text("post_title"),
    postText: text("post_text"),
    postUrl: text("post_url"),
    postPlace: varchar("post_place", { length: 200 }),
    postAuthor: varchar("post_author", { length: 120 }),
    postMedia: text("post_media"),
    postAt: timestamp("post_at", { withTimezone: true }),
    /** Every comment the last read saw, oldest first, any depth. */
    nodes: jsonb("nodes").$type<ThreadNodeRow[]>().notNull().default([]),
    /** Comments the platform left behind "load more" on the last read. */
    more: integer("more").notNull().default(0),
    /** The platform's count at the last full read; a probe that matches it reads nothing more. */
    count: integer("count"),
    readAt: timestamp("read_at", { withTimezone: true }),
    /** When the watch next probes it: soon after something lands, easing off as it goes quiet. */
    checkAt: timestamp("check_at", { withTimezone: true }).notNull().defaultNow(),
    /** When something of theirs, or our answer, last landed in it. */
    activeAt: timestamp("active_at", { withTimezone: true }).notNull(),
    /** The watch ends here: `followUpDays` after the last activity. */
    until: timestamp("until", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_comment_threads" }),
    unique("uq_comment_threads_platform_post").on(t.platform, t.post),
    index("ix_comment_threads_account_id").on(t.accountId),
    index("ix_comment_threads_until").on(t.until),
    oneOf("ck_comment_threads_platform", t.platform, CONTENT_PLATFORMS),
    check("ck_comment_threads_more", sql`more >= 0`),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [reachAccounts.id],
      name: "fk_comment_threads_account_id_reach_accounts",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.platform, t.post],
      foreignColumns: [platformObjects.platform, platformObjects.ref],
      name: "fk_comment_threads_platform_post_platform_objects",
    }).onUpdate("cascade"),
  ],
);
export type CommentThread = typeof commentThreads.$inferSelect;

/**
 * One row per LinkedIn invite: the connect row and its contact, with where it stands. Accepted
 * and withdrawn come from the contact (`connected_at`, `withdrawn_at`); pending is a sent invite
 * whose contact still waits; ended is one whose contact moved on (declined, opted out); queued is
 * one not yet sent; proposed waits on his yes; else the row's own state (failed, unknown, skipped).
 * Outreach → Invites.
 */
export const reachInvites = pgView("reach_invites", {
  id: integer("id"),
  contactId: integer("contact_id"),
  accountId: uuid("account_id"),
  handle: varchar("handle", { length: 120 }),
  url: text("url"),
  name: text("name"),
  headline: text("headline"),
  niche: varchar("niche", { length: 32 }),
  personId: integer("person_id"),
  companyId: integer("company_id"),
  foundIn: varchar("found_in", { length: 200 }),
  fit: jsonb("fit").$type<InviteFit>(),
  note: text("note"),
  status: varchar("status", { length: 16 }),
  stateReason: text("state_reason"),
  queuedAt: timestamp("queued_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
}).as(
  sql`SELECT m.id, m.contact_id, m.account_id, c.handle, c.url, c.name, c.headline, c.niche, c.person_id, c.company_id, c.found_in, c.fit, NULLIF(m.body, '') AS note, CASE WHEN c.connected_at IS NOT NULL THEN 'accepted' WHEN c.withdrawn_at IS NOT NULL THEN 'withdrawn' WHEN m.state = 'sent' AND c.state = 'enrolled' THEN 'pending' WHEN m.state = 'sent' THEN 'ended' WHEN m.state IN ('queued', 'sending') THEN 'queued' ELSE m.state END AS status, coalesce(m.state_reason, c.state_reason) AS state_reason, m.created_at AS queued_at, m.sent_at, c.connected_at, c.withdrawn_at FROM reach_messages m JOIN reach_contacts c ON c.id = m.contact_id WHERE m.kind = 'connect' AND m.direction = 'out'`,
);

export type ReachContact = typeof reachContacts.$inferSelect;
/** The contact's profile column, typed. Here, db-free, so the portal web can read it. */
export const profileOf = (c: ReachContact): Profile | null => (c.profile as Profile | null) ?? null;
export type ReachMessage = typeof reachMessages.$inferSelect;
export type Comment = typeof comments.$inferSelect;
