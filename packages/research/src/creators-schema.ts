/**
 * The creator index (designs/2026-11-12-eden-method.md §3, option A): creators a person tracks per
 * niche, a stored copy of their posts, each post's counts per day and each creator's followers per
 * day. `wren creator refresh` reads on a schedule; `wren feed` and the portal read these rows.
 */
import { platformObjects } from "@wren/core/objects-schema";
import { socialHandles } from "@wren/core/touches-schema";
import { sql } from "drizzle-orm";
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
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/** the kinds `weaver posts` gives today; the column takes any (a new kind is stored, never dropped) */
export const POST_KINDS = [
  "video",
  "short",
  "live",
  "reel",
  "post",
  "photo",
  "carousel",
  "quote",
  "reply",
  "retweet",
] as const;

/**
 * One creator, as a person, over their accounts on each platform (studio-suite D10 A). Scores stay
 * per account: a usual on X says nothing about Instagram.
 */
export const creatorPeople = pgTable(
  "creator_people",
  {
    id: serial("id").notNull(),
    /** as he names them; null: their first account's name or handle */
    name: text("name"),
    addedBy: text("added_by").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.id], name: "pk_creator_people" })],
);
export type CreatorPerson = typeof creatorPeople.$inferSelect;

export const trackedCreators = pgTable(
  "tracked_creators",
  {
    id: serial("id").notNull(),
    /** one account on one platform */
    handleId: integer("handle_id").notNull(),
    /** the person this account is one of */
    personId: integer("person_id").notNull(),
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
    /** the profile picture, copied into the media bucket: the key (`cache/creators/<platform>/<handle>.jpg`) */
    picture: text("picture"),
    /** the face the page shows: `picture` made small (`….small.webp`); null until made */
    pictureSmall: text("picture_small"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_tracked_creators" }),
    unique("uq_tracked_creators_handle_id").on(t.handleId),
    index("ix_tracked_creators_person_id").on(t.personId),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [creatorPeople.id],
      name: "fk_tracked_creators_person_id_creator_people",
    }),
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
    kind: varchar("kind", { length: 16 }).notNull(),
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
    /** the same score on likes, when the count is views (weaver 0.77.1: X scores on views) */
    likesMultiple: real("likes_multiple"),
    likesRank: real("likes_rank"),
    baselineN: integer("baseline_n"),
    /** the creator's usual draw: the median count behind `multiple`, and behind `likes_multiple` */
    baseline: real("baseline"),
    likesBaseline: real("likes_baseline"),
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    /** promoted into Canon: the record id */
    record: text("record"),
    /** its picture, copied into the media bucket: the key (`cache/posts/<platform>/<ref>.jpg`) */
    picture: text("picture"),
    /** the tile's picture: `picture` made small (`….small.webp`); null until made */
    pictureSmall: text("picture_small"),
    /** its video, copied into the media bucket (`cache/posts/<platform>/<ref>.mp4`, WA-1391); `''` refused */
    video: text("video"),
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.ref], name: "pk_creator_posts" }),
    index("ix_creator_posts_creator_id_posted_at").on(t.creatorId, t.postedAt),
    index("ix_creator_posts_multiple").on(t.multiple),
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

/** a find's state (WA-1416 D6): waits for the desk, searches, done, or failed with its reason */
export const FIND_STATES = ["waiting", "finding", "found", "failed"] as const;
export type FindState = (typeof FIND_STATES)[number];

/** one candidate account a find saw; `creatorId` once tracked */
export interface FindCandidate {
  platform: string;
  handle: string;
  url: string;
  /** the display name, from the hit title or the API */
  name: string | null;
  followers: number | null;
  label: "main" | "alternate" | "fan" | "other person" | "not a profile";
  why: string;
  /** where it came from: searxng, perplexity, youtube-api, bio, link */
  sources: string[];
  /** tracked by this find, or already before it */
  creatorId: number | null;
  tracked: "auto" | "tick" | "before" | null;
  readError: string | null;
  /** every field the search and the pick gave (keep data) */
  raw?: unknown;
}

/**
 * One "Add creator" from Studio (WA-1416): the input, the desk's steps, every candidate it saw.
 * One open find per normalized input.
 */
export const creatorFinds = pgTable(
  "creator_finds",
  {
    id: serial("id").notNull(),
    /** as typed: a name or a profile link */
    input: text("input").notNull(),
    /** lowercased, trimmed: the dedupe key */
    inputKey: text("input_key").notNull(),
    /** the person's name, once known (a link input: from its first read) */
    name: text("name"),
    niche: text("niche").notNull(),
    personId: integer("person_id"),
    state: varchar("state", { length: 16 }).$type<FindState>().notNull().default("waiting"),
    /** `searching`, `picking`, `reading 2 of 4` */
    step: text("step"),
    candidates: jsonb("candidates").$type<FindCandidate[]>().notNull().default([]),
    /** the weaver ledger run */
    runId: text("run_id"),
    /** the search's spend in dollars, from the ledger */
    usd: real("usd"),
    error: text("error"),
    requestedBy: text("requested_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_creator_finds" }),
    uniqueIndex("ux_creator_finds_open_input_key")
      .on(t.inputKey)
      .where(sql`${t.state} in ('waiting', 'finding')`),
    index("ix_creator_finds_person_id").on(t.personId),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [creatorPeople.id],
      name: "fk_creator_finds_person_id_creator_people",
    }),
  ],
);
export type CreatorFind = typeof creatorFinds.$inferSelect;
