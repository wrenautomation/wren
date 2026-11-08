/**
 * One folder tree for every product's items (designs/2026-11-08-folders.md). An item is a link
 * `(kind, ref)`; the products it points into know nothing of folders.
 */
import { subjects } from "@wrenautomation/vireo/schema";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

export const foldersSchema = pgSchema("folders");

/** chat: a relay session id. subject: a Vireo subject id. run: a Weaver run id. */
export const ITEM_KINDS = ["chat", "subject", "run"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const folders = foldersSchema.table(
  "folders",
  {
    id: serial("id").notNull(),
    /** null: top level. Drop moves children up, so no cascade. */
    parentId: integer("parent_id"),
    name: text("name").notNull(),
    madeBy: text("made_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_folders" }),
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: "fk_folders_parent" }),
    index("ix_folders_parent").on(t.parentId),
    // one name per level, top level too
    unique("uq_folders_name").on(t.parentId, t.name).nullsNotDistinct(),
    check("ck_folders_name", sql`length(btrim(${t.name})) between 1 and 80`),
    check("ck_folders_not_own_parent", sql`${t.parentId} is distinct from ${t.id}`),
  ],
);

/** One row per filed item; no row = unfiled. One folder per item. */
export const filed = foldersSchema.table(
  "filed",
  {
    kind: varchar("kind", { length: 8, enum: ITEM_KINDS }).notNull(),
    ref: text("ref").notNull(),
    folderId: integer("folder_id").notNull(),
    /** kind subject only: the DB refuses a subject that does not exist; a deleted one leaves. */
    subjectId: integer("subject_id").generatedAlwaysAs(
      sql`case when kind = 'subject' then ref::integer end`,
    ),
    filedBy: text("filed_by").notNull(),
    filedAt: timestamp("filed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.ref], name: "pk_filed" }),
    foreignKey({ columns: [t.folderId], foreignColumns: [folders.id], name: "fk_filed_folder" }),
    foreignKey({
      columns: [t.subjectId],
      foreignColumns: [subjects.id],
      name: "fk_filed_subject",
    }).onDelete("cascade"),
    index("ix_filed_folder").on(t.folderId),
    index("ix_filed_subject").on(t.subjectId),
    check("ck_filed_ref", sql`length(${t.ref}) between 1 and 120`),
  ],
);
