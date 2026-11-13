/**
 * Posts a person saved on a platform (designs/2026-11-12-eden-method.md §2): IG saved, X bookmarks,
 * YouTube likes and playlists, LinkedIn saved. Each files into Canon as that person's own source.
 * `wren capture pull` writes rows; `wren capture file` files them, 50 a source a day.
 */
import { platformObjects } from "@wren/core/objects-schema";
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

/** Where a save was read; the CLI's `--source` names. */
export const CAPTURE_SOURCES = [
  "instagram-saved",
  "x-bookmarks",
  "youtube-liked",
  "youtube-playlists",
  "linkedin-saved",
] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

export const captures = pgTable(
  "captures",
  {
    id: serial("id").notNull(),
    platform: varchar("platform", { length: 16 }).notNull(),
    /** a platform object's canonical ref */
    ref: varchar("ref", { length: 255 }).notNull(),
    /** whose save, as Canon names them (`william`) */
    person: text("person").notNull(),
    /** every source that read it (a liked video in a playlist: both) */
    sources: text("sources").array().notNull(),
    url: text("url").notNull(),
    author: varchar("author", { length: 200 }),
    /** collection, folder or playlist names it sits in; Canon tags `saved-<list>` */
    lists: text("lists").array().notNull().default([]),
    /** the item whole, as the last read gave it */
    raw: jsonb("raw").notNull(),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    /** filed into Canon: the record ids */
    filedAt: timestamp("filed_at", { withTimezone: true }),
    records: text("records").array(),
    /** failed files; at 3 the row waits for a person */
    attempts: integer("attempts").default(0).notNull(),
    error: text("error"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_captures" }),
    unique("uq_captures_platform_ref_person").on(t.platform, t.ref, t.person),
    index("ix_captures_filed_at").on(t.filedAt, t.firstSeen),
    oneOf("ck_captures_platform", t.platform, ["instagram", "x", "youtube", "linkedin"]),
    foreignKey({
      columns: [t.platform, t.ref],
      foreignColumns: [platformObjects.platform, platformObjects.ref],
      name: "fk_captures_platform_ref_platform_objects",
    }).onUpdate("cascade"),
  ],
);
export type Capture = typeof captures.$inferSelect;
