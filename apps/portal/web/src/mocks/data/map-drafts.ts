/**
 * The Map's drafts, blame, tags and undo on the fake server: synthetic drafts of the sample shape
 * (`pipeline.shape_draft`, a record the worker adds with the server half; until then the fake
 * serves it here), and answers for every route the History and the node cards call. Writes log
 * into `MAP_CALLS` and answer as the server does when one lands; the lists do not change.
 * Synthetic data only.
 */
import type { Row } from "@wren/core/records/serve";
import { changeLine, diffShapes, parseChangeKey } from "@wren/pipeline/diff";
import type { BlameLine, DraftRow } from "@wren/pipeline/history";
import type { ShapeBody } from "@wren/pipeline/model";
import { type Answers, refuse } from "../api.js";
import { SHAPE, SHAPE_VERSIONS } from "./journeys.js";
import { MAP_ANSWERS, MAP_CALLS, SHAPE_PLAN, SHAPE_SPUR, SHAPE_V1 } from "./map.js";
import { ago } from "./shell.js";

type Ask = Record<string, unknown>;
type Reply = (b: Ask) => unknown;

/** A draft waiting on a decision: the plan after the offer, started from the newest version. */
export const PROPOSED: DraftRow = {
  id: "d1",
  name: "Add a plan",
  state: "proposed",
  base: 2,
  note: "Sell the Standard plan after the offer.",
  createdBy: "Bo Fenwick",
  createdAt: ago(3),
  updatedAt: ago(1),
  appliedVersion: null,
  decidedBy: null,
  decidedAt: null,
  dropReason: null,
};

/** A draft still being written, started from version 1: live has moved on since. */
export const STALE: DraftRow = {
  id: "d2",
  name: "Follow-up step",
  state: "draft",
  base: 1,
  note: "",
  createdBy: "Ada North",
  createdAt: ago(12),
  updatedAt: ago(6),
  appliedVersion: null,
  decidedBy: null,
  decidedAt: null,
  dropReason: null,
};

/** What "Save as draft" makes in the stories: a draft of the newest shape, opened right after. */
export const SAVED: DraftRow = {
  id: "d4",
  name: "Saved from edits",
  state: "draft",
  base: 2,
  note: "",
  createdBy: "Ada North",
  createdAt: ago(0),
  updatedAt: ago(0),
  appliedVersion: null,
  decidedBy: null,
  decidedAt: null,
  dropReason: null,
};

const DROPPED: DraftRow = {
  id: "d3",
  name: "Old idea",
  state: "dropped",
  base: 1,
  note: "",
  createdBy: "Bo Fenwick",
  createdAt: ago(30),
  updatedAt: ago(20),
  appliedVersion: null,
  decidedBy: "Ada North",
  decidedAt: ago(20),
  dropReason: "Replaced by the plan draft.",
};

/** Every draft the fake holds. */
export const DRAFTS: DraftRow[] = [PROPOSED, STALE, SAVED, DROPPED];
const BODIES: Record<string, ShapeBody> = {
  d1: SHAPE_PLAN,
  d2: SHAPE_SPUR,
  d3: SHAPE_V1,
  d4: SHAPE,
};

const inView = (r: DraftRow, view: unknown) =>
  view === "all"
    ? true
    : view === "proposed"
      ? r.state === "proposed"
      : r.state === "draft" || r.state === "proposed";

/**
 * `recordsList` and `recordsGet` for `pipeline.shape_draft`, in front of the shared answers that
 * `fallback` gives every other record.
 */
export function draftRecords(fallback: { get: Reply; list: Reply }): Answers {
  return {
    "pipeline/recordsList": (b) => {
      if (b.record !== "pipeline.shape_draft") return fallback.list(b);
      const rows = DRAFTS.filter((r) => inView(r, b.view));
      const limit = typeof b.limit === "number" ? b.limit : rows.length;
      return {
        record: "pipeline.shape_draft",
        view: typeof b.view === "string" ? b.view : null,
        rows: rows.slice(0, limit) as unknown as Row[],
        total: rows.length,
        counts: {
          open: DRAFTS.filter((r) => inView(r, "open")).length,
          proposed: DRAFTS.filter((r) => inView(r, "proposed")).length,
          all: DRAFTS.length,
        },
        next: null,
        totals: {},
      };
    },
    "pipeline/recordsGet": (b) => {
      if (b.record !== "pipeline.shape_draft") return fallback.get(b);
      const row = DRAFTS.find((r) => r.id === String(b.id));
      if (!row) return refuse(404, "No such draft.");
      return {
        record: "pipeline.shape_draft",
        row,
        related: [],
        activity: [],
        detail: { body: BODIES[row.id] ?? SHAPE, moves: {} },
      };
    },
  };
}

// --- blame -------------------------------------------------------------------------------------

const by = "Ada North";
const BLAME_NEW: BlameLine = {
  version: 2,
  how: "changed",
  note: SHAPE_VERSIONS[0]?.note ?? "",
  by,
  at: ago(9),
};
const BLAME_FIRST: BlameLine = { version: 1, how: "added", note: "First shape.", by, at: ago(40) };

/** The versions that touched one node or line: ids the sample shape does not know get a 400. */
function blame(b: Ask): unknown {
  const node = typeof b.node === "string" ? b.node : null;
  const edge = typeof b.edge === "string" ? b.edge : null;
  if (node === "joined")
    return {
      lines: [
        { version: 2, how: "removed", note: SHAPE_VERSIONS[0]?.note ?? "", by, at: ago(9) },
        BLAME_FIRST,
      ] satisfies BlameLine[],
    };
  if (node) {
    if (![...SHAPE.nodes, ...SHAPE_PLAN.nodes, ...SHAPE_SPUR.nodes].some((n) => n.id === node))
      return refuse(400, `The shape has no node "${node}".`);
    return { lines: node === "booked" ? [BLAME_NEW, BLAME_FIRST] : [BLAME_FIRST] };
  }
  if (edge) {
    if (edge === "engaged_to_booked")
      return {
        lines: [
          { version: 2, how: "added", note: "Dropped the Joined node.", by, at: ago(9) },
        ] satisfies BlameLine[],
      };
    return { lines: [BLAME_FIRST] };
  }
  return refuse(400, "Name a node or a line.");
}

// --- undo --------------------------------------------------------------------------------------

/** The newest shape with Joined back: what undoing "Removed node Joined" would save. */
const WITH_JOINED: ShapeBody = {
  ...SHAPE,
  nodes: [
    ...SHAPE.nodes,
    { id: "joined", kind: "step", name: "Joined", action: "other", advance: [] },
  ],
};

/** An undo of a line the newest shape changed again is refused, with the server's reasons. */
export const REFUSED_UNDO = "edge:engaged_to_booked:added";

function undoPreview(b: Ask): unknown {
  const key = String(b.change);
  if (key === REFUSED_UNDO)
    return refuse(
      400,
      "Booked changed again in version 3. Undo that change first, or edit the shape by hand.",
    );
  const change = parseChangeKey(key);
  if (!change) return refuse(400, "That line is not in the difference.");
  const line = changeLine(SHAPE_V1, SHAPE, change);
  return {
    line,
    note: `Undo: ${line}`,
    newest: 2,
    diff: diffShapes(SHAPE, WITH_JOINED),
    bodies: [SHAPE, WITH_JOINED],
  };
}

// --- differences against a draft ---------------------------------------------------------------

const bodyOf = (ref: string | number): ShapeBody => {
  const s = String(ref);
  if (s.startsWith("draft:")) return BODIES[s.slice("draft:".length)] ?? SHAPE;
  return Number(s) === 1 ? SHAPE_V1 : SHAPE;
};

const refOf = (v: unknown): string | number => {
  const s = String(v);
  return s.startsWith("draft:") ? s : Number(s);
};

/** `shapeDiff` with a draft on either side; two versions answer as before. */
const shapeDiff: Reply = (b) => {
  const [a, c] = [refOf(b.a), refOf(b.b)];
  if (typeof a === "number" && typeof c === "number")
    return (MAP_ANSWERS["pipeline/shapeDiff"] as Reply)(b);
  const [x, y] = [bodyOf(a), bodyOf(c)];
  return { a, b: c, diff: diffShapes(x, y), bodies: [x, y] };
};

const logged =
  (path: string, answer: Reply): Reply =>
  (b) => {
    MAP_CALLS.push({ path, body: b });
    return answer(b);
  };

const rowOf = (id: unknown) => DRAFTS.find((r) => r.id === id) ?? PROPOSED;

/** The routes of drafts, tags, blame and undo. */
export const DRAFT_ANSWERS: Answers = {
  "pipeline/shapeDiff": shapeDiff,
  "pipeline/shapeBlame": blame,
  "pipeline/shapeUndoPreview": undoPreview,
  "pipeline/shapeUndo": logged("shapeUndo", () => ({ version: 3 })),
  "pipeline/shapeTag": logged("shapeTag", (b) => ({
    name: String(b.name),
    version: Number(b.version),
  })),
  "pipeline/shapeDraftNew": logged("shapeDraftNew", (b) => ({
    id: SAVED.id,
    base: Number(b.base ?? 2),
  })),
  "pipeline/shapeDraftUpdate": logged("shapeDraftUpdate", (b) => ({
    id: String(b.id),
    updatedAt: ago(0),
  })),
  "pipeline/shapeDraftPropose": logged("shapeDraftPropose", (b) => ({
    ...rowOf(b.id),
    state: "proposed",
  })),
  "pipeline/shapeDraftApply": logged("shapeDraftApply", (b) => ({ id: String(b.id), version: 3 })),
  "pipeline/shapeDraftDrop": logged("shapeDraftDrop", (b) => ({
    ...rowOf(b.id),
    state: "dropped",
  })),
};
