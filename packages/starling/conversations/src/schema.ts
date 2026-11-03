// Inbox protocol tables (WA-1017). Table names are wire names.
import { oneOf } from "@wren/db/columns";
import {
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
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
