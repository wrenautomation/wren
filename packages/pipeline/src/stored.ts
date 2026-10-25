/**
 * A stored shape body is one of two models (designs/2026-10-20-design-language.md, area C1): a
 * body with `model: "metro"` is the metro model, a body without `model` is the graph. Both sit in
 * the same column. The runtime keeps the graph: it reads `runOf`, which lowers a metro body with
 * `graphOf`. Readers that draw the map read `metroView`, which draws a graph body with `metroOf`.
 * Ids pass through both ways (a station id is the node id), so journeys and deals need no remap.
 *
 * This file is a leaf: it reads no database and imports nothing that does. It holds the one entry
 * point each for diff and blame over stored bodies. Undo and save live next to their database code.
 */
import { historyOf } from "./blame.js";
import { graphOf, lowerable, metroOf } from "./convert.js";
import {
  canonicalJson,
  changeKey,
  changeLine,
  changesOf,
  diffShapes,
  parseChangeKey,
  type ShapeChange,
  type ShapeDiff,
} from "./diff.js";
import type { BlameLine, ChangeLine } from "./history.js";
import { checkMetro, isMetro, type MetroBody } from "./metro.js";
import { historyOfMetro } from "./metro-blame.js";
import {
  diffMetro,
  type MetroChange,
  type MetroDiff,
  type MetroOn,
  metroChangeKey,
  metroChangeLine,
  metroChangesOf,
  parseMetroChangeKey,
} from "./metro-diff.js";
import { checkShape, type ShapeBody, type ShapeCheckContext } from "./model.js";
import { Refused } from "./refused.js";

export type StoredBody = ShapeBody | MetroBody;

/** The body the runtime runs: a graph as it is, a metro body lowered. Same ids both ways. */
export const runOf = (stored: StoredBody): ShapeBody =>
  isMetro(stored) ? graphOf(stored) : stored;

/**
 * The body the map draws: a metro body as it is, a graph drawn with `metroOf`. Refused when the
 * graph cannot be drawn. For a body `checkShape` accepts that is one case: a node called `hub`,
 * because the metro model reserves that id.
 */
export function metroView(stored: StoredBody): MetroBody {
  if (isMetro(stored)) return stored;
  const drawn = metroOf(stored);
  if (!drawn.ok) throw new Refused(drawn.errors);
  return drawn.body;
}

/**
 * The map model of a stored body, or the reasons it cannot be drawn. A metro body always draws;
 * a graph does not when it holds a node called `hub`.
 */
export function drawnOf(
  stored: StoredBody,
): { ok: true; metro: MetroBody } | { ok: false; errors: string[] } {
  try {
    return { ok: true, metro: metroView(stored) };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, errors: e.errors };
    throw e;
  }
}

/** True when two stored bodies hold the same data, whatever the key order. */
export const sameStored = (a: StoredBody, b: StoredBody): boolean =>
  canonicalJson(a) === canonicalJson(b);

/**
 * Every reason a stored body cannot be saved, in plain English. Empty means ok. A graph goes
 * through `checkShape`. A metro body goes through `checkMetro` and `lowerable` together, then, only
 * when both pass, through `checkShape` on the graph it lowers to: the runtime runs that graph.
 */
export function checkStored(stored: StoredBody, ctx: ShapeCheckContext): string[] {
  if (!isMetro(stored)) return checkShape(stored, ctx);
  const errors = [...checkMetro(stored, ctx), ...lowerable(stored)];
  return errors.length > 0 ? errors : checkShape(graphOf(stored), ctx);
}

// --- diff -----------------------------------------------------------------------------------

/** A diff in the terms of the two bodies: graph when both are graphs, else metro. */
export type StoredDiff = { model: "graph"; diff: ShapeDiff } | { model: "metro"; diff: MetroDiff };

/** What changed from `a` to `b`. Two graphs diff as graphs. Any metro body makes it a metro diff. */
export function diffStored(a: StoredBody, b: StoredBody): StoredDiff {
  if (!isMetro(a) && !isMetro(b)) return { model: "graph", diff: diffShapes(a, b) };
  return { model: "metro", diff: diffMetro(metroView(a), metroView(b)) };
}

/** Two bodies as a metro diff, when both draw; else as they are. */
function metroDiffOf(a: StoredBody, b: StoredBody): StoredDiff {
  const [da, db] = [drawnOf(a), drawnOf(b)];
  if (!da.ok || !db.ok) return diffStored(a, b);
  return { model: "metro", diff: diffMetro(da.metro, db.metro) };
}

/** One change of either model. `name` is the same value in both. */
export type StoredChange = ShapeChange | MetroChange;

/** The graph's own kinds of change (node and edge). `name` is the same in both models. */
type GraphChange = Exclude<ShapeChange, { on: "name" }>;

/** True for the graph's own kinds of change (node and edge). */
const isGraphChange = (c: StoredChange): c is GraphChange => c.on === "node" || c.on === "edge";

export const storedChangesOf = (d: StoredDiff): StoredChange[] =>
  d.model === "graph" ? changesOf(d.diff) : metroChangesOf(d.diff);

export const storedChangeKey = (c: StoredChange): string =>
  isGraphChange(c) ? changeKey(c) : metroChangeKey(c);

/** A key back to its change; null when it names none. `node:` and `edge:` are graph keys. */
export const parseStoredChangeKey = (key: string): StoredChange | null =>
  parseChangeKey(key) ?? parseMetroChangeKey(key);

/** One change as a plain line, `a` older and `b` newer. A rename of the shape reads the same. */
export function storedChangeLine(a: StoredBody, b: StoredBody, c: StoredChange): string {
  if (isGraphChange(c) || c.on === "name") return changeLine(runOf(a), runOf(b), c);
  return metroChangeLine(metroView(a), metroView(b), c);
}

/** Every change of `d` (from `a` to `b`) as a plain line. */
export const storedChangeLines = (a: StoredBody, b: StoredBody, d: StoredDiff): string[] =>
  storedChangesOf(d).map((c) => storedChangeLine(a, b, c));

/** What the web shows of a diff from `a` to `b`: the diff, its lines, and both sides drawn. */
interface DiffParts {
  /** In the stored bodies' terms: graph keys when both are graphs. Undo takes these keys. */
  diff: StoredDiff;
  changes: ChangeLine[];
  /** Both sides as the map draws them. Null when a side cannot be drawn. */
  views: [MetroBody, MetroBody] | null;
  /** `diffMetro(views[0], views[1])`: the marks. Null with `views`. */
  marks: MetroDiff | null;
}

/**
 * One diff answer for every handler: the diff in the stored terms, each change as its undo key and
 * a plain line, and both sides drawn with the marks between them. A side that cannot be drawn
 * leaves `views` and `marks` null; the diff and the lines stay.
 *
 * `onMetro` says the newest version is a metro body. Undo takes keys of the newest version's
 * model, so two graph bodies then diff as a metro diff, when both draw.
 */
export function diffAnswerOf(a: StoredBody, b: StoredBody, onMetro = false): DiffParts {
  const diff = onMetro && !isMetro(a) && !isMetro(b) ? metroDiffOf(a, b) : diffStored(a, b);
  const changes = storedChangesOf(diff).map((c) => ({
    key: storedChangeKey(c),
    line: storedChangeLine(a, b, c),
  }));
  const [da, db] = [drawnOf(a), drawnOf(b)];
  if (!da.ok || !db.ok) return { diff, changes, views: null, marks: null };
  return { diff, changes, views: [da.metro, db.metro], marks: diffMetro(da.metro, db.metro) };
}

// --- blame ----------------------------------------------------------------------------------

/** What `historyOfStored` reads of each version. */
interface StoredBlameVersion {
  number: number;
  body: StoredBody;
  note: string;
  createdBy: string;
  createdAt: Date | string;
}

/** What a blame asks for: a graph node or edge, or a line, station, track, group, frame, flow. */
export type BlameOn = "node" | "edge" | MetroOn;

/**
 * Every version that touched item `id`, newest first. A node or an edge reads each version as the
 * graph the runtime runs; any other kind reads each version as the map draws it. A station keeps
 * its history across the convert, because its id is the node id.
 */
export function historyOfStored(
  versions: readonly StoredBlameVersion[],
  id: string,
  on: BlameOn = "node",
): BlameLine[] {
  if (on === "node" || on === "edge")
    return historyOf(
      versions.map((v) => ({ ...v, body: runOf(v.body) })),
      id,
      on,
    );
  return historyOfMetro(
    versions.map((v) => ({ ...v, body: metroView(v.body) })),
    id,
    on,
  );
}
