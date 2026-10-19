/**
 * Graph fixtures: a made-up business shape (people flow from sources through steps to an offer
 * and its plans), for the ribbon stories. Synthetic: no real name or number.
 */
import type { GraphEdge, GraphNode } from "../graph/index.js";
import { WORST } from "./worst.js";

const node = (
  id: string,
  kind: GraphNode["kind"],
  label: string,
  people: number,
  tint: string,
  rest: Partial<GraphNode> = {},
): GraphNode => ({
  id,
  kind,
  label,
  tint,
  number: { value: people, label: "now" },
  ...rest,
});

const SOURCE = "var(--ui-cue-2)";
const STEP = "var(--ui-cue-1)";
const MONEY = "var(--ui-active)";

export const RIBBON_NODES: GraphNode[] = [
  node("posts", "part", "Posts", 1840, SOURCE),
  node("ads", "part", "Ads", 920, SOURCE),
  node("cold", "part", "Cold outreach", 2310, SOURCE),
  node("replied", "step", "Replied", 412, STEP),
  node("booked", "step", "Booked a call", 118, STEP),
  node("proposal", "step", "Proposal sent", 46, STEP),
  node("standard", "record", "Standard offer", 21, MONEY),
  node("monthly", "workflow", "Monthly plan", 14, MONEY, {
    number: { value: 14, label: "paying" },
  }),
];

export const RIBBON_EDGES: GraphEdge[] = [
  { from: "posts", to: "replied", weight: 140, count: { value: 140 } },
  { from: "ads", to: "replied", weight: 90, count: { value: 90 } },
  { from: "cold", to: "replied", weight: 182, count: { value: 182 } },
  { from: "replied", to: "booked", weight: 118, count: { value: 118 } },
  { from: "booked", to: "proposal", weight: 46, count: { value: 46 } },
  { from: "proposal", to: "standard", weight: 21, count: { value: 21 } },
  { from: "standard", to: "monthly", weight: 14, count: { value: 14 } },
];

/** A return to an earlier step: someone who went quiet and came back. */
export const LOOP_EDGES: GraphEdge[] = [
  ...RIBBON_EDGES,
  { from: "proposal", to: "replied", weight: 9, loop: true },
  { from: "booked", to: "replied", weight: 5, loop: true },
];

/** A wide, deep drawing: `n` nodes, huge counts and one long name in every sixth node. */
export function wideGraph(n = 40): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = Array.from({ length: n }, (_, i): GraphNode => {
    const id = `n${i}`;
    return node(
      id,
      i < 4 ? "part" : "step",
      i % 6 === 0 ? WORST.longLabel : `Step ${i}`,
      WORST.hugeCount - i,
      i < 4 ? SOURCE : STEP,
    );
  });
  const edges: GraphEdge[] = [];
  for (let i = 4; i < n; i++) {
    const a = i < 8 ? i - 4 : Math.floor((i - 4) / 2);
    edges.push({ from: `n${a}`, to: `n${i}`, weight: WORST.hugeCount / (i + 1) });
    if (i % 7 === 0) edges.push({ from: `n${i}`, to: `n${a}`, weight: 3, loop: true });
  }
  return { nodes, edges };
}
