/**
 * The content loop's two tables. An idea is William's raw input (a few lines,
 * maybe a file); a draft is one platform's version of it, written by the LLM,
 * reviewed by a person, published by the scheduler. Everything the model wrote
 * stays on the draft row beside the audit envelope.
 * Design: designs/2026-09-22-content-loop.md.
 */
import { type Media, PLATFORMS, type Platform } from "@wren/core/content";
import { baseColumns, oneOf } from "@wren/db/columns";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const IDEA_STATUSES = ["open", "drafted", "archived"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export const IDEA_SOURCES = ["cli", "api"] as const;
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
    promptVersion: varchar("prompt_version", { length: 16 }).notNull(),
    /** The LLM stage's audit envelope (raw text, usage, model), or null for a hand-written draft. */
    llm: jsonb("llm").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("ix_content_drafts_idea_id").on(t.ideaId),
    index("ix_content_drafts_status_scheduled_for").on(t.status, t.scheduledFor),
    index("ix_content_drafts_platform_created_at").on(t.platform, t.createdAt),
    oneOf("ck_content_drafts_platform", t.platform, PLATFORMS),
    oneOf("ck_content_drafts_status", t.status, DRAFT_STATUSES),
  ],
);

export type ContentIdea = typeof contentIdeas.$inferSelect;
export type NewContentIdea = typeof contentIdeas.$inferInsert;
export type ContentDraft = typeof contentDrafts.$inferSelect;
export type NewContentDraft = typeof contentDrafts.$inferInsert;
