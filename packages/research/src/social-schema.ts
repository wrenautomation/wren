/**
 * Social groups as a lead source (designs/2026-10-05-social-reads.md): what a search found, the
 * groups it found, and the public posts in them. Every read is kept whole in a `jsonb` column
 * and filtered when it is used; a post that never maps to a firm stays with its group.
 */
import { companies, people } from "@wren/core/schema";
import { oneOf } from "@wren/db/columns";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

export const SOCIAL_NETWORKS = ["facebook"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

/**
 * How a post reached a firm. `link`: a link in the post is the firm's domain. `author`: the
 * author's full name is exactly one person we hold. `name`: the firm's name is in the text.
 */
export const POST_MAPPINGS = ["link", "author", "name"] as const;
export type PostMapping = (typeof POST_MAPPINGS)[number];

/** One group search: its keyword, and the search engine's whole page. It meters and dates the keyword. */
export const socialSearches = pgTable(
  "social_searches",
  {
    id: serial("id").notNull(),
    network: varchar("network", { length: 16, enum: SOCIAL_NETWORKS }).notNull(),
    niche: varchar("niche", { length: 32 }).notNull(),
    keyword: text("keyword").notNull(),
    /** Results asked for. */
    n: integer("n").notNull(),
    /** Groups the answer named. */
    groups: integer("groups").notNull(),
    /** The route's whole answer: groups with their posts, and the results page. */
    answer: jsonb("answer").notNull(),
    searchedAt: timestamp("searched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_social_searches" }),
    index("ix_social_searches_keyword").on(t.network, t.niche, t.keyword, t.searchedAt),
    oneOf("ck_social_searches_socialnetwork", t.network, SOCIAL_NETWORKS),
  ],
);

/**
 * A group a search showed. `about` is the About panel read whole (null until read, or when the
 * page gave nothing); `read_at` is when the About was last read, null = not yet. A 4xx is kept in
 * `error` with `read_at` set, so the read is not repeated before it is due again.
 */
export const socialGroups = pgTable(
  "social_groups",
  {
    id: serial("id").notNull(),
    network: varchar("network", { length: 16, enum: SOCIAL_NETWORKS }).notNull(),
    /** The id in the group's URL: a name or a number. */
    ref: varchar("ref", { length: 100 }).notNull(),
    /** The niche and keyword of the search that first found it. */
    niche: varchar("niche", { length: 32 }).notNull(),
    keyword: text("keyword").notNull(),
    name: text("name"),
    url: text("url").notNull(),
    about: jsonb("about"),
    /** The search's result for this group the last time one showed it. */
    hit: jsonb("hit").notNull(),
    error: text("error"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_social_groups" }),
    unique("uq_social_groups_ref").on(t.network, t.ref),
    index("ix_social_groups_niche_read").on(t.niche, t.readAt),
    oneOf("ck_social_groups_socialnetwork", t.network, SOCIAL_NETWORKS),
  ],
);
export type SocialGroup = typeof socialGroups.$inferSelect;

/**
 * A public post a search showed. A row starts as a stub (`raw.hit`, the search's lines about it)
 * and `read_at` is set when its page is read: `raw` then also holds the post row and its comments,
 * as read. `company_id` and `person_id` are set when the post maps to a firm (`mapped_by`).
 */
export const socialPosts = pgTable(
  "social_posts",
  {
    id: serial("id").notNull(),
    network: varchar("network", { length: 16, enum: SOCIAL_NETWORKS }).notNull(),
    groupId: integer("group_id").notNull(),
    ref: varchar("ref", { length: 32 }).notNull(),
    url: text("url").notNull(),
    author: text("author"),
    /** The time as the page shows it ("3 days ago"), never parsed. */
    posted: text("posted"),
    text: text("text"),
    raw: jsonb("raw").notNull(),
    companyId: integer("company_id"),
    personId: integer("person_id"),
    mappedBy: varchar("mapped_by", { length: 16, enum: POST_MAPPINGS }),
    error: text("error"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_social_posts" }),
    unique("uq_social_posts_ref").on(t.network, t.ref),
    index("ix_social_posts_group_id").on(t.groupId),
    index("ix_social_posts_company_id").on(t.companyId),
    index("ix_social_posts_person_id").on(t.personId),
    index("ix_social_posts_read_at").on(t.readAt),
    foreignKey({
      columns: [t.groupId],
      foreignColumns: [socialGroups.id],
      name: "fk_social_posts_group_id_social_groups",
    }),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_social_posts_company_id_companies",
    }),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_social_posts_person_id_people",
    }),
    oneOf("ck_social_posts_socialnetwork", t.network, SOCIAL_NETWORKS),
    oneOf("ck_social_posts_postmapping", t.mappedBy, POST_MAPPINGS),
  ],
);
export type SocialPost = typeof socialPosts.$inferSelect;
