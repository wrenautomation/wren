/**
 * The content loop's tables. An idea is William's raw input (a few lines,
 * maybe a file); a draft is one platform's version of it, written by the LLM,
 * reviewed by a person, published by the scheduler. Everything the model wrote
 * stays on the draft row beside the audit envelope.
 * Design: designs/2026-09-22-content-loop.md.
 */
import { type Media, PLATFORMS, type Platform } from "@wren/core/content";
import { baseColumns, nonNegative, oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const IDEA_STATUSES = ["open", "drafted", "archived"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export const IDEA_SOURCES = ["cli", "api", "ads"] as const;
export type IdeaSource = (typeof IDEA_SOURCES)[number];

export const DRAFT_STATUSES = [
  "draft",
  "approved",
  "rejected",
  "publishing",
  "published",
  "failed",
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const contentIdeas = pgTable(
  "content_ideas",
  {
    ...baseColumns,
    text: text("text").notNull(),
    /** A file or URL to publish with it (a short, a screenshot); the drafts inherit it. */
    media: jsonb("media").$type<Media>(),
    source: varchar("source", { length: 16, enum: IDEA_SOURCES }).notNull(),
    status: varchar("status", { length: 16, enum: IDEA_STATUSES }).notNull().default("open"),
  },
  (t) => [
    index("ix_content_ideas_status_created_at").on(t.status, t.createdAt),
    oneOf("ck_content_ideas_source", t.source, IDEA_SOURCES),
    oneOf("ck_content_ideas_status", t.status, IDEA_STATUSES),
  ],
);

/**
 * A platform's playbook: an SOP from the private sops folder, pushed with
 * `wren sop push <name> --platform <p>` and read into every draft prompt for
 * that platform. Insert-only: the newest row per platform is the live one,
 * older rows say what earlier drafts were written against.
 */
export const contentPlaybooks = pgTable(
  "content_playbooks",
  {
    ...baseColumns,
    platform: varchar("platform", { length: 16 }).$type<Platform>().notNull(),
    /** The SOP's folder name, as in `wren sop ls`. */
    sop: varchar("sop", { length: 64 }).notNull(),
    text: text("text").notNull(),
  },
  (t) => [
    index("ix_content_playbooks_platform_created_at").on(t.platform, t.createdAt),
    oneOf("ck_content_playbooks_platform", t.platform, PLATFORMS),
  ],
);

export const contentDrafts = pgTable(
  "content_drafts",
  {
    ...baseColumns,
    ideaId: uuid("idea_id")
      .notNull()
      .references(() => contentIdeas.id, { onDelete: "cascade" }),
    platform: varchar("platform", { length: 16 }).$type<Platform>().notNull(),
    /** The body: a post, a caption, a video description. */
    text: text("text").notNull(),
    /** YouTube's title, TikTok's; null where the platform has none. */
    title: varchar("title", { length: 200 }),
    media: jsonb("media").$type<Media>(),
    /** Platform extras handed to the adapter as-is (visibility, privacy, tags). */
    extra: jsonb("extra").$type<Record<string, unknown>>().notNull().default({}),
    status: varchar("status", { length: 16, enum: DRAFT_STATUSES }).notNull().default("draft"),
    /** A person changed the text after the model wrote it. */
    edited: boolean("edited").notNull().default(false),
    /** Publish at or after this; null = as soon as approved. */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedId: varchar("published_id", { length: 255 }),
    url: varchar("url", { length: 2048 }),
    /** The last publish error; cleared when re-approved. */
    error: text("error"),
    /** The draft this one rewrote, and the person's note that asked for it ("shorter, keep the discord line"). */
    redraftOf: uuid("redraft_of").references((): AnyPgColumn => contentDrafts.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    promptVersion: varchar("prompt_version", { length: 16 }).notNull(),
    /** The playbook the prompt carried; null when the platform had none. */
    playbookId: uuid("playbook_id").references(() => contentPlaybooks.id, { onDelete: "set null" }),
    /** The LLM stage's audit envelope (raw text, usage, model), or null for a hand-written draft. */
    llm: jsonb("llm").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("ix_content_drafts_idea_id").on(t.ideaId),
    index("ix_content_drafts_status_scheduled_for").on(t.status, t.scheduledFor),
    index("ix_content_drafts_platform_created_at").on(t.platform, t.createdAt),
    index("ix_content_drafts_redraft_of").on(t.redraftOf),
    index("ix_content_drafts_playbook_id").on(t.playbookId),
    oneOf("ck_content_drafts_platform", t.platform, PLATFORMS),
    oneOf("ck_content_drafts_status", t.status, DRAFT_STATUSES),
  ],
);

/**
 * A metrics snapshot of a published draft: one row per look, so a post's
 * curve is readable and a week's "what worked" is a query, not a guess.
 */
export const contentMetrics = pgTable(
  "content_metrics",
  {
    ...baseColumns,
    draftId: uuid("draft_id")
      .notNull()
      .references(() => contentDrafts.id, { onDelete: "cascade" }),
    /** The platform's own clock for the numbers. */
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    views: integer("views").notNull(),
    reactions: integer("reactions").notNull(),
    comments: integer("comments").notNull(),
    shares: integer("shares").notNull(),
    fetchedWith: varchar("fetched_with", { length: 16 }).notNull(),
  },
  (t) => [
    index("ix_content_metrics_draft_id_created_at").on(t.draftId, t.createdAt),
    ...nonNegative("content_metrics", {
      views: t.views,
      reactions: t.reactions,
      comments: t.comments,
      shares: t.shares,
    }),
  ],
);

export type ContentIdea = typeof contentIdeas.$inferSelect;
export type NewContentIdea = typeof contentIdeas.$inferInsert;
export type ContentDraft = typeof contentDrafts.$inferSelect;
export type NewContentDraft = typeof contentDrafts.$inferInsert;
export type ContentMetric = typeof contentMetrics.$inferSelect;
export type ContentPlaybook = typeof contentPlaybooks.$inferSelect;

/**
 * Each published post with its newest numbers (`marketing.post`), keyed `<idea>/<platform>/<draft>`
 * so drafting again knows the idea. `engaged` is reactions, comments
 * and shares; `recent` is the last 7 days, as `wren content results` reads them.
 */
export const marketingPostRecords = pgView("marketing_post_records", {
  id: text("id"),
  platform: text("platform"),
  title: text("title"),
  published: timestamp("published", { withTimezone: true }),
  views: integer("views"),
  reactions: integer("reactions"),
  comments: integer("comments"),
  shares: integer("shares"),
  engaged: integer("engaged"),
  measured: timestamp("measured", { withTimezone: true }),
  url: text("url"),
  recent: text("recent"),
}).as(sql`
  select concat_ws('/', d.idea_id, d.platform, d.id) id, d.platform::text platform,
    coalesce(d.title, left(split_part(d.text, chr(10), 1), 120))::text title,
    d.published_at published, m.views, m.reactions, m.comments, m.shares,
    m.reactions + m.comments + m.shares engaged, m.as_of measured, d.url::text url,
    case when d.published_at >= now() - interval '7 days' then 'recent' else 'earlier' end recent
  from content_drafts d
  left join lateral (
    select c.views, c.reactions, c.comments, c.shares, c.as_of from content_metrics c
    where c.draft_id = d.id order by c.created_at desc limit 1) m on true
  where d.status = 'published'`);

/**
 * Every draft not yet out (`marketing.draft`): waiting on a person, scheduled, failed or turned
 * down. `title` reads as a post's does; `written` says whether a person changed the model's words.
 */
export const marketingDraftRecords = pgView("marketing_draft_records", {
  id: text("id"),
  platform: text("platform"),
  title: text("title"),
  text: text("text"),
  state: text("state"),
  chars: integer("chars"),
  written: text("written"),
  note: text("note"),
  error: text("error"),
  scheduled: timestamp("scheduled", { withTimezone: true }),
  created: timestamp("created", { withTimezone: true }),
}).as(sql`
  select d.id::text id, d.platform::text platform,
    coalesce(d.title, left(split_part(d.text, chr(10), 1), 120))::text title, d.text,
    d.status::text state, length(d.text) chars,
    case when d.edited then 'edited' else 'model' end written, d.note, d.error,
    d.scheduled_for scheduled, d.created_at created
  from content_drafts d
  where d.status <> 'published'`);
