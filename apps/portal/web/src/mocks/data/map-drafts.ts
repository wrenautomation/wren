/**
 * The Map's drafts, blame, tags and undo on the fake server: synthetic drafts of the sample shape
 * (`pipeline.shape_draft`, a record the worker adds with the server half; until then the fake
 * serves it here), and answers for every route the History and the panels call. A draft's detail
 * holds the runtime graph, the stored metro and the draw errors. A difference holds the change
 * lines, both sides drawn and the marks, made by the server's own pure code. Writes log into
 * `MAP_CALLS` and answer as the server does when one lands; the lists do not change.
 * Synthetic data only.
 */
import type { Row } from "@wren/core/records/serve";
import type { BlameLine, DraftRow, ShapeRef } from "@wren/pipeline/history";
import type { MetroBody } from "@wren/pipeline/metro";
import { metroChangeLine, parseMetroChangeKey } from "@wren/pipeline/metro-diff";
import { diffAnswerOf, metroView, type StoredBody } from "@wren/pipeline/stored";
import { type Answers, refuse } from "../api.js";
import { SHAPE_METRO, SHAPE_VERSIONS } from "./journeys.js";
import { diffBetween, MAP_CALLS, SHAPE_PLAN, SHAPE_SPUR, SHAPE_V1, shapeDetail } from "./map.js";
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
export const DRAFTS: DraftRow[] = [PROPOSED, STALE, DROPPED];
const BODIES: Record<string, StoredBody> = {
  d1: SHAPE_PLAN,
  d2: SHAPE_SPUR,
  d3: SHAPE_V1,
};

const inView = (r: DraftRow, view: unknown) =>
  view === "all"
    ? true
    : view === "proposed"
      ? r.state === "proposed"
      : r.state === "draft" || r.state === "proposed";

/** A draft's `detail`: the graph it runs as, its moves, and the metro the map draws. */
const draftDetail = (stored: StoredBody) => {
  const { body, metro, drawErrors } = shapeDetail(stored);
  return { body, moves: {}, metro, drawErrors };
};

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
        detail: draftDetail(BODIES[row.id] ?? SHAPE_METRO),
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

const idsOf = (m: MetroBody, kind: "stations" | "tracks" | "lines") => m[kind].map((x) => x.id);
const KNOWN = {
  station: [SHAPE_METRO, SHAPE_PLAN, SHAPE_SPUR].flatMap((m) => idsOf(m, "stations")),
  track: [SHAPE_METRO, SHAPE_PLAN, SHAPE_SPUR].flatMap((m) => idsOf(m, "tracks")),
  line: [SHAPE_METRO, SHAPE_PLAN, SHAPE_SPUR].flatMap((m) => idsOf(m, "lines")),
};

/** The versions that touched one part. Ids the sample shape does not know get a 400. */
function blame(b: Ask): unknown {
  const station = typeof b.station === "string" ? b.station : null;
  const track = typeof b.track === "string" ? b.track : null;
  const line = typeof b.line === "string" ? b.line : null;
  if (station === "joined")
    return {
      lines: [
        { version: 2, how: "removed", note: SHAPE_VERSIONS[0]?.note ?? "", by, at: ago(9) },
        BLAME_FIRST,
      ] satisfies BlameLine[],
    };
  if (station) {
    if (!KNOWN.station.includes(station))
      return refuse(400, `The shape has no station "${station}".`);
    return { lines: station === "booked" ? [BLAME_NEW, BLAME_FIRST] : [BLAME_FIRST] };
  }
  if (track) {
    if (track === "engaged_to_booked")
      return {
        lines: [
          { version: 2, how: "added", note: "Dropped the Joined station.", by, at: ago(9) },
        ] satisfies BlameLine[],
      };
    if (!KNOWN.track.includes(track)) return refuse(400, `The shape has no track "${track}".`);
    return { lines: [BLAME_FIRST] };
  }
  if (line) {
    if (!KNOWN.line.includes(line)) return refuse(400, `The shape has no line "${line}".`);
    return { lines: [BLAME_NEW, BLAME_FIRST] };
  }
  return refuse(400, "Name a station, a track or a line.");
}

// --- undo --------------------------------------------------------------------------------------

/** The newest shape with Joined back: what undoing "Removed station Joined" would save. */
const WITH_JOINED: MetroBody = {
  ...SHAPE_METRO,
  stations: [
    ...SHAPE_METRO.stations,
    {
      id: "joined",
      label: "Joined",
      kind: "att",
      line: "signed",
      column: "sales",
      action: "other",
    },
  ],
};

/** An undo of a line the newest shape changed again is refused, with the server's reasons. */
export const REFUSED_UNDO = "track:engaged_to_booked:added";

function undoPreview(b: Ask): unknown {
  const key = String(b.change);
  if (key === REFUSED_UNDO)
    return refuse(
      400,
      "Booked changed again in version 3. Undo that change first, or edit the shape by hand.",
    );
  const change = parseMetroChangeKey(key);
  if (!change) return refuse(400, "That line is not in the difference.");
  const line = metroChangeLine(metroView(SHAPE_V1), SHAPE_METRO, change);
  return {
    line,
    note: `Undo: ${line}`,
    newest: 2,
    ...diffAnswerOf(SHAPE_METRO, WITH_JOINED, true),
  };
}

// --- differences against a draft ---------------------------------------------------------------

const bodyAt = (ref: ShapeRef): StoredBody => {
  const s = String(ref);
  if (s.startsWith("draft:")) return BODIES[s.slice("draft:".length)] ?? SHAPE_METRO;
  return Number(s) === 1 ? SHAPE_V1 : SHAPE_METRO;
};

const refOf = (v: unknown): ShapeRef => {
  const s = String(v);
  return s.startsWith("draft:") ? (s as ShapeRef) : Number(s);
};

/** `shapeDiff` with a draft on either side; two versions answer as `MAP_ANSWERS` does. */
const shapeDiff: Reply = (b) => diffBetween(refOf(b.a), refOf(b.b), bodyAt);

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
