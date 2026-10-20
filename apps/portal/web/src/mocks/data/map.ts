/**
 * The Map's reads beyond the shared ones (`journeys.ts`, `offers.ts`): the History's difference of
 * two versions, and a bigger shape with a plan and a loop for the stories that need one.
 * Synthetic data only.
 */
import type { Row } from "@wren/core/records/serve";
import { diffShapes } from "@wren/pipeline/diff";
import type { VersionLine } from "@wren/pipeline/history";
import { depthOf, type ShapeBody } from "@wren/pipeline/model";
import { type Answers, refuse } from "../api.js";
import { JOURNEY_ROWS, SHAPE, SHAPE_VERSIONS } from "./journeys.js";
import { NUMBERS } from "./offers.js";
import { ago } from "./shell.js";

/** The first version: Engaged led to a Joined step, which led to Booked. */
export const SHAPE_V1: ShapeBody = {
  name: "Sample shape",
  nodes: [
    ...SHAPE.nodes.filter((n) => n.id !== "signed"),
    { id: "joined", kind: "step", name: "Joined", action: "other", advance: [] },
    { id: "signed", kind: "offer", name: "Signed", offer: "starter", advance: [] },
  ],
  edges: [
    { id: "mail_to_engaged", from: "mail", to: "engaged", kind: "flow" },
    { id: "ads1_to_engaged", from: "ads1", to: "engaged", kind: "flow" },
    { id: "engaged_to_joined", from: "engaged", to: "joined", kind: "flow" },
    { id: "joined_to_booked", from: "joined", to: "booked", kind: "flow" },
    { id: "booked_to_signed", from: "booked", to: "signed", kind: "flow" },
  ],
};

/** What changed from version 1 to 2 (the server's `diffShapes`). */
export const DIFF_1_2 = {
  nodes: { added: [], removed: ["joined"], renamed: [], changed: [] },
  edges: {
    added: ["engaged_to_booked"],
    removed: ["engaged_to_joined", "joined_to_booked"],
    changed: [],
  },
  name: null,
};

/** The newest shape with a plan after the offer, and a loop back from Booked to Engaged. */
export const SHAPE_PLAN: ShapeBody = {
  ...SHAPE,
  nodes: [
    ...SHAPE.nodes,
    { id: "standard", kind: "plan", name: "Standard plan", terms: "standard", advance: [] },
  ],
  edges: [
    ...SHAPE.edges,
    { id: "signed_to_standard", from: "signed", to: "standard", kind: "flow" },
    { id: "booked_to_engaged", from: "booked", to: "engaged", kind: "loop" },
  ],
};

/** The newest shape with a dead-end step after Engaged: a node that can go with its person moved. */
export const SHAPE_SPUR: ShapeBody = {
  ...SHAPE,
  nodes: [
    ...SHAPE.nodes,
    { id: "follow", kind: "step", name: "Follow up", action: "other", advance: [] },
  ],
  edges: [...SHAPE.edges, { id: "engaged_to_follow", from: "engaged", to: "follow", kind: "flow" }],
};

/** An open journey on the spur's Follow up step: one person who must move before it can go. */
export const SPUR_PERSON: Row = {
  ...(JOURNEY_ROWS["pipeline.journey"]?.[0] as Row),
  id: "j8",
  name: "Fay Lin",
  profile: 8,
  node: "follow",
  nodeName: "Follow up",
  email: "fay@example.test",
  daysAtNode: 1,
};

const DEPTHS: Record<string, number> = {
  mail: 0,
  ads1: 0,
  engaged: 1,
  booked: 2,
  signed: 3,
  standard: 4,
};

/** The numbers of the plan and loop nodes the bigger shape adds, per window. */
const PLAN_NUMBERS: Row[] = NUMBERS.filter((r) => r.id.toString().startsWith("signed")).flatMap(
  (r) => [
    {
      ...r,
      id: String(r.id).replace("signed", "standard"),
      node: "standard",
      label: "Standard plan",
      nodeKind: "plan",
      position: 4,
      now: 3,
      scheduled: { amount: 3_000, currency: "CAD" },
      collected: { amount: 1_800, currency: "CAD" },
      deals: 3,
    },
    {
      ...r,
      id: String(r.id).replace("signed", "signed_to_standard"),
      kind: "edge",
      node: "signed_to_standard",
      crossings: 3,
      from: "signed",
      to: "standard",
    },
    {
      ...r,
      id: String(r.id).replace("signed", "booked_to_engaged"),
      kind: "edge",
      node: "booked_to_engaged",
      crossings: 2,
      from: "booked",
      to: "engaged",
    },
  ],
);

type Ask = Record<string, unknown>;
type Pipeline = (b: Ask) => unknown;

/**
 * Answers for a story that wants the bigger shape. They stand in front of the shared `recordsGet`
 * and `recordsList`, which `fallback` answers for every other record.
 */
export function planAnswers(fallback: { get: Pipeline; list: Pipeline }): Answers {
  return {
    "pipeline/recordsGet": (b) =>
      b.record === "pipeline.shape"
        ? {
            record: "pipeline.shape",
            row: { id: "shape" },
            related: [],
            activity: [],
            detail: { body: SHAPE_PLAN, depths: DEPTHS, versions: SHAPE_VERSIONS },
          }
        : fallback.get(b),
    "pipeline/recordsList": (b) => {
      const got = fallback.list(b) as { rows: Row[]; total: number };
      if (b.record !== "pipeline.number") return got;
      const where = (b.where ?? {}) as Record<string, unknown>;
      const extra = PLAN_NUMBERS.filter(
        (r) => r.kind === where.kind && (where.window === undefined || r.window === where.window),
      );
      return { ...got, rows: [...got.rows, ...extra], total: got.total + extra.length };
    },
  };
}

/** What the Map's writes sent since the last `forgetMapCalls()`, in order. */
export const MAP_CALLS: { path: string; body: Record<string, unknown> }[] = [];
export const forgetMapCalls = () => MAP_CALLS.splice(0);

/** A file a person might import: the newest shape with one more step after Engaged. */
export const FILE_SHAPE: ShapeBody = {
  ...SHAPE,
  nodes: [
    ...SHAPE.nodes,
    { id: "replied", kind: "step", name: "Replied", action: "reply", advance: [] },
  ],
  edges: [
    ...SHAPE.edges,
    { id: "engaged_to_replied", from: "engaged", to: "replied", kind: "flow" },
  ],
};
/** The file's text; the preview reads a file with no `nodes:` line as not a shape. */
export const FILE_TEXT = "name: Sample shape\nnodes:\n  - id: mail\n";

const version = (body: ShapeBody, number: number, note: string): VersionLine => ({
  number,
  parent: number > 1 ? number - 1 : null,
  note,
  at: ago(0),
  by: "Ada North",
  nodes: body.nodes.length,
  edges: body.edges.length,
  draft: null,
  tags: [],
  mirror: null,
});

/**
 * The Map's writes, answering as the server does when one lands. The file preview reads `FILE_TEXT`
 * as a shape and anything without a `nodes:` line as not one.
 */
export const MAP_WRITES: Answers = {
  "pipeline/shapeVersion": (b) => {
    MAP_CALLS.push({ path: "shapeVersion", body: b });
    return { version: 3 };
  },
  "pipeline/shapeImport": (b) => {
    MAP_CALLS.push({ path: "shapeImport", body: b });
    return { version: 3 };
  },
  "pipeline/shapeStart": (b) => {
    MAP_CALLS.push({ path: "shapeStart", body: b });
    return { version: 1 };
  },
  "pipeline/shapeExport": (b) => {
    MAP_CALLS.push({ path: "shapeExport", body: b });
    return { text: `name: ${String((b.body as ShapeBody | undefined)?.name ?? "")}\nnodes: []\n` };
  },
  "pipeline/shapePreview": (b) => {
    const text = String(b.text ?? "");
    if (!text.includes("nodes:")) return refuse(400, "The file is not a shape file.");
    return {
      a: 2,
      diff: diffShapes(SHAPE, FILE_SHAPE),
      bodies: [SHAPE, FILE_SHAPE],
      note: null,
      moves: null,
    };
  },
};

/** The History's difference of two versions: version 1 and 2 only. */
export const MAP_ANSWERS: Answers = {
  ...MAP_WRITES,
  "pipeline/shapeDiff": (b) => {
    const [a, c] = [Number(b.a), Number(b.b)];
    const same = a === c;
    return {
      a,
      b: c,
      diff: same
        ? {
            nodes: { added: [], removed: [], renamed: [], changed: [] },
            edges: { added: [], removed: [], changed: [] },
            name: null,
          }
        : DIFF_1_2,
      bodies: [SHAPE_V1, SHAPE],
    };
  },
};

/**
 * A shape that changes as the story saves it: `shapeVersion`, `shapeImport` and `shapeStart` write
 * the newest version, and the next read gives it back. `from` is the shape it starts with (null:
 * none yet). They stand in front of the shared `recordsGet`, which `fallback` answers for the rest.
 */
export function liveShape(
  fallback: { get: Pipeline; list?: Pipeline },
  from: ShapeBody | null = SHAPE,
  /** Open journeys beyond the shared ones (rows of `pipeline.journey`). */
  more: readonly Row[] = [],
): Answers {
  let body = from;
  let versions: VersionLine[] = from ? [...SHAPE_VERSIONS] : [];
  const save = (path: string, next: ShapeBody, note: string, b: Ask) => {
    MAP_CALLS.push({ path, body: b });
    const n = (versions[0]?.number ?? 0) + 1;
    body = next;
    versions = [version(next, n, note), ...versions];
    return { version: n };
  };
  return {
    ...MAP_WRITES,
    "pipeline/recordsList": (b) => {
      const got = (fallback.list?.(b) ?? { rows: [], total: 0 }) as { rows: Row[]; total: number };
      const where = (b.where ?? {}) as Record<string, unknown>;
      if (b.record !== "pipeline.journey" || where.status !== "open" || !more.length) return got;
      return { ...got, rows: [...got.rows, ...more], total: got.total + more.length };
    },
    "pipeline/recordsGet": (b) =>
      b.record !== "pipeline.shape"
        ? fallback.get(b)
        : body
          ? {
              record: "pipeline.shape",
              row: { id: "shape" },
              related: [],
              activity: [],
              detail: { body, depths: depthOf(body), versions },
            }
          : { record: "pipeline.shape", row: null, detail: null },
    "pipeline/shapeVersion": (b) => save("shapeVersion", b.body as ShapeBody, String(b.note), b),
    "pipeline/shapeImport": (b) => save("shapeImport", FILE_SHAPE, String(b.note), b),
    "pipeline/shapeStart": (b) => save("shapeStart", SHAPE, "Starter", b),
    "pipeline/shapeDiff": (b) => {
      const [a, c] = [Number(b.a), Number(b.b)];
      const at = (n: number) => (n === 1 ? SHAPE_V1 : n === 2 ? SHAPE : (body ?? SHAPE));
      return { a, b: c, diff: diffShapes(at(a), at(c)), bodies: [at(a), at(c)] };
    },
  };
}
