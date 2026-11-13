/**
 * The creator index (designs/2026-11-12-eden-method.md §3, option A): creators a person tracks per
 * niche, a stored copy of their posts, each post's counts per day and each creator's followers per
 * day. `wren creator refresh` reads on a schedule; `wren feed` and the portal read these rows.
 */
import { platformObjects } from "@wren/core/objects-schema";
import { socialHandles } from "@wren/core/touches-schema";
import { oneOf } from "@wren/db/columns";
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

/** What a post is, for its baseline: Eden scores reels and posts apart */
export const POST_KINDS = ["video", "short", "reel", "post"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const trackedCreators = pgTable(
  "tracked_creators",
  {
    id: serial("id").notNull(),
    /** one account on one platform */
    handleId: integer("handle_id").notNull(),
    /** niche tags (`ai-automation`): the feed filters on them */
    niches: text("niches").array().notNull().default([]),
    /** why it is tracked, in the adder's words */
    note: text("note"),
    /** a person as Canon names them (`william`), or an agent id */
    addedBy: text("added_by").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    /** off: no more reads; the rows stay */
    active: boolean("active").notNull().default(true),
    /** the platform's own user id, from a read */
    platformId: varchar("platform_id", { length: 64 }),
    /** the profile as the last read gave it */
    raw: jsonb("raw"),
    readAt: timestamp("read_at", { withTimezone: true }),
    /** failed reads in a row; at 3 the creator waits for a person */
    readFails: integer("read_fails").notNull().default(0),
    readError: text("read_error"),
    /** promoted into Canon: the `creator-…` person record */
    record: text("record"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_tracked_creators" }),
    unique("uq_tracked_creators_handle_id").on(t.handleId),
    foreignKey({
      columns: [t.handleId],
      foreignColumns: [socialHandles.id],
      name: "fk_tracked_creators_handle_id_social_handles",
    }),
  ],
);
export type TrackedCreator = typeof trackedCreators.$inferSelect;

export const creatorPosts = pgTable(
  "creator_posts",
  {
    platform: varchar("platform", { length: 16 }).notNull(),
    ref: varchar("ref", { length: 255 }).notNull(),
    creatorId: integer("creator_id").notNull(),
    url: text("url").notNull(),
    kind: varchar("kind", { length: 8 }).notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    title: text("title"),
    text: text("text"),
    /** the item whole, as the last read gave it */
    raw: jsonb("raw").notNull(),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    /** `scoreOf` at the last refresh: the count it is on, its multiple, its top-N% rank, the baseline size */
    scoreCount: varchar("score_count", { length: 16 }),
    multiple: real("multiple"),
    rank: real("rank"),
    baselineN: integer("baseline_n"),
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    /** promoted into Canon: the record id */
    record: text("record"),
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.ref], name: "pk_creator_posts" }),
    index("ix_creator_posts_creator_id_posted_at").on(t.creatorId, t.postedAt),
    index("ix_creator_posts_multiple").on(t.multiple),
    oneOf("ck_creator_posts_kind", t.kind, POST_KINDS),
    foreignKey({
      columns: [t.creatorId],
      foreignColumns: [trackedCreators.id],
      name: "fk_creator_posts_creator_id_tracked_creators",
    }),
    foreignKey({
      columns: [t.platform, t.ref],
      foreignColumns: [platformObjects.platform, platformObjects.ref],
      name: "fk_creator_posts_platform_ref_platform_objects",
    }).onUpdate("cascade"),
  ],
);
export type CreatorPost = typeof creatorPosts.$inferSelect;

/** A post's counts as one day's read gave them: every count kept */
export const postCountDays = pgTable(
  "post_count_days",
  {
    platform: varchar("platform", { length: 16 }).notNull(),
    ref: varchar("ref", { length: 255 }).notNull(),
    day: date("day").notNull(),
    /** `{views, likes, comments, shares, saves}`, as read */
    counts: jsonb("counts").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.ref, t.day], name: "pk_post_count_days" }),
    foreignKey({
      columns: [t.platform, t.ref],
      foreignColumns: [platformObjects.platform, platformObjects.ref],
      name: "fk_post_count_days_platform_ref_platform_objects",
    }).onUpdate("cascade"),
  ],
);

export const followerCountDays = pgTable(
  "follower_count_days",
  {
    creatorId: integer("creator_id").notNull(),
    day: date("day").notNull(),
    followers: integer("followers").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.creatorId, t.day], name: "pk_follower_count_days" }),
    foreignKey({
      columns: [t.creatorId],
      foreignColumns: [trackedCreators.id],
      name: "fk_follower_count_days_creator_id_tracked_creators",
    }),
  ],
);
