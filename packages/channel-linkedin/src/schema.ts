import { llmCalls } from "@wren/core/schema";
import { baseColumns, nonNegative } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const setNull = { onDelete: "set null" } as const;

/** Raw material: a markdown note plus images dropped in the inbox or added via CLI. */
export const notes = pgTable(
  "notes",
  {
    ...baseColumns,
    body: text("body").notNull(),
    imagePaths: text("image_paths").array().notNull().default([]),
    source: varchar("source", { length: 16 }).notNull(), // inbox | cli
    status: varchar("status", { length: 16 }).notNull().default("new"), // new | used | archived
    usedByPostId: uuid("used_by_post_id").references((): AnyPgColumn => posts.id, setNull),
  },
  (t) => [
    index("ix_notes_status_created_at").on(t.status, t.createdAt),
    index("ix_notes_used_by_post_id").on(t.usedByPostId),
  ],
);

export const competitors = pgTable(
  "competitors",
  {
    ...baseColumns,
    name: varchar("name", { length: 200 }).notNull(),
    domain: varchar("domain", { length: 255 }).notNull().unique("uq_competitors_domain"),
    discoveredBy: varchar("discovered_by", { length: 32 }).notNull(), // search provider | manual
    researchRunId: uuid("research_run_id").references((): AnyPgColumn => researchRuns.id, setNull),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
  },
  (t) => [index("ix_competitors_research_run_id").on(t.researchRunId)],
);

export const competitorPosts = pgTable(
  "competitor_posts",
  {
    ...baseColumns,
    url: varchar("url", { length: 2048 }).notNull().unique("uq_competitor_posts_url"),
    competitorId: uuid("competitor_id").references(() => competitors.id, setNull),
    title: varchar("title", { length: 500 }),
    fetchedWith: varchar("fetched_with", { length: 16 }).notNull(), // http | browser | claude
    postType: varchar("post_type", { length: 32 }).notNull(),
    hookType: varchar("hook_type", { length: 64 }).notNull(),
    structure: text("structure").notNull(),
    wordCount: integer("word_count").notNull(),
    ctaType: varchar("cta_type", { length: 64 }).notNull(),
    summary: text("summary").notNull(),
    researchRunId: uuid("research_run_id").references((): AnyPgColumn => researchRuns.id, setNull),
  },
  (t) => [
    index("ix_competitor_posts_competitor_id").on(t.competitorId),
    index("ix_competitor_posts_research_run_id").on(t.researchRunId),
    index("ix_competitor_posts_post_type").on(t.postType),
    ...nonNegative("competitor_posts", { wordCount: t.wordCount }),
  ],
);

export const postIdeas = pgTable(
  "post_ideas",
  {
    ...baseColumns,
    text: text("text").notNull(),
    source: varchar("source", { length: 16 }).notNull(), // research | note
    competitorPostId: uuid("competitor_post_id").references(() => competitorPosts.id, setNull),
    noteId: uuid("note_id").references(() => notes.id, setNull),
    status: varchar("status", { length: 16 }).notNull().default("open"), // open | used | rejected
    usedByPostId: uuid("used_by_post_id").references((): AnyPgColumn => posts.id, setNull),
  },
  (t) => [
    index("ix_post_ideas_status_created_at").on(t.status, t.createdAt),
    index("ix_post_ideas_competitor_post_id").on(t.competitorPostId),
    index("ix_post_ideas_note_id").on(t.noteId),
    index("ix_post_ideas_used_by_post_id").on(t.usedByPostId),
  ],
);

export const researchRuns = pgTable(
  "research_runs",
  {
    ...baseColumns,
    searchProvider: varchar("search_provider", { length: 32 }).notNull(),
    mode: varchar("mode", { length: 16 }).notNull(), // competitors | ideas | ablate
    queries: jsonb("queries").$type<string[]>().notNull().default([]),
    fetchCount: integer("fetch_count").notNull().default(0),
    postsKept: integer("posts_kept").notNull().default(0),
    newDomains: integer("new_domains").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    seconds: real("seconds").notNull().default(0),
    manualRating: integer("manual_rating"),
    error: text("error"),
  },
  (t) => [
    index("ix_research_runs_created_at").on(t.createdAt),
    check("ck_research_runs_manual_rating_range", sql`manual_rating BETWEEN 1 AND 5`),
    ...nonNegative("research_runs", {
      fetchCount: t.fetchCount,
      postsKept: t.postsKept,
      newDomains: t.newDomains,
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      costUsd: t.costUsd,
      seconds: t.seconds,
    }),
  ],
);

export const posts = pgTable(
  "posts",
  {
    ...baseColumns,
    postType: varchar("post_type", { length: 32 }).notNull(), // build_log | teardown | numbers | insight
    // draft | approved | publishing | published | rejected
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    draftPath: varchar("draft_path", { length: 1024 }).notNull(),
    body: text("body"), // snapshot at approve
    imagePath: varchar("image_path", { length: 1024 }),
    noteIds: uuid("note_ids").array().notNull().default([]),
    postIdeaId: uuid("post_idea_id").references((): AnyPgColumn => postIdeas.id, setNull),
    competitorPostIds: uuid("competitor_post_ids").array().notNull().default([]),
    llmCallId: uuid("llm_call_id").references(() => llmCalls.id, setNull),
    rejectReason: varchar("reject_reason", { length: 32 }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    externalId: varchar("external_id", { length: 255 }),
  },
  (t) => [
    index("ix_posts_status_created_at").on(t.status, t.createdAt),
    index("ix_posts_post_type").on(t.postType),
    index("ix_posts_post_idea_id").on(t.postIdeaId),
    index("ix_posts_llm_call_id").on(t.llmCallId),
  ],
);

/** One engagement snapshot per (post, time, source). Re-imports are no-ops. */
export const postMetrics = pgTable(
  "post_metrics",
  {
    ...baseColumns,
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    impressions: integer("impressions").notNull().default(0),
    reactions: integer("reactions").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    source: varchar("source", { length: 16 }).notNull(), // manual | xlsx | api
  },
  (t) => [
    uniqueIndex("uq_post_metrics_post_id_captured_at_source").on(t.postId, t.capturedAt, t.source),
    index("ix_post_metrics_post_id_captured_at").on(t.postId, t.capturedAt),
    ...nonNegative("post_metrics", {
      impressions: t.impressions,
      reactions: t.reactions,
      comments: t.comments,
    }),
  ],
);

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type Post = typeof posts.$inferSelect;
