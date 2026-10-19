/**
 * The Journeys board's reads and writes (`../../modules/deals/board.tsx`): one synthetic shape.
 * Two sources feed Engaged, then Booked, then Signed (an offer node). Open journeys sit at the
 * first two nodes, two are done, and one is a ghost on an older version whose node is gone.
 * Synthetic data only.
 * `JOURNEY_CALLS` keeps what the board sent, so a story can check the move.
 */
import type { Row } from "@wren/core/records/serve";
import type { ShapeBody } from "@wren/pipeline/model";
import type { Answers } from "../api.js";
import { ago } from "./shell.js";

/** The writes the board sent since the last `forgetCalls()`, in order. */
export const JOURNEY_CALLS: { path: string; body: Record<string, unknown> }[] = [];
export const forgetCalls = () => JOURNEY_CALLS.splice(0);

/** The newest version of the synthetic shape. */
export const SHAPE: ShapeBody = {
  name: "Sample shape",
  nodes: [
    { id: "mail", kind: "source", name: "Spring list", via: "outbound", channel: "email" },
    { id: "ads1", kind: "source", name: "Winter ads", via: "ads", channel: "ads" },
    {
      id: "engaged",
      kind: "step",
      name: "Engaged",
      action: "reply",
      advance: [{ trigger: "trigger.reply" }],
    },
    {
      id: "booked",
      kind: "step",
      name: "Booked",
      action: "book",
      advance: [{ trigger: "trigger.booking" }],
    },
    { id: "signed", kind: "offer", name: "Signed", offer: "starter", advance: [] },
  ],
  edges: [
    { id: "mail_to_engaged", from: "mail", to: "engaged", kind: "flow" },
    { id: "ads1_to_engaged", from: "ads1", to: "engaged", kind: "flow" },
    { id: "engaged_to_booked", from: "engaged", to: "booked", kind: "flow" },
    { id: "booked_to_signed", from: "booked", to: "signed", kind: "flow" },
  ],
};
const DEPTHS: Record<string, number> = { mail: 0, ads1: 0, engaged: 1, booked: 2, signed: 3 };

const NAMES: Record<string, string> = {
  engaged: "Engaged",
  booked: "Booked",
  signed: "Signed",
  joined: "Joined",
};

const journey = (
  id: string,
  name: string,
  node: string,
  days: number,
  more: Partial<Row> = {},
): Row => ({
  id,
  name,
  profile: Number(id.slice(1)),
  node,
  nodeName: NAMES[node] ?? node,
  trail: "",
  status: "open",
  flag: days >= 14 ? "stale" : null,
  ghost: null,
  entry: "mail",
  email: `${name.split(" ")[0]?.toLowerCase()}@example.test`,
  owner: null,
  daysAtNode: days,
  version: 2,
  reason: null,
  openedAt: ago(days + 5),
  movedAt: ago(days),
  closedAt: null,
  ...more,
});

/** The rows `recordsList` answers for `pipeline.shape` and `pipeline.journey`. */
export const JOURNEY_ROWS: Record<string, Row[]> = {
  "pipeline.shape": [
    {
      id: "shape",
      name: SHAPE.name,
      version: 2,
      nodes: SHAPE.nodes.length,
      edges: SHAPE.edges.length,
      openJourneys: 5,
      why: "Dropped the Joined node.",
      changedAt: ago(9),
      changedBy: "Ada North",
    },
  ],
  "pipeline.journey": [
    journey("j1", "Ada North", "engaged", 2),
    journey("j2", "Bo Fenwick", "engaged", 17, { entry: "ads1" }),
    journey("j3", "Cai Moreno", "booked", 0, { owner: "Ada North" }),
    journey("j4", "Dee Okafor", "booked", 5),
    journey("j5", "Eli Brandt", "signed", 3, { status: "done", closedAt: ago(3) }),
    journey("j6", "Fay Lin", "signed", 9, { status: "done", closedAt: ago(9) }),
    journey("j7", "Gus Held", "joined", 1, { version: 1, ghost: "ghost" }),
  ],
};

/** A record's `detail` for `recordsGet`: the shape's newest body, depths and versions. */
export const JOURNEY_DETAIL: Record<string, (row: Row) => object> = {
  "pipeline.shape": () => ({
    body: SHAPE,
    depths: DEPTHS,
    versions: [
      { number: 2, parent: 1, note: "Dropped the Joined node.", at: ago(9), by: "Ada North" },
      { number: 1, parent: null, note: "First shape.", at: ago(40), by: "Ada North" },
    ],
  }),
};

/** The board's two writes. They answer as the server does when a move lands. */
export const JOURNEY_WRITES: Answers = {
  "pipeline/journeysMove": (b) => {
    JOURNEY_CALLS.push({ path: "journeysMove", body: b });
    return { journey: b.journey, to: b.to, status: "open" };
  },
  "pipeline/journeysDrop": (b) => {
    JOURNEY_CALLS.push({ path: "journeysDrop", body: b });
    return { journey: b.journey, node: "engaged" };
  },
};
