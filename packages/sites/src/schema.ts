/**
 * Sites (designs/2026-10-07-sites.md). Main database only, like `hooks`: `client` null is Wren's.
 *
 * - `site_pages`: one row per page we run, a data page (rendered from its versions) or a code
 *   page (registered by its URL).
 * - `site_page_versions`: a data page's copy, one row per save, never overwritten.
 * - `site_events`: what the tracker saw, one row per event. Not audited: high volume.
 * - `site_forms`: every form sent, kept whole, and whether it entered the door.
 */
import { clients } from "@wren/core/clients";
import { hooks } from "@wren/core/schema";
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  CHANNELS,
  EVENT_NAMES,
  PAGE_KINDS,
  PAGE_SOURCES,
  PAGE_STAGES,
  PAGE_STATUSES,
  VERSION_ORIGINS,
} from "./model.js";
import type { Content } from "./templates/types.js";

export const sitePages = pgTable(
  "site_pages",
  {
    id: uuid("id").defaultRandom().notNull(),
    /** Whose page; null is Wren's. */
    client: varchar("client", { length: 40 }),
    slug: varchar("slug", { length: 80 }).notNull(),
    /** Its name in the list: "Audit, cost angle". */
    title: varchar("title", { length: 200 }).notNull(),
    kind: varchar("kind", { length: 12 }).notNull(),
    source: varchar("source", { length: 8 }).notNull(),
    /** A code page's address. A data page's comes from its owner's host and slug. */
    url: text("url"),
    /** Where a code page's source is: a lander repo path or a standalone dir. */
    repoPath: text("repo_path"),
    /** A data page's template. */
    template: varchar("template", { length: 16 }),
    offer: varchar("offer", { length: 64 }),
    angle: varchar("angle", { length: 120 }),
    audience: varchar("audience", { length: 120 }),
    /** The page it was copied from, as a variant. */
    variantOf: uuid("variant_of"),
    stage: varchar("stage", { length: 8 }).notNull().default("convert"),
    status: varchar("status", { length: 8 }).notNull().default("draft"),
    liveVersion: integer("live_version"),
    draftVersion: integer("draft_version"),
    /** The version asked to go live, waiting in To approve. */
    waitingVersion: integer("waiting_version"),
    waitingBy: text("waiting_by"),
    waitingAt: timestamp("waiting_at", { withTimezone: true }),
    /** Opens the newest draft at `/o/__preview/<id>?t=<it>`; new on every save. */
    previewToken: varchar("preview_token", { length: 43 }).notNull(),
    /** The door its forms enter; null takes the owner's site door. */
    hook: uuid("hook"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_site_pages" }),
    uniqueIndex("uq_site_pages_slug").on(sql`coalesce(${t.client}, '')`, t.slug),
    uniqueIndex("uq_site_pages_url").on(t.url).where(sql`${t.url} is not null`),
    index("ix_site_pages_client").on(t.client),
    index("ix_site_pages_offer").on(t.offer),
    index("ix_site_pages_variant_of").on(t.variantOf),
    index("ix_site_pages_hook").on(t.hook),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_site_pages_client",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.variantOf],
      foreignColumns: [t.id],
      name: "fk_site_pages_variant_of",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.hook],
      foreignColumns: [hooks.id],
      name: "fk_site_pages_hook",
    }).onDelete("set null"),
    oneOf("ck_site_pages_kind", t.kind, PAGE_KINDS),
    oneOf("ck_site_pages_source", t.source, PAGE_SOURCES),
    oneOf("ck_site_pages_stage", t.stage, PAGE_STAGES),
    oneOf("ck_site_pages_status", t.status, PAGE_STATUSES),
  ],
);
export type SitePage = typeof sitePages.$inferSelect;

export const sitePageVersions = pgTable(
  "site_page_versions",
  {
    page: uuid("page").notNull(),
    number: integer("number").notNull(),
    content: jsonb("content").$type<Content>().notNull(),
    origin: varchar("origin", { length: 8 }).notNull(),
    why: text("why"),
    by: text("by").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.page, t.number], name: "pk_site_page_versions" }),
    foreignKey({
      columns: [t.page],
      foreignColumns: [sitePages.id],
      name: "fk_site_page_versions_page",
    }).onDelete("cascade"),
    oneOf("ck_site_page_versions_origin", t.origin, VERSION_ORIGINS),
  ],
);
export type SitePageVersion = typeof sitePageVersions.$inferSelect;

export const siteEvents = pgTable(
  "site_events",
  {
    id: bigserial("id", { mode: "number" }).notNull(),
    page: uuid("page").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** Random per page load: events of one view share it. */
    view: varchar("view", { length: 36 }).notNull(),
    name: varchar("name", { length: 8 }).notNull(),
    channel: varchar("channel", { length: 10 }).notNull(),
    source: varchar("source", { length: 120 }),
    medium: varchar("medium", { length: 120 }),
    campaign: varchar("campaign", { length: 120 }),
    content: varchar("content", { length: 120 }),
    ref: varchar("ref", { length: 200 }),
    width: integer("width"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_site_events" }),
    index("ix_site_events_page_at").on(t.page, t.at),
    foreignKey({
      columns: [t.page],
      foreignColumns: [sitePages.id],
      name: "fk_site_events_page",
    }).onDelete("cascade"),
    oneOf("ck_site_events_name", t.name, EVENT_NAMES),
    oneOf("ck_site_events_channel", t.channel, CHANNELS),
  ],
);
export type SiteEvent = typeof siteEvents.$inferSelect;

/** The touch a form came with: the utm and referrer the visit arrived on. */
export interface FormTouch {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  ref?: string | null;
}

export const siteForms = pgTable(
  "site_forms",
  {
    id: uuid("id").defaultRandom().notNull(),
    page: uuid("page").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    fields: jsonb("fields").$type<Record<string, string>>().notNull(),
    touch: jsonb("touch").$type<FormTouch>().notNull(),
    channel: varchar("channel", { length: 10 }).notNull(),
    /** Sent to the door; false with `why` when it had none or it refused. */
    entered: boolean("entered").notNull().default(false),
    why: text("why"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_site_forms" }),
    index("ix_site_forms_page_at").on(t.page, t.at),
    foreignKey({
      columns: [t.page],
      foreignColumns: [sitePages.id],
      name: "fk_site_forms_page",
    }).onDelete("cascade"),
    oneOf("ck_site_forms_channel", t.channel, CHANNELS),
  ],
);
export type SiteForm = typeof siteForms.$inferSelect;
