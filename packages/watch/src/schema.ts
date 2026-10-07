/**
 * The Monitor's tables (designs/2026-10-05-workflows.md, The Monitor): mail it read and the rules it
 * reads mail by, and the feeds it follows with their items (the radar). A mail row keeps sender,
 * subject, a summary and the verdict, never a body: the snippet stays only until triage reads it.
 * A feed item is public, so its text is kept.
 */
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

export const watch = pgSchema("watch");

/** show: needs you. hold: kept, searchable, out of the way. drop: kept, never shown. */
export const VERDICTS = ["show", "hold", "drop"] as const;
export type Verdict = (typeof VERDICTS)[number];

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
    messageId: varchar("message_id", { length: 64 }).notNull(),
    threadId: varchar("thread_id", { length: 64 }).notNull(),
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
      m.at, 'https://mail.google.com/mail/u/' || m.mailbox || '/#all/' || m.thread_id open,
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

/** A feed the Monitor follows: RSS or Atom (Substack, YouTube channels, GitHub releases, blogs). */
export const feeds = watch.table(
  "feeds",
  {
    id: serial("id"),
    url: text("url").notNull(),
    name: text("name").notNull(),
    /** The last read that worked. */
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    /** The last read's error; null once one works. */
    failure: text("failure"),
    /** Unfollowed: no more reads, its items kept. */
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    by: varchar("by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_feeds" }),
    unique("uq_watch_feeds_url").on(t.url),
  ],
);

/**
 * One feed item, kept before it's scored. `score` (0-10) is how much it should change how Wren
 * works today, against the SOPs; it sets the verdict: 7 and up shows, 4 to 6 holds, the rest drops.
 */
export const items = watch.table(
  "items",
  {
    id: serial("id"),
    feedId: integer("feed_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    text: text("text").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    score: smallint("score"),
    /** Null until scored. */
    verdict: varchar("verdict", { length: 8, enum: VERDICTS }),
    summary: text("summary"),
    /** The SOPs it would change, by name. */
    changes: jsonb("changes").$type<string[]>().notNull().default([]),
    why: text("why"),
    /** Reads of the model's answer; it stops asking after 3. */
    tries: smallint("tries").notNull().default(0),
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_items" }),
    foreignKey({
      columns: [t.feedId],
      foreignColumns: [feeds.id],
      name: "fk_items_feed_id_feeds",
    }),
    unique("uq_watch_items_url").on(t.url),
    index("ix_watch_items_feed").on(t.feedId),
    index("ix_watch_items_created").on(t.createdAt),
    check("ck_watch_items_score", sql`${t.score} between 0 and 10`),
    oneOf("ck_watch_items_verdict", t.verdict, VERDICTS),
  ],
);

/** `items` as console records: `queue` as mail's, plus `waiting` while it isn't scored. */
export const itemRecords = watch
  .view("item_records", {
    id: integer("id"),
    title: text("title"),
    feed: text("feed"),
    score: integer("score"),
    summary: text("summary"),
    changes: text("changes"),
    why: text("why"),
    verdict: text("verdict"),
    queue: text("queue"),
    at: timestamp("at", { withTimezone: true }),
    open: text("open"),
  })
  .as(sql`
    select i.id, i.title, f.name feed, i.score::int score, i.summary,
      (select string_agg(c, ', ') from jsonb_array_elements_text(i.changes) c) changes,
      i.why, i.verdict::text verdict,
      case when i.done_at is not null then 'done' when i.verdict is null then 'waiting'
        when i.verdict = 'show' then 'needs_you' when i.verdict = 'hold' then 'held'
        else 'dropped' end queue,
      coalesce(i.published_at, i.created_at) at, i.url open
    from watch.items i join watch.feeds f on f.id = i.feed_id`);

/** `feeds` as console records, with what each brought. */
export const feedRecords = watch
  .view("feed_records", {
    id: integer("id"),
    name: text("name"),
    url: text("url"),
    state: text("state"),
    items: integer("items"),
    shown: integer("shown"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    failure: text("failure"),
    by: text("by"),
    createdAt: timestamp("created_at", { withTimezone: true }),
  })
  .as(sql`
    select f.id, f.name, f.url,
      case when f.stopped_at is not null then 'stopped' when f.failure is not null then 'failing'
        else 'following' end state,
      count(i.id)::int items, (count(i.id) filter (where i.verdict = 'show'))::int shown,
      f.fetched_at, f.failure, f.by::text by, f.created_at
    from watch.feeds f left join watch.items i on i.feed_id = f.id
    group by f.id`);
