/**
 * One row per video being edited (designs/2026-10-06-video-editor.md, The edit). Every time is in
 * seconds on the raw main track; the cut timeline is derived (`keepSegments`). `words` and `tracks`
 * are written by ingest only; the rest is the edit Claude Code writes through `wren video set`.
 */
import { oneOf } from "@wren/db/columns";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import type { Captions } from "./caption-styles.js";
import type { Crops, TextOverlay } from "./finish.js";
import type { Music, Sound } from "./sounds.js";

/** `rejected`: he said no on the page (designs/2026-10-13-video-review.md); its files stay. */
export const EDIT_STATES = [
  "added",
  "edited",
  "rendered",
  "approved",
  "uploaded",
  "rejected",
] as const;
export type EditState = (typeof EDIT_STATES)[number];

/** silence: the silence pass. filler, retake: proposed by code or Claude. manual: his. */
export const CUT_WHYS = ["silence", "filler", "retake", "manual"] as const;
/** cut: applied. proposed: struck through, waits for a yes. kept: undone (`wren video keep`). */
export const CUT_STATES = ["cut", "proposed", "kept"] as const;
export const LAYOUTS = ["corner", "cam", "screen"] as const;
/**
 * What one recording renders as: the 16:9 long video, and the whole cut cropped to 9:16
 * (`vertical`), 1:1 (`square`) or 4:5 (`portrait`) (designs/2026-10-15-video-finishing.md).
 */
export const FORMATS = ["long", "vertical", "square", "portrait"] as const;
export type Format = (typeof FORMATS)[number];

export interface Word {
  w: string;
  s: number;
  e: number;
}
export interface Cut {
  from: number;
  to: number;
  why: (typeof CUT_WHYS)[number];
  state: (typeof CUT_STATES)[number];
}
export interface Track {
  path: string;
  durationS: number;
  width: number;
  height: number;
  fps: number;
}
export interface Tracks {
  /** The OBS recording: the screen (or the whole scene), and the audio every cut is heard on. */
  main: Track;
  /** Source Record's camera file; `offsetS` = camera time minus main time for one moment. */
  cam?: Track & { offsetS: number };
  /** One-file recordings: where OBS placed the cam, in main-track pixels (for Shorts). */
  camBox?: [number, number, number, number];
}
export interface LayoutRange {
  from: number;
  to: number;
  show: (typeof LAYOUTS)[number];
}
export interface Short {
  from: number;
  to: number;
  title: string;
  /** The title on screen for its first seconds (`ShortProps.card`); false hides it. Default on. */
  card?: boolean | undefined;
  /** What the on-screen title says instead of `title`. */
  cardText?: string | undefined;
}
export interface Chapter {
  at: number;
  title: string;
}
/** What a look pass (Gemini, TwelveLabs) saw; the same shape from both. */
export interface Look {
  at: string;
  summary: string;
  moments: { at: number; why: string }[];
  shorts: Short[];
  chapters: Chapter[];
  thumbnails: { at: number; why: string }[];
  /**
   * The provider's own copy of the cut file, when it keeps one (TwelveLabs: the indexed asset, so
   * `wren video find` searches it). `cut` names the cut file's version; `minutes` is what this
   * edit has spent of the free plan so far.
   */
  media?: { id: string; asset: string; cut: string; minutes: number };
}

/**
 * A render asked for from the page (step 4), on its way: waiting for the Mac, rendering there, or
 * failed and why. Null once it is done, or when none was asked.
 */
export interface RenderState {
  state: "waiting" | "rendering" | "failed";
  at: string;
  by?: string;
  why?: string;
}

export const videoEdits = pgTable(
  "video_edits",
  {
    id: serial("id"),
    title: text("title").notNull().default(""),
    state: varchar("state", { length: 16, enum: EDIT_STATES }).notNull().default("added"),
    /** Where cut and rendered files go: beside the recording. */
    dir: text("dir").notNull(),
    tracks: jsonb("tracks").$type<Tracks>().notNull(),
    /** The read-along script (`--script`), as plain text. */
    script: jsonb("script").$type<{ url: string; text: string }>(),
    words: jsonb("words").$type<Word[]>().notNull().default([]),
    cuts: jsonb("cuts").$type<Cut[]>().notNull().default([]),
    /**
     * The silence pass again with the Short knobs (`cutKnobs(db, "short")`): the tighter cuts only
     * Shorts take, over `cuts` (`shortCuts`). Written by ingest and `wren video cuts`, never by a patch.
     */
    shortCuts: jsonb("short_cuts").$type<Cut[]>().notNull().default([]),
    /** Ranges that are not the default corner layout. */
    layout: jsonb("layout").$type<LayoutRange[]>().notNull().default([]),
    /** The style, where each format shows them (`onScreen`), `behind`: stressed words behind him. */
    captions: jsonb("captions").$type<Captions>().notNull().default({ on: true, style: "word" }),
    /** Stressed words (step 6), as indexes into `words`: the `stress` style, the words behind. */
    stress: jsonb("stress").$type<number[]>().notNull().default([]),
    shorts: jsonb("shorts").$type<Short[]>().notNull().default([]),
    /** Set by ingest from the main track's shape (`formatsFor`); `wren video set` changes it. */
    formats: jsonb("formats").$type<Format[]>().notNull().default(["long"]),
    description: text("description").notNull().default(""),
    chapters: jsonb("chapters").$type<Chapter[]>().notNull().default([]),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    /** The cover frame (`at`, raw seconds) and the thumbnail's words. */
    thumbnail: jsonb("thumbnail").$type<{ at: number; text: string }>(),
    /** Text on the video (finish.ts), raw seconds. */
    overlays: jsonb("overlays").$type<TextOverlay[]>().notNull().default([]),
    /** Kit sounds at raw moments (`sounds.ts`): `wren video sounds` places them, he may change them. */
    sounds: jsonb("sounds").$type<Sound[]>().notNull().default([]),
    /** The music bed under every output, ducked under speech; null: none. */
    music: jsonb("music").$type<Music>(),
    /** Each cropped format's middle on the picture; unset: on his face. */
    crops: jsonb("crops").$type<Crops>().notNull().default({}),
    /** Keyed by provider: gemini, twelvelabs. */
    looks: jsonb("looks").$type<Record<string, Look>>().notNull().default({}),
    /** Local outputs by name: cutMain, cutCam, then (step 2) long, shorts, thumbnails. */
    files: jsonb("files").$type<Record<string, string>>().notNull().default({}),
    /** S3 keys of previews and stills (step 2). */
    keys: jsonb("keys").$type<Record<string, string>>().notNull().default({}),
    render: jsonb("render").$type<RenderState>(),
    /** Parts a person set by hand, which the agent keeps (`locks.ts`): `cuts`, `shorts.2`, `crops.vertical`. */
    locked: jsonb("locked").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_video_edits" }),
    oneOf("ck_video_edits_state", t.state, EDIT_STATES),
  ],
);

export type VideoEdit = typeof videoEdits.$inferSelect;

/** good: keep this. bad: change this. Vireo's note tones. */
export const MARK_TONES = ["good", "bad"] as const;
export type MarkTone = (typeof MARK_TONES)[number];
/** A part of the picture: fractions 0..1 of the frame of the shape it was drawn on. */
export interface MarkBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
/**
 * Where a mark points: Vireo's time anchor, on the raw recording's clock (as every edit time is).
 * `end` unset: one moment. `box`: a part of the picture, on the shape in `format`.
 */
export interface MarkAnchor {
  type: "time";
  start: number;
  end?: number | undefined;
  box?: MarkBox | undefined;
}

/**
 * A note on a video, pinned to a moment, a range or a part of the picture (designs/
 * 2026-11-10-video-editor-pick.md, marks). The person writes it in Finish or says it; the agent
 * reads the open ones, changes the edit and closes each with what it did (`doneWhy`).
 */
export const videoMarks = pgTable(
  "video_marks",
  {
    id: serial("id"),
    editId: integer("edit_id").notNull(),
    anchor: jsonb("anchor").$type<MarkAnchor>().notNull(),
    /** The shape on screen when it was made (`long`, `vertical`, ...); a box is on its frame. */
    format: varchar("format", { length: 12 }).notNull().default("long"),
    tone: varchar("tone", { length: 4, enum: MARK_TONES }),
    text: text("text").notNull(),
    by: varchar("by", { length: 320 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Closed: the agent acted on it, or he took it back. */
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneBy: varchar("done_by", { length: 320 }),
    /** What was done about it, in a sentence: what the person reads under the mark. */
    doneWhy: text("done_why"),
    /** The `runs` row that closed it (an agent pass). */
    doneRun: varchar("done_run", { length: 64 }),
    /** Taken back: out of every list, kept so Undo puts it back as it was. */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: varchar("removed_by", { length: 320 }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_video_marks" }),
    foreignKey({
      columns: [t.editId],
      foreignColumns: [videoEdits.id],
      name: "fk_video_marks_edit_id_video_edits",
    }).onDelete("cascade"),
    index("ix_video_marks_edit").on(t.editId),
    oneOf("ck_video_marks_tone", t.tone, MARK_TONES),
  ],
);
export type VideoMark = typeof videoMarks.$inferSelect;

/** The parts of an edit someone can be on: Finish's tabs, and the cuts and the sound. */
export const PRESENCE_PARTS = [
  "cuts",
  "text",
  "captions",
  "cover",
  "shapes",
  "shorts",
  "layout",
  "marks",
  "sound",
] as const;
export type PresencePart = (typeof PRESENCE_PARTS)[number];

/**
 * Where someone is on a video, one row per step (designs/2026-11-10-video-editor-pick.md, agent
 * cursor). An agent says it before it reads or changes a part; Finish draws the newest row of each
 * `who` while it is fresh. Rows are kept: together they are the path the agent took.
 */
export const videoPresence = pgTable(
  "video_presence",
  {
    id: serial("id"),
    editId: integer("edit_id").notNull(),
    /** A person's email, or an agent's session id. */
    who: varchar("who", { length: 320 }).notNull(),
    /** The moment or range it is on, raw seconds; a box as on a mark. */
    anchor: jsonb("anchor").$type<MarkAnchor>(),
    part: varchar("part", { length: 12, enum: PRESENCE_PARTS }),
    /** What it does there, in a sentence. */
    doing: text("doing"),
    /** It left: no cursor from this row on. */
    gone: boolean("gone").notNull().default(false),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_video_presence" }),
    foreignKey({
      columns: [t.editId],
      foreignColumns: [videoEdits.id],
      name: "fk_video_presence_edit_id_video_edits",
    }).onDelete("cascade"),
    index("ix_video_presence_edit_seen").on(t.editId, t.seenAt),
    oneOf("ck_video_presence_part", t.part, PRESENCE_PARTS),
  ],
);
export type VideoPresence = typeof videoPresence.$inferSelect;

/** What a project makes: a long video, a Short, an ad, a product demo. */
export const PROJECT_KINDS = ["long", "short", "ad", "demo"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

/** A ref a project starts from: a tracked creator's post (`creator_posts` id) or a Canon record. */
export interface ProjectInspiration {
  kind: "post" | "canon";
  ref: string;
  /** Why it inspires this one, in a sentence. */
  why?: string | undefined;
}

/**
 * One video from the idea on (designs/2026-11-13-studio-suite.md, D1). It holds only what comes
 * before footage; once filmed, `edit_id` names the edit and Pieces gives the state. No stage column.
 */
export const videoProjects = pgTable(
  "video_projects",
  {
    id: serial("id"),
    title: text("title").notNull(),
    kind: varchar("kind", { length: 8, enum: PROJECT_KINDS }).notNull().default("long"),
    brief: text("brief").notNull().default(""),
    inspiration: jsonb("inspiration").$type<ProjectInspiration[]>().notNull().default([]),
    /** Null until it is filmed (`wren video add --project`). */
    editId: integer("edit_id"),
    /** Vireo subject id per part kind under test: `hook`, `title`, `cta`, `thumbnail`, `combo`, `edit`. */
    subjects: jsonb("subjects").$type<Record<string, number>>().notNull().default({}),
    /** The Vireo folder its subjects sit in. */
    folder: integer("folder"),
    /** An agent's session id, or a person's email. */
    by: varchar("by", { length: 320 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_video_projects" }),
    foreignKey({
      columns: [t.editId],
      foreignColumns: [videoEdits.id],
      name: "fk_video_projects_edit_id_video_edits",
    }).onDelete("set null"),
    index("ix_video_projects_edit").on(t.editId),
    oneOf("ck_video_projects_kind", t.kind, PROJECT_KINDS),
  ],
);
export type VideoProject = typeof videoProjects.$inferSelect;
