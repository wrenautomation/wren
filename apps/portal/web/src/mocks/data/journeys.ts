/**
 * The Journeys board's reads and writes (`../../modules/deals/board.tsx`): two funnels. The sales
 * one is live, with open journeys in its first two stages and two finished; the welcome one is
 * off. Synthetic data only.
 * `JOURNEY_CALLS` keeps what the board sent, so a story can check the move.
 */
import type { Row } from "@wren/core/records/serve";
import type { Answers } from "../api.js";
import { ago } from "./shell.js";

/** The writes the board sent since the last `forgetCalls()`, in order. */
export const JOURNEY_CALLS: { path: string; body: Record<string, unknown> }[] = [];
export const forgetCalls = () => JOURNEY_CALLS.splice(0);

const SALES = [
  { key: "engaged", label: "Engaged", sale: false, on: ["trigger.reply"] },
  { key: "booked", label: "Booked", sale: false, on: ["trigger.booking"] },
  { key: "signed", label: "Signed", sale: true, on: ["trigger.document"] },
];
const WELCOME = [
  { key: "joined", label: "Joined", sale: false, on: [] },
  { key: "active", label: "Active", sale: false, on: [] },
];

const funnel = (
  id: string,
  name: string,
  stages: typeof SALES,
  open: number,
  status = "live",
): Row => ({
  id,
  name,
  status,
  version: 2,
  offer: "starter",
  stages: stages.length,
  entries: 1,
  openJourneys: open,
  why: null,
  changedAt: ago(9),
  changedBy: "Ada North",
  createdAt: ago(40),
});

const journey = (
  id: string,
  name: string,
  f: string,
  stage: (typeof SALES)[number],
  days: number,
  more: Partial<Row> = {},
): Row => ({
  id,
  name,
  funnelName: f === "sales" ? "Sales funnel" : "Welcome funnel",
  funnel: f,
  stage: stage.key,
  stageLabel: stage.label,
  status: "open",
  flag: days >= 14 ? "stale" : null,
  entry: "Booked a call",
  email: `${name.split(" ")[0]?.toLowerCase()}@example.test`,
  owner: null,
  daysInStage: days,
  version: 2,
  reason: null,
  openedAt: ago(days + 5),
  movedAt: ago(days),
  closedAt: null,
  ...more,
});

const [ENGAGED, BOOKED, SIGNED] = SALES as [
  (typeof SALES)[0],
  (typeof SALES)[1],
  (typeof SALES)[2],
];
const [JOINED] = WELCOME as [(typeof WELCOME)[0]];

/** The rows `recordsList` answers for `pipeline.funnel` and `pipeline.journey`. */
export const JOURNEY_ROWS: Record<string, Row[]> = {
  "pipeline.funnel": [
    funnel("sales", "Sales funnel", SALES, 4),
    funnel("welcome", "Welcome funnel", WELCOME, 1, "off"),
  ],
  "pipeline.journey": [
    journey("j1", "Ada North", "sales", ENGAGED, 2),
    journey("j2", "Bo Fenwick", "sales", ENGAGED, 17, { entry: "Replied to an email" }),
    journey("j3", "Cai Moreno", "sales", BOOKED, 0, { owner: "Ada North" }),
    journey("j4", "Dee Okafor", "sales", BOOKED, 5),
    journey("j5", "Eli Brandt", "sales", SIGNED, 3, { status: "done", closedAt: ago(3) }),
    journey("j6", "Fay Lin", "sales", SIGNED, 9, { status: "done", closedAt: ago(9) }),
    journey("j7", "Gus Held", "welcome", JOINED, 1),
  ],
};

/** A record's `detail` for `recordsGet`: a funnel's stages. */
export const JOURNEY_DETAIL: Record<string, (row: Row) => object> = {
  "pipeline.funnel": (row) => ({
    stages: row.id === "welcome" ? WELCOME : SALES,
    entries: [{ id: "call", kind: "booking", to: "engaged" }],
  }),
};

/** The board's two writes. They answer as the server does when a move lands. */
export const JOURNEY_WRITES: Answers = {
  "pipeline/journeysMove": (b) => {
    JOURNEY_CALLS.push({ path: "journeysMove", body: b });
    return { journey: b.journey, from: "engaged", to: b.to, status: "open" };
  },
  "pipeline/journeysDrop": (b) => {
    JOURNEY_CALLS.push({ path: "journeysDrop", body: b });
    return { journey: b.journey, stage: "engaged" };
  },
};
