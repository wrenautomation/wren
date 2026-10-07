/**
 * The Monitor's tables (designs/2026-10-05-workflows.md, The Monitor): mail it read and the rules it
 * reads mail by. A mail row keeps sender, subject, a summary and the verdict, never a body: the
 * snippet stays only until triage reads it. Feeds and their items are Learn's (`@wren/learn`).
 */
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  pgSchema,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

export const watch = pgSchema("watch");

/** show: needs you. hold: kept, searchable, out of the way. drop: kept, never shown. */
export const VERDICTS = ["show", "hold", "drop"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const READERS = ["monitor", "mail"] as const;
export type Reader = (typeof READERS)[number];

export const rules = watch.table(
  "rules",
  {
    id: serial("id"),
    /** The rule in plain words; the model reads every rule's. */
    words: text("words").notNull(),
    /** An address, or a domain (and its subdomains). With a verdict, code settles it for $0. */
    sender: varchar("sender", { length: 320 }),
    /** Words the subject must hold, any case. */
    subject: text("subject"),
    verdict: varchar("verdict", { length: 8, enum: VERDICTS }),
    by: varchar("by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_rules" }),
    oneOf("ck_watch_rules_verdict", t.verdict, VERDICTS),
  ],
);

export const mail = watch.table(
  "mail",
  {
    id: serial("id"),
    /** The inbox it came to. */
    mailbox: varchar("mailbox", { length: 320 }).notNull(),
    /** Gmail's ids are 16 hex; Microsoft Graph's run to about 150 characters. */
    messageId: varchar("message_id", { length: 255 }).notNull(),
    threadId: varchar("thread_id", { length: 255 }).notNull(),
    fromName: text("from_name").notNull(),
    fromAddress: varchar("from_address", { length: 320 }).notNull(),
    subject: text("subject").notNull(),
    /** Gmail's preview line, until triage reads it. */
    snippet: text("snippet"),
    at: timestamp("at", { withTimezone: true }).notNull(),
    /** Null until triage reads it. */
    verdict: varchar("verdict", { length: 8, enum: VERDICTS }),
    why: text("why"),
    /** One line from the model; null when a rule settled it. */
    summary: text("summary"),
    ruleId: integer("rule_id"),
    /** Where a person opens it, when the provider names it (Outlook); null: Gmail's thread URL. */
    link: text("link"),
    /**
     * Who read it in: `monitor` (William's inboxes, the Inbox app's "Your mail"), or `mail` (a
     * client's mailbox connected on Account → Mail, into Marketing → Inbox).
     */
    reader: varchar("reader", { length: 8, enum: READERS }).default("monitor").notNull(),
    /** William dealt with it. */
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_mail" }),
    foreignKey({
      columns: [t.ruleId],
      foreignColumns: [rules.id],
      name: "fk_mail_rule_id_rules",
    }).onDelete("set null"),
    unique("uq_watch_mail_message").on(t.mailbox, t.messageId),
    index("ix_watch_mail_from").on(t.fromAddress),
    index("ix_watch_mail_at").on(t.at),
    index("ix_watch_mail_rule").on(t.ruleId),
    oneOf("ck_watch_mail_verdict", t.verdict, VERDICTS),
    oneOf("ck_watch_mail_reader", t.reader, READERS),
  ],
);

/**
 * `mail` as console records (`./records.ts`). `queue` is where it shows: needs you (shown and not
 * done, or unread by triage), held, dropped, or done. `held` counts held mail from the same sender.
 */
export const mailRecords = watch
  .view("mail_records", {
    id: integer("id"),
    mailbox: text("mailbox"),
    sender: text("sender"),
    fromAddress: text("from_address"),
    subject: text("subject"),
    summary: text("summary"),
    verdict: text("verdict"),
    why: text("why"),
    queue: text("queue"),
    at: timestamp("at", { withTimezone: true }),
    open: text("open"),
    held: integer("held"),
    others: text("others"),
  })
  .as(sql`
    select m.id, m.mailbox, coalesce(nullif(m.from_name, ''), m.from_address)::text sender,
      m.from_address::text from_address, m.subject, m.summary, m.verdict::text verdict, m.why,
      case when m.done_at is not null then 'done'
        when m.verdict is null or m.verdict = 'show' then 'needs_you'
        when m.verdict = 'hold' then 'held' else 'dropped' end queue,
      m.at, coalesce(m.link, 'https://mail.google.com/mail/u/' || m.mailbox || '/#all/' || m.thread_id) open,
      h.n::int held,
      case when h.n > 0 then '/inbox/mail?view=held&fromAddress=~' || m.from_address end others
    from watch.mail m
    left join lateral (select count(*) n from watch.mail o
      where o.from_address = m.from_address and o.verdict = 'hold' and o.id <> m.id) h on true`);

/** `rules` as console records. */
export const ruleRecords = watch
  .view("rule_records", {
    id: integer("id"),
    words: text("words"),
    sender: text("sender"),
    subject: text("subject"),
    verdict: text("verdict"),
    settles: text("settles"),
    by: text("by"),
    createdAt: timestamp("created_at", { withTimezone: true }),
  })
  .as(sql`
    select r.id, r.words, r.sender::text sender, r.subject, r.verdict::text verdict,
      case when r.sender is not null and r.verdict is not null then 'code' else 'model' end settles,
      r.by::text by, r.created_at
    from watch.rules r`);
