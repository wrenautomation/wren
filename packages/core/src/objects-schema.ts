/**
 * Platform objects (designs/2026-10-20-platform-objects.md): one row per post, comment or group on
 * a platform, under one canonical spelling (`objects/canon.ts`). `platform_object_refs` keeps every
 * other spelling seen (a bare id, a URL, a LinkedIn activity URN) and points it at the row. Every
 * role table (`objects/roles.ts`) points at the row with a composite key (platform, ref).
 * Writers go through `resolveObject` (`./objects/index.ts`), never insert here by hand.
 */
import { oneOf } from "@wren/db/columns";
import {
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/** What a row is. Information only: the key is (platform, ref). */
export const OBJECT_KINDS = ["post", "comment", "group"] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

export const platformObjects = pgTable(
  "platform_objects",
  {
    platform: varchar("platform", { length: 16 }).notNull(),
    /** The canonical spelling (`canonRef`). */
    ref: varchar("ref", { length: 255 }).notNull(),
    kind: varchar("kind", { length: 16, enum: OBJECT_KINDS }).notNull(),
    url: text("url"),
    /** The root post's ref, on a comment. */
    post: varchar("post", { length: 255 }),
    /** The ref of what a comment answers: its post, or another comment. */
    parent: varchar("parent", { length: 255 }),
    /** The platform handle or id, as the platform gives it. */
    author: varchar("author", { length: 200 }),
    /** When the platform says it was made. */
    at: timestamp("at", { withTimezone: true }),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.ref], name: "pk_platform_objects" }),
    index("ix_platform_objects_platform_post").on(t.platform, t.post),
    oneOf("ck_platform_objects_kind", t.kind, OBJECT_KINDS),
  ],
);
export type PlatformObject = typeof platformObjects.$inferSelect;

export const platformObjectRefs = pgTable(
  "platform_object_refs",
  {
    platform: varchar("platform", { length: 16 }).notNull(),
    /** Another spelling of the object: a bare id, a normal URL, an activity URN. */
    alias: text("alias").notNull(),
    ref: varchar("ref", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.alias], name: "pk_platform_object_refs" }),
    index("ix_platform_object_refs_platform_ref").on(t.platform, t.ref),
    foreignKey({
      columns: [t.platform, t.ref],
      foreignColumns: [platformObjects.platform, platformObjects.ref],
      name: "fk_platform_object_refs_platform_ref_platform_objects",
    })
      .onUpdate("cascade")
      .onDelete("no action"),
  ],
);
export type PlatformObjectRef = typeof platformObjectRefs.$inferSelect;
