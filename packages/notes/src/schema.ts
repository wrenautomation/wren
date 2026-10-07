/**
 * Notes (designs/2026-10-07-notes.md): docs in every workspace, in every database. A client's
 * notes live in its own database; Wren's in main.
 *
 * - `notes`: one row per doc. `y_state` is the Yjs doc, the source of truth; `title`, `body`
 *   (editor JSON) and `text` are derived from it on every save, for search, links and export.
 * - `note_updates`: every Yjs update as it arrived, who sent it. Append only.
 * - `note_versions`: the timeline. An `auto` version is one person's editing session.
 * - `note_shares`, `note_stars`, `note_seen`, `note_links`, `notes_settings`.
 * - `note_comments` (threads anchored to a range) and `note_mentions` (who was `@`ed, and seen).
 */
import { oneOf } from "@wren/db/columns";
import { type SQL, sql } from "drizzle-orm";
import {
  boolean,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  type CommentAnchor,
  GENERAL,
  KINDS,
  type NoteJson,
  ROLES,
  VERSION_KINDS,
  VIA,
} from "./types.js";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (v) => Buffer.from(v),
  fromDriver: (v) => new Uint8Array(v),
});
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").defaultRandom().notNull(),
    parentId: uuid("parent_id"),
    /** `dump`: a person's capture note, one per person per workspace. */
    kind: varchar("kind", { length: 8, enum: KINDS }).notNull().default("note"),
    title: varchar("title", { length: 300 }).notNull().default(""),
    body: jsonb("body").$type<NoteJson>().notNull().default({ type: "doc", content: [] }),
    text: text("text").notNull().default(""),
    search: tsvector("search").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english'::regconfig, (title)::text), 'A'::"char") || setweight(to_tsvector('english'::regconfig, text), 'B'::"char")`,
    ),
    yState: bytea("y_state"),
    /** An email, or `agent:<name>`. */
    owner: varchar("owner", { length: 200 }).notNull(),
    createdBy: varchar("created_by", { length: 200 }).notNull(),
    via: varchar("via", { length: 8, enum: VIA }).notNull().default("person"),
    /** Everyone in the workspace gets `general_role`, or only those it's shared with. */
    general: varchar("general", { length: 12, enum: GENERAL }).notNull().default("private"),
    generalRole: varchar("general_role", { length: 8, enum: ROLES }).notNull().default("view"),
    /** In `wren train export --notes` (its workspace's `notes_settings.train` counts too). */
    train: boolean("train").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    editedBy: varchar("edited_by", { length: 200 }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_notes" }),
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: "fk_notes_parent" }).onDelete(
      "set null",
    ),
    oneOf("ck_notes_kind", t.kind, KINDS),
    oneOf("ck_notes_via", t.via, VIA),
    oneOf("ck_notes_general", t.general, GENERAL),
    oneOf("ck_notes_general_role", t.generalRole, ROLES),
    index("ix_notes_owner").on(t.owner, t.updatedAt),
    index("ix_notes_updated").on(t.updatedAt),
    index("ix_notes_parent").on(t.parentId),
    index("ix_notes_search").using("gin", t.search),
    uniqueIndex("uq_notes_dump").on(t.owner).where(sql`kind = 'dump'`),
  ],
);
export type Note = typeof notes.$inferSelect;

/** Who else may open a note: an email, `team` (Wren's team), or `client:<id>` (its people). */
export const noteShares = pgTable(
  "note_shares",
  {
    noteId: uuid("note_id").notNull(),
    who: varchar("who", { length: 200 }).notNull(),
    role: varchar("role", { length: 8, enum: ROLES }).notNull(),
    by: varchar("by", { length: 200 }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.noteId, t.who], name: "pk_note_shares" }),
    foreignKey({
      columns: [t.noteId],
      foreignColumns: [notes.id],
      name: "fk_note_shares_note",
    }).onDelete("cascade"),
    oneOf("ck_note_shares_role", t.role, ROLES),
    index("ix_note_shares_who").on(t.who),
  ],
);

/** Starred, per person. */
export const noteStars = pgTable(
  "note_stars",
  {
    noteId: uuid("note_id").notNull(),
    email: varchar("email", { length: 200 }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.noteId, t.email], name: "pk_note_stars" }),
    foreignKey({
      columns: [t.noteId],
      foreignColumns: [notes.id],
      name: "fk_note_stars_note",
    }).onDelete("cascade"),
  ],
);

/** When each person last opened a note: Recent. */
export const noteSeen = pgTable(
  "note_seen",
  {
    noteId: uuid("note_id").notNull(),
    email: varchar("email", { length: 200 }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.noteId, t.email], name: "pk_note_seen" }),
    foreignKey({
      columns: [t.noteId],
      foreignColumns: [notes.id],
      name: "fk_note_seen_note",
    }).onDelete("cascade"),
    index("ix_note_seen_email").on(t.email, t.at),
  ],
);

/** Every Yjs update a note took, as sent. Replaying them in order rebuilds any moment. */
export const noteUpdates = pgTable(
  "note_updates",
  {
    id: serial("id").notNull(),
    noteId: uuid("note_id").notNull(),
    update: bytea("update").notNull(),
    by: varchar("by", { length: 200 }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_note_updates" }),
    foreignKey({
      columns: [t.noteId],
      foreignColumns: [notes.id],
      name: "fk_note_updates_note",
    }).onDelete("cascade"),
    index("ix_note_updates_note").on(t.noteId, t.id),
  ],
);

/**
 * The timeline. `auto`: one person's session, kept current while they edit; `named`, `restore`
 * and `import` are made once. `body` and `text` are the note at the version's end.
 */
export const noteVersions = pgTable(
  "note_versions",
  {
    id: serial("id").notNull(),
    noteId: uuid("note_id").notNull(),
    number: integer("number").notNull(),
    kind: varchar("kind", { length: 8, enum: VERSION_KINDS }).notNull(),
    name: varchar("name", { length: 200 }),
    title: varchar("title", { length: 300 }).notNull().default(""),
    body: jsonb("body").$type<NoteJson>().notNull(),
    text: text("text").notNull(),
    authors: text("authors").array().notNull().default(sql`'{}'::text[]`),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    restoredFrom: integer("restored_from"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_note_versions" }),
    foreignKey({
      columns: [t.noteId],
      foreignColumns: [notes.id],
      name: "fk_note_versions_note",
    }).onDelete("cascade"),
    oneOf("ck_note_versions_kind", t.kind, VERSION_KINDS),
    uniqueIndex("uq_note_versions_number").on(t.noteId, t.number),
  ],
);
export type NoteVersion = typeof noteVersions.$inferSelect;

/** What a note links to (`<record type>:<id>`, `note:<id>`, `person:<email>`): backlinks. */
export const noteLinks = pgTable(
  "note_links",
  {
    noteId: uuid("note_id").notNull(),
    target: varchar("target", { length: 300 }).notNull(),
    label: varchar("label", { length: 300 }).notNull().default(""),
  },
  (t) => [
    primaryKey({ columns: [t.noteId, t.target], name: "pk_note_links" }),
    foreignKey({
      columns: [t.noteId],
      foreignColumns: [notes.id],
      name: "fk_note_links_note",
    }).onDelete("cascade"),
    index("ix_note_links_target").on(t.target),
  ],
);

/** The workspace's own settings: one row. */
export const notesSettings = pgTable(
  "notes_settings",
  {
    id: integer("id").notNull().default(1),
    /** Every note here goes to `wren train export --notes`. */
    train: boolean("train").notNull().default(false),
    updatedBy: varchar("updated_by", { length: 200 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.id], name: "pk_notes_settings" })],
);

/**
 * A comment: a thread's first (anchored to a range, `parent_id` null) or a reply in it. The
 * anchor is two Yjs relative positions (JSON), so it moves with the text and a commenter never
 * writes to the doc.
 */
export const noteComments = pgTable(
  "note_comments",
  {
    id: uuid("id").defaultRandom().notNull(),
    noteId: uuid("note_id").notNull(),
    /** The thread's first comment; null on that one. */
    parentId: uuid("parent_id"),
    anchor: jsonb("anchor").$type<CommentAnchor>(),
    /** The words it was left on, as they were. */
    quote: varchar("quote", { length: 500 }).notNull().default(""),
    body: text("body").notNull(),
    /** Emails it `@`s. */
    mentions: text("mentions").array().notNull().default(sql`'{}'::text[]`),
    by: varchar("by", { length: 200 }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: varchar("resolved_by", { length: 200 }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_note_comments" }),
    foreignKey({
      columns: [t.noteId],
      foreignColumns: [notes.id],
      name: "fk_note_comments_note",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: "fk_note_comments_parent",
    }).onDelete("cascade"),
    index("ix_note_comments_note").on(t.noteId, t.at),
  ],
);
export type NoteComment = typeof noteComments.$inferSelect;

/** Someone `@`ed in a note's body or a comment: their Mentions, until they open it. */
export const noteMentions = pgTable(
  "note_mentions",
  {
    id: uuid("id").defaultRandom().notNull(),
    noteId: uuid("note_id").notNull(),
    /** The comment it's in; null for the body. */
    commentId: uuid("comment_id"),
    who: varchar("who", { length: 200 }).notNull(),
    by: varchar("by", { length: 200 }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_note_mentions" }),
    foreignKey({
      columns: [t.noteId],
      foreignColumns: [notes.id],
      name: "fk_note_mentions_note",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.commentId],
      foreignColumns: [noteComments.id],
      name: "fk_note_mentions_comment",
    }).onDelete("cascade"),
    index("ix_note_mentions_who").on(t.who, t.at),
    index("ix_note_mentions_note").on(t.noteId),
  ],
);
export type NoteMention = typeof noteMentions.$inferSelect;
