/**
 * The shape's history like git (designs/2026-10-19-business-map.md, "History like git"): what the
 * console routes and the records answer for drafts, proposals, blame, undo, tags and the git
 * mirror. Types only, so the server, the CLI and the Map's web share one contract.
 * Times are ISO text: the shape every answer has on the wire.
 */
import type { Moves } from "./carry.js";
import type { MetroBody } from "./metro.js";
import type { MetroDiff } from "./metro-diff.js";
import type { ShapeBody } from "./model.js";
import type { StoredBody, StoredDiff } from "./stored.js";

/** A draft's life: saved, waiting on a decision, made a version, or dropped with a reason. */
export const DRAFT_STATES = ["draft", "proposed", "applied", "dropped"] as const;
export type DraftState = (typeof DRAFT_STATES)[number];
/** The states a draft can still change in. */
export const OPEN_DRAFT_STATES = ["draft", "proposed"] as const satisfies readonly DraftState[];

/** A version number, or a draft as `draft:<id>`: what `shapeDiff` compares. */
export type ShapeRef = number | `draft:${string}`;

/** One `pipeline.shape_draft` row. */
export interface DraftRow {
  /** A short slug from the name, unique in the workspace. */
  id: string;
  name: string;
  state: DraftState;
  /** The version it was forked from. */
  base: number;
  note: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** The version it became, once applied. */
  appliedVersion: number | null;
  decidedBy: string | null;
  decidedAt: string | null;
  dropReason: string | null;
}

/** A draft's detail (`recordsGet` of `pipeline.shape_draft`). `body` is the graph it runs as. */
export interface DraftDetail {
  body: ShapeBody;
  moves: Moves;
  /** The draft as the map draws it; null when it cannot be drawn. */
  metro: MetroBody | null;
  /** Why it cannot be drawn; empty when it can. */
  drawErrors: string[];
}

/** An immutable label on a version. */
export interface TagRef {
  name: string;
  note: string | null;
  by: string;
  at: string;
}

/** The commit a version landed as in the private repo. */
export interface MirrorRef {
  sha: string;
  /** `https://github.com/<repo>/commit/<sha>`. */
  url: string;
}

/** One version in the `pipeline.shape` detail's `versions`. */
export interface VersionLine {
  number: number;
  parent: number | null;
  note: string;
  at: string;
  by: string;
  nodes: number;
  edges: number;
  /** The draft it came from, when applied from one. */
  draft: string | null;
  tags: TagRef[];
  /** Null until mirrored, or while the mirror is off. */
  mirror: MirrorRef | null;
}

/** One version that touched a node or an edge (`historyOf`), newest first. */
export interface BlameLine {
  version: number;
  how: "added" | "removed" | "renamed" | "changed";
  /** A rename's old and new name. */
  from?: string;
  to?: string;
  /** The version's note: why. */
  note: string;
  by: string;
  at: string;
}

// --- PipelineConsole routes: what each takes and answers ------------------------------------

export interface DraftNewAsk {
  name: string;
  /**
   * A metro body; the store refuses a graph body (`CONVERT_FIRST`). Left out: the draft forks the
   * base version as a metro body.
   */
  body?: StoredBody;
  moves?: Moves;
  /** The version it forks; the newest when left out. */
  base?: number;
  note?: string;
}
export interface DraftNewAnswer {
  id: string;
  base: number;
}
export interface DraftEditAsk {
  id: string;
  /** One op or a list of ops (`metro-ops.ts`). */
  ops: unknown;
}
export interface DraftEditAnswer {
  id: string;
  /** What the ops changed, a line each. */
  lines: string[];
  /** Why apply would refuse the draft as it stands. Fix them with more ops. */
  warnings: string[];
}
export interface DraftPlanAnswer {
  id: string;
  /** The version the draft forked. */
  base: number;
  /** The newest version. */
  live: number;
  /** True when live moved since the base. */
  moved: boolean;
  /** One line per conflict: both values. Any conflict blocks apply. */
  conflicts: string[];
  /** What apply would change in live, a line each. */
  lines: string[];
}
export interface DraftUpdateAsk {
  id: string;
  body: StoredBody;
  moves?: Moves;
  /** Left out keeps the note. */
  note?: string;
}
export interface DraftUpdateAnswer {
  id: string;
  updatedAt: string;
}
export interface DraftIdAsk {
  id: string;
}
export interface DraftDropAsk {
  id: string;
  reason: string;
}
export interface DraftStateAnswer {
  id: string;
  state: DraftState;
}
export interface DraftApplyAnswer {
  id: string;
  version: number;
}
export interface DiffAsk {
  a: ShapeRef;
  b: ShapeRef;
}
/** One change, as its undo key and a plain line, in `storedChangesOf` order. */
export interface ChangeLine {
  key: string;
  line: string;
}
/** What `shapeDiff` answers: from `a` to `b`. */
export interface DiffAnswer {
  a: ShapeRef;
  b: ShapeRef;
  /** In the stored bodies' terms: graph keys when both are graphs. Undo takes these keys. */
  diff: StoredDiff;
  changes: ChangeLine[];
  /** Both sides as the map draws them. Null when a side cannot be drawn (`metroView` refused). */
  views: [MetroBody, MetroBody] | null;
  /** `diffMetro(views[0], views[1])`: the marks. Null with `views`. */
  marks: MetroDiff | null;
}
/** What `shapePreview` answers: from the newest version to the file. */
export interface PreviewAnswer {
  a: number | null;
  diff: StoredDiff;
  changes: ChangeLine[];
  views: [MetroBody, MetroBody] | null;
  marks: MetroDiff | null;
  note: string | null;
  moves: Moves | null;
}
/** Exactly one of these. A node or an edge reads the graph; the rest read the map model. */
export interface BlameAsk {
  node?: string;
  edge?: string;
  station?: string;
  track?: string;
  line?: string;
  group?: string;
}
export interface BlameAnswer {
  lines: BlameLine[];
}
export interface UndoAsk {
  /** The diff the change is a line of: version a to version b. */
  a: number;
  b: number;
  /** `changeKey` of the line. */
  change: string;
}
export interface UndoPreviewAnswer {
  /** The line, as `storedChangeLine` says it. */
  line: string;
  /** The note the undo saves with: `Undo: <line>`. */
  note: string;
  /** The newest version the undo applies to. */
  newest: number;
  /** From the newest body to the result. */
  diff: StoredDiff;
  changes: ChangeLine[];
  views: [MetroBody, MetroBody] | null;
  marks: MetroDiff | null;
}
export interface UndoAnswer {
  version: number;
}
export interface TagAsk {
  name: string;
  version: number;
  note?: string;
}
export interface TagAnswer {
  name: string;
  version: number;
}
