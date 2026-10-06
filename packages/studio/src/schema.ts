/**
 * One row per video being edited (designs/2026-10-06-video-editor.md, The edit). Every time is in
 * seconds on the raw main track; the cut timeline is derived (`keepSegments`). `words` and `tracks`
 * are written by ingest only; the rest is the edit Claude Code writes through `wren video set`.
 */
import { oneOf } from "@wren/db/columns";
import { jsonb, pgTable, primaryKey, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const EDIT_STATES = ["added", "edited", "rendered", "approved", "uploaded"] as const;
export type EditState = (typeof EDIT_STATES)[number];

/** silence: the silence pass. filler, retake: proposed by code or Claude. manual: his. */
export const CUT_WHYS = ["silence", "filler", "retake", "manual"] as const;
/** cut: applied. proposed: struck through, waits for a yes. kept: undone (`wren video keep`). */
export const CUT_STATES = ["cut", "proposed", "kept"] as const;
export const LAYOUTS = ["corner", "cam", "screen"] as const;

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
    /** Ranges that are not the default corner layout. */
    layout: jsonb("layout").$type<LayoutRange[]>().notNull().default([]),
    captions: jsonb("captions")
      .$type<{ on: boolean; style: string }>()
      .notNull()
      .default({ on: true, style: "word" }),
    shorts: jsonb("shorts").$type<Short[]>().notNull().default([]),
    description: text("description").notNull().default(""),
    chapters: jsonb("chapters").$type<Chapter[]>().notNull().default([]),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    thumbnail: jsonb("thumbnail").$type<{ at: number; text: string }>(),
    /** Keyed by provider: gemini, twelvelabs. */
    looks: jsonb("looks").$type<Record<string, Look>>().notNull().default({}),
    /** Local outputs by name: cutMain, cutCam, then (step 2) long, shorts, thumbnails. */
    files: jsonb("files").$type<Record<string, string>>().notNull().default({}),
    /** S3 keys of previews and stills (step 2). */
    keys: jsonb("keys").$type<Record<string, string>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_video_edits" }),
    oneOf("ck_video_edits_state", t.state, EDIT_STATES),
  ],
);

export type VideoEdit = typeof videoEdits.$inferSelect;
