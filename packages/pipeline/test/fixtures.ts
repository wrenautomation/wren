/**
 * Synthetic shapes for the pipeline tests. One place, so no test builds its own copy.
 */
import type { ShapeBody, ShapeCheckContext, ShapeEdge, ShapeNode } from "../src/model.js";

export const TRIGGERS = new Set([
  "trigger.reply",
  "trigger.booking",
  "trigger.document",
  "trigger.touch",
  "trigger.segment",
  "trigger.source",
]);

export const ctx = (over: Partial<ShapeCheckContext> = {}): ShapeCheckContext => ({
  triggers: TRIGGERS,
  group: (id) => (id === "7" ? { active: true } : id === "8" ? { active: false } : undefined),
  source: (id) => (id === "import:12" ? { exists: true } : undefined),
  ...over,
});

/** A flow edge with the default id. */
export const flow = (from: string, to: string, over: Partial<ShapeEdge> = {}): ShapeEdge => ({
  id: `${from}_to_${to}`,
  from,
  to,
  kind: "flow",
  ...over,
});

export const loop = (from: string, to: string): ShapeEdge => flow(from, to, { kind: "loop" });

export const NODES: ShapeNode[] = [
  { id: "yt", kind: "source", name: "YouTube", via: "organic", channel: "youtube" },
  { id: "mail", kind: "source", name: "Email", via: "outbound", channel: "email" },
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
  { id: "proposal", kind: "step", name: "Proposal", action: "proposal", advance: [] },
  {
    id: "signed",
    kind: "offer",
    name: "Signed",
    offer: "offer-a",
    advance: [{ trigger: "trigger.document" }],
  },
  { id: "standard", kind: "plan", name: "Standard", terms: "standard", advance: [] },
];

/** Two sources into a four step path, an offer, and a plan under it. */
export const shape = (over: Partial<ShapeBody> = {}): ShapeBody => ({
  name: "Test shape",
  nodes: NODES.map((n) => ({ ...n })),
  edges: [
    flow("yt", "engaged"),
    flow("mail", "engaged"),
    flow("engaged", "booked"),
    flow("booked", "proposal"),
    flow("proposal", "signed"),
    flow("signed", "standard"),
  ],
  ...over,
});

/** A shape with extra nodes and edges added to `shape()`. */
export const grown = (nodes: ShapeNode[], edges: ShapeEdge[]): ShapeBody => {
  const base = shape();
  return { ...base, nodes: [...base.nodes, ...nodes], edges: [...base.edges, ...edges] };
};
