/**
 * Variants (designs/2026-11-05-variants.md): subjects we iterate on, batches the agent sends,
 * samples, William's calls and anchored notes, guides under test. No client column: a client's
 * subjects live in its own database (same migrations), so isolation is the database's.
 */
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

export const variants = pgSchema("variants");

/** What a sample is: shown inline (text), as an image, a video with time marks, or a page in a frame. */
export const KINDS = ["text", "image", "video", "page"] as const;
export type Kind = (typeof KINDS)[number];
export const SUBJECT_STATES = ["open", "paused", "done"] as const;
export const BATCH_STATES = ["open", "closed"] as const;
/** William's call on a whole sample. */
export const VERDICTS = ["amazing", "good", "bad"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const TONES = ["good", "bad"] as const;
export type Tone = (typeof TONES)[number];
export const GUIDE_SOURCES = ["william", "study", "sop", "skill", "agent"] as const;
export const GUIDE_STATES = ["testing", "locked", "dropped"] as const;
export type GuideState = (typeof GUIDE_STATES)[number];

/**
 * Where a note points, after W3C Web Annotation selectors: a text quote, a box on an image or
 * frame (fractions 0-1), a time range on a video (seconds; optional box).
 */
export type Anchor =
  | { type: "quote"; exact: string; prefix?: string; suffix?: string }
  | { type: "box"; x: number; y: number; w: number; h: number }
  | {
      type: "time";
      start: number;
      end?: number;
      box?: { x: number; y: number; w: number; h: number };
    };

const at = (name: string) => timestamp(name, { withTimezone: true });

export const subjects = variants.table(
  "subjects",
  {
    id: serial("id"),
    /** Short handle for the CLI: `opener-recruiters`. */
    slug: varchar("slug", { length: 60 }).notNull(),
    name: text("name").notNull(),
    kind: varchar("kind", { length: 8, enum: KINDS }).notNull(),
    /** William's direction; null starts from scratch. */
    brief: text("brief"),
    /** Starting points: study slugs, SOP paths, sample ids, files. */
    seeds: jsonb("seeds").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    state: varchar("state", { length: 8, enum: SUBJECT_STATES }).notNull().default("open"),
    by: varchar("by", { length: 320 }),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_subjects" }),
    unique("uq_variants_subjects_slug").on(t.slug),
    oneOf("ck_variants_subjects_kind", t.kind, KINDS),
    oneOf("ck_variants_subjects_state", t.state, SUBJECT_STATES),
  ],
);

export const batches = variants.table(
  "batches",
  {
    id: serial("id"),
    subjectId: integer("subject_id").notNull(),
    /** The agent's why: what it changed from the last batch and what it tests. */
    why: text("why").notNull(),
    /** Agent id (session or run) that made it. */
    agent: varchar("agent", { length: 120 }),
    state: varchar("state", { length: 8, enum: BATCH_STATES }).notNull().default("open"),
    /** William's guide note for the next batch. */
    note: text("note"),
    closedAt: at("closed_at"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_batches" }),
    foreignKey({
      columns: [t.subjectId],
      foreignColumns: [subjects.id],
      name: "fk_batches_subject_id_subjects",
    }).onDelete("cascade"),
    index("ix_variants_batches_subject").on(t.subjectId, t.state),
    oneOf("ck_variants_batches_state", t.state, BATCH_STATES),
  ],
);

export const samples = variants.table(
  "samples",
  {
    id: serial("id"),
    batchId: integer("batch_id").notNull(),
    subjectId: integer("subject_id").notNull(),
    /** Order shown; shuffled per batch so the agent's order tells nothing. */
    position: smallint("position").notNull().default(0),
    /** Inline text, or html for a page. */
    body: text("body"),
    /** s3:// uri of the image, video or page file. */
    media: text("media"),
    /** s3:// uri of a still for a video. */
    poster: text("poster"),
    parentId: integer("parent_id"),
    /** Guide ids this sample applied: a guide's with-vs-without rate reads these. */
    guides: integer("guides").array().notNull().default(sql`'{}'::integer[]`),
    /** What changed from the parent, in the agent's words; hidden while William judges. */
    change: text("change"),
    agent: varchar("agent", { length: 120 }),
    verdict: varchar("verdict", { length: 8, enum: VERDICTS }),
    /** In the catalog. */
    keptAt: at("kept_at"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_samples" }),
    foreignKey({
      columns: [t.batchId],
      foreignColumns: [batches.id],
      name: "fk_samples_batch_id_batches",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.subjectId],
      foreignColumns: [subjects.id],
      name: "fk_samples_subject_id_subjects",
    }).onDelete("cascade"),
    index("ix_variants_samples_batch").on(t.batchId),
    index("ix_variants_samples_subject").on(t.subjectId),
    oneOf("ck_variants_samples_verdict", t.verdict, VERDICTS),
  ],
);

/** A note on a sample: anchored (a line, a region, a moment) or on the whole. */
export const notes = variants.table(
  "notes",
  {
    id: serial("id"),
    sampleId: integer("sample_id").notNull(),
    anchor: jsonb("anchor").$type<Anchor>(),
    tone: varchar("tone", { length: 4, enum: TONES }),
    text: text("text"),
    by: varchar("by", { length: 320 }),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_notes" }),
    foreignKey({
      columns: [t.sampleId],
      foreignColumns: [samples.id],
      name: "fk_notes_sample_id_samples",
    }).onDelete("cascade"),
    index("ix_variants_notes_sample").on(t.sampleId),
    oneOf("ck_variants_notes_tone", t.tone, TONES),
  ],
);

/** A tip or rule the agent writes from. Scope: one subject, one kind, or (both null) all. */
export const guides = variants.table(
  "guides",
  {
    id: serial("id"),
    text: text("text").notNull(),
    source: varchar("source", { length: 8, enum: GUIDE_SOURCES }).notNull().default("william"),
    /** Where it came from: a study slug, an SOP path, a skill name. */
    ref: text("ref"),
    subjectId: integer("subject_id"),
    kind: varchar("kind", { length: 8, enum: KINDS }),
    state: varchar("state", { length: 8, enum: GUIDE_STATES }).notNull().default("testing"),
    by: varchar("by", { length: 320 }),
    decidedAt: at("decided_at"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_guides" }),
    foreignKey({
      columns: [t.subjectId],
      foreignColumns: [subjects.id],
      name: "fk_guides_subject_id_subjects",
    }).onDelete("cascade"),
    oneOf("ck_variants_guides_source", t.source, GUIDE_SOURCES),
    oneOf("ck_variants_guides_kind", t.kind, KINDS),
    oneOf("ck_variants_guides_state", t.state, GUIDE_STATES),
  ],
);
