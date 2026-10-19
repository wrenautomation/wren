/**
 * The Map's reads beyond the shared ones (`journeys.ts`, `offers.ts`): the History's difference of
 * two versions, and a bigger shape with a plan and a loop for the stories that need one.
 * Synthetic data only.
 */
import type { Row } from "@wren/core/records/serve";
import type { ShapeBody } from "@wren/pipeline/model";
import type { Answers } from "../api.js";
import { SHAPE } from "./journeys.js";
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

const DEPTHS: Record<string, number> = {
  mail: 0,
  ads1: 0,
  engaged: 1,
  booked: 2,
  signed: 3,
  standard: 4,
};

const VERSIONS = [
  {
    number: 2,
    parent: 1,
    note: "Dropped the Joined node.",
    at: ago(9),
    by: "Ada North",
    nodes: 5,
    edges: 4,
  },
  {
    number: 1,
    parent: null,
    note: "First shape.",
    at: ago(40),
    by: "Ada North",
    nodes: 6,
    edges: 5,
  },
];

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
            detail: { body: SHAPE_PLAN, depths: DEPTHS, versions: VERSIONS },
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

/** The History's difference of two versions: version 1 and 2 only. */
export const MAP_ANSWERS: Answers = {
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
