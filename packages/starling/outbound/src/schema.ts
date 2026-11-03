/**
 * Outbound's own tables: where we look and what we did there. Reddit discovery (`reddit_people`,
 * `reddit_threads`), others' posts we act on (`reach_posts`), the passes a reader made
 * (`reach_passes`) and Reddit claim checks (`comment_proofs`). The accounts, the places and their
 * floors are acts' (`reach_accounts`, `reddit_places`, `reddit_requirements`); the turn stores
 * (contacts, messages, comments) are conversations'.
 */
import { platformObjects } from "@wren/core/objects-schema";
import { PASS_REASONS } from "@wren/core/pass-reasons";
import { oneOf } from "@wren/db/columns";
import { reachAccounts, redditPlaces } from "@wren/starling-acts/schema";
import { PROOF_STATES } from "@wren/starling-core";
import { sql } from "drizzle-orm";
import {
  check,
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
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

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

export const redditThreads = pgTable(
  "reddit_threads",
  {
    /**
     * Always `reddit`. A plain column, not a generated one, so the keys below can cascade
     * (designs/2026-10-20-platform-objects.md).
     */
    platform: varchar("platform", { length: 16 }).notNull().default("reddit"),
    /** The post's fullname, t3_…. A platform object. */
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
    /** When the scheduler sends the draft (`pacing.ts`); null: it waits for his click. */
    sendAt: timestamp("send_at", { withTimezone: true }),
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
    index("ix_reddit_threads_platform_target").on(t.platform, t.target),
    index("ix_reddit_threads_platform_answer_ref").on(t.platform, t.answerRef),
    check("ck_reddit_threads_platform", sql`${t.platform} = 'reddit'`),
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
    // The post, the comment we answer and our reply are platform objects, under one spelling.
    foreignKey({
      columns: [t.platform, t.id],
      foreignColumns: [platformObjects.platform, platformObjects.ref],
      name: "fk_reddit_threads_platform_id_platform_objects",
    }).onUpdate("cascade"),
    foreignKey({
      columns: [t.platform, t.target],
      foreignColumns: [platformObjects.platform, platformObjects.ref],
      name: "fk_reddit_threads_platform_target_platform_objects",
    }).onUpdate("cascade"),
    foreignKey({
      columns: [t.platform, t.answerRef],
      foreignColumns: [platformObjects.platform, platformObjects.ref],
      name: "fk_reddit_threads_platform_answer_ref_platform_objects",
    }).onUpdate("cascade"),
  ],
);

export type RedditPerson = typeof redditPeople.$inferSelect;
export type RedditThread = typeof redditThreads.$inferSelect;

/**
 * Others' posts to comment on, like, and follow the author of (designs/2026-10-07-posting-flow.md,
 * item 4; designs/2026-10-07-touches.md): on LinkedIn, X or Instagram, found by a topic search, a
 * company's or account's posts or a key person's, ranked by code, drafted by the model, then
 * `queued` in To approve. Only his Comment posts it, with a like and a follow under the caps.
 * Dropped: too old, ours, or no words.
 */
export const REACH_POST_STATES = ["found", "queued", "commented", "skipped", "dropped"] as const;
export type ReachPostState = (typeof REACH_POST_STATES)[number];
export const REACH_POST_PLATFORMS = [
  "linkedin",
  "x",
  "instagram",
  "youtube",
  "tiktok",
  "threads",
] as const;
export type ReachPostPlatform = (typeof REACH_POST_PLATFORMS)[number];

export const reachPosts = pgTable(
  "reach_posts",
  {
    id: serial("id"),
    platform: varchar("platform", { length: 12, enum: REACH_POST_PLATFORMS })
      .notNull()
      .default("linkedin"),
    /**
     * What the platform's routes take: LinkedIn's `urn:li:activity:N` (or `ugcPost`, `share`), X's
     * post id, Instagram's shortcode. A platform object; the key may rewrite it when a learned
     * link gives a LinkedIn post its API URN.
     */
    ref: varchar("ref", { length: 255 }).notNull(),
    author: text("author").notNull(),
    authorUrl: text("author_url"),
    /** The author's handle as `normalizeHandle` keeps it: X and Instagram usernames, LinkedIn vanity. */
    handle: varchar("handle", { length: 120 }),
    headline: text("headline"),
    text: text("text").notNull(),
    url: text("url").notNull(),
    /** When it was posted, as the page's age label read at `created_at`; null = unknown. */
    postedAt: timestamp("posted_at", { withTimezone: true }),
    reactions: integer("reactions").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    /** `topic: <words>`, `company: <handle>`, `account: <handle>` or `person: <handle>`. */
    foundBy: varchar("found_by", { length: 200 }).notNull(),
    /** The read's account (`linkedin@wren`, `x@wren`). */
    account: varchar("account", { length: 80 }).notNull(),
    /** Code's rank, higher first, and one line on why. */
    fit: smallint("fit"),
    why: text("why"),
    state: varchar("state", { length: 12, enum: REACH_POST_STATES }).notNull().default("found"),
    stateReason: text("state_reason"),
    draft: text("draft"),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    /** The metro campaign it was queued for; its like and follow inherit it. Null = the default. */
    campaign: text("campaign"),
    /** When the scheduler sends the draft (`pacing.ts`); null: it waits for his click. */
    sendAt: timestamp("send_at", { withTimezone: true }),
    /** What we posted, when, and who clicked. */
    comment: text("comment"),
    commentedAt: timestamp("commented_at", { withTimezone: true }),
    commentedBy: varchar("commented_by", { length: 120 }),
    /** Our like on the post and our follow of its author, each sent with his Comment. */
    likedAt: timestamp("liked_at", { withTimezone: true }),
    followedAt: timestamp("followed_at", { withTimezone: true }),
    /** Auto like/follow tries that failed; at `ACT_TRIES` the act is parked (`reach-posts/acts.ts`). */
    likeFails: smallint("like_fails").notNull().default(0),
    followFails: smallint("follow_fails").notNull().default(0),
    /** The last failure's words, for a person who clears the park. */
    actError: text("act_error"),
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_reach_posts" }),
    unique("uq_reach_posts_platform_ref").on(t.platform, t.ref),
    index("ix_reach_posts_state").on(t.state),
    oneOf("ck_reach_posts_state", t.state, REACH_POST_STATES),
    oneOf("ck_reach_posts_platform", t.platform, REACH_POST_PLATFORMS),
    foreignKey({
      columns: [t.platform, t.ref],
      foreignColumns: [platformObjects.platform, platformObjects.ref],
      name: "fk_reach_posts_platform_ref_platform_objects",
    }).onUpdate("cascade"),
  ],
);

export type ReachPost = typeof reachPosts.$inferSelect;

/**
 * People he passed on (Engage's Pass): not a lead, not worth a reply, spam. Their open comments,
 * posts and threads close when he passes, and new ones land closed, so nothing of theirs is
 * drafted again. `handle` is `passKey`'s; `until` null is for good. Lifting keeps the row.
 */
export const reachPasses = pgTable(
  "reach_passes",
  {
    id: serial("id"),
    platform: varchar("platform", { length: 16 }).notNull(),
    handle: varchar("handle", { length: 200 }).notNull(),
    /** As the row showed them. */
    name: text("name").notNull(),
    reason: varchar("reason", { length: 16, enum: PASS_REASONS }).notNull(),
    note: text("note"),
    /** The typed id he passed from: `comment:4`, `onpost:9`, `thread:t3_x`, `dm:3`. */
    item: varchar("item", { length: 80 }),
    by: varchar("by", { length: 120 }),
    until: timestamp("until", { withTimezone: true }),
    liftedAt: timestamp("lifted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_reach_passes" }),
    unique("uq_reach_passes_platform_handle").on(t.platform, t.handle),
    oneOf("ck_reach_passes_reason", t.reason, PASS_REASONS),
  ],
);

export type ReachPass = typeof reachPasses.$inferSelect;

/**
 * Whether each comment we sent is there for a stranger (designs/2026-10-14-comment-proof.md):
 * one row per sent item (`thread:t3_x`, `onpost:9`, `comment:4`), the newest check's answer,
 * with every check before it in `checks`. The person's touch line shows the newest state.
 */
export const commentProofs = pgTable(
  "comment_proofs",
  {
    item: varchar("item", { length: 80 }).notNull(),
    platform: varchar("platform", { length: 16 }).notNull(),
    state: varchar("state", { length: 16, enum: PROOF_STATES }).notNull().default("pending"),
    /** The comment's permalink, else its post's page. */
    url: text("url"),
    /** The screenshot, `s3://` in the media bucket. */
    shot: text("shot"),
    note: text("note"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    /** Every check, oldest first: the item's proof history (`round` 1, 2, 3 = 2 min, 1 h, 24 h; 0 by hand). */
    checks: jsonb("checks")
      .$type<
        { at: string; state: string; note: string | null; shot: string | null; round: number }[]
      >()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.item], name: "pk_comment_proofs" }),
    index("ix_comment_proofs_checked_at").on(t.checkedAt),
    oneOf("ck_comment_proofs_state", t.state, PROOF_STATES),
  ],
);

export type CommentProofRow = typeof commentProofs.$inferSelect;
