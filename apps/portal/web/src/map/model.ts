/**
 * The Map's data and drawing, pure (no reads, so a test imports it alone): the windows, what a read
 * gives, and `graphOf`, which turns it into the graph kit's nodes and wires.
 */
import type { ShapeBody, ShapeNode } from "@wren/pipeline/model";
import { type GraphEdge, type GraphNode, money, num } from "@wren/ui";

export const WINDOWS = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "all", label: "All time" },
] as const;
export type Window = (typeof WINDOWS)[number]["id"];
export const DEFAULT_WINDOW: Window = "30";

/** The window an address names; the default when it names none or one we don't have. */
export const windowOf = (s: string | null): Window =>
  WINDOWS.find((w) => w.id === s)?.id ?? DEFAULT_WINDOW;

/** What a window says in a sentence: "in the last 30 days". */
export const windowSays = (w: Window): string =>
  w === "all" ? "in all time" : `in the last ${w} days`;

export interface Version {
  number: number;
  parent: number | null;
  note: string;
  at: string;
  by: string;
  nodes: number;
  edges: number;
}

export interface Sum {
  amount: number;
  currency: string;
}

/** A node's numbers over the window. Each is null where the node has none (a source's "now"). */
export interface NodeNumbers {
  id: string;
  now: number | null;
  arrived: number | null;
  left: number | null;
  medianDays: number | null;
  opened: number | null;
  deals: number | null;
  collected: Sum | null;
  scheduled: Sum | null;
}

export interface Person {
  /** The journey's id. */
  id: string;
  name: string;
  node: string;
  nodeName: string;
  movedAt: string | null;
  daysAtNode: number;
}

/** A node the newest shape lacks that open journeys still sit on. */
export interface Ghost {
  id: string;
  name: string;
  people: Person[];
}

export interface MapData {
  body: ShapeBody;
  depths: Record<string, number>;
  versions: Version[];
  nodes: Map<string, NodeNumbers>;
  /** People who crossed each edge in the window. */
  edges: Map<string, number>;
  /** Open journeys, newest move first. */
  people: Person[];
  ghosts: Ghost[];
}

/** A node's kind in the graph kit, and the token that tints its tile: plan and offer carry the accent. */
export const LOOK: Record<ShapeNode["kind"], { kind: GraphNode["kind"]; tint: string }> = {
  source: { kind: "part", tint: "var(--ui-cue-2)" },
  step: { kind: "step", tint: "var(--ui-cue-1)" },
  offer: { kind: "record", tint: "var(--ui-active)" },
  plan: { kind: "workflow", tint: "var(--ui-active)" },
};

const cash = (s: Sum | null) => (s ? money(s.amount, s.currency, true) : "none");

/** The lines of a node's hover card: its numbers over the window. */
export function numbersSay(n: ShapeNode["kind"], x: NodeNumbers | undefined): string[] {
  if (!x) return ["No numbers yet."];
  if (n === "source") return [`Opened: ${num(x.opened ?? 0)}`, `Deals: ${num(x.deals ?? 0)}`];
  if (n === "plan")
    return [
      `Now: ${num(x.now ?? 0)}`,
      `Deals: ${num(x.deals ?? 0)}`,
      `Scheduled: ${cash(x.scheduled)}`,
      `Collected: ${cash(x.collected)}`,
    ];
  return [
    `Now: ${num(x.now ?? 0)}`,
    `Arrived: ${num(x.arrived ?? 0)}`,
    `Left: ${num(x.left ?? 0)}`,
    `Median days there: ${x.medianDays == null ? "none" : num(Math.round(x.medianDays * 10) / 10)}`,
  ];
}

/** The graph kit's nodes and wires for the Map: ribbons by crossings, loops thin, ghosts dashed. */
export function graphOf(data: MapData): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = data.body.nodes.map((n) => {
    const x = data.nodes.get(n.id);
    const look = LOOK[n.kind];
    const number =
      n.kind === "plan"
        ? x?.collected
          ? { value: x.collected.amount, label: `${x.collected.currency} collected` }
          : { value: 0, label: "collected" }
        : n.kind === "source"
          ? { value: x?.opened ?? 0, label: "opened" }
          : { value: x?.now ?? 0, label: "now" };
    return {
      id: n.id,
      kind: look.kind,
      tint: look.tint,
      label: n.name,
      number,
      hover: numbersSay(n.kind, x),
      ...(n.kind === "source" && n.parked
        ? { dim: true, state: { label: "Parked", tone: "neutral" as const } }
        : {}),
    };
  });
  for (const g of data.ghosts)
    if (!nodes.some((n) => n.id === g.id))
      nodes.push({
        id: g.id,
        kind: "step",
        tint: LOOK.step.tint,
        label: g.name,
        number: { value: g.people.length, label: "now" },
        hover: [`Now: ${num(g.people.length)}`, "Dropped from the newest version."],
        state: { label: "Ghost", tone: "warn" },
        dashed: true,
      });
  const edges: GraphEdge[] = data.body.edges.map((e) => {
    const n = data.edges.get(e.id) ?? 0;
    return {
      from: e.from,
      to: e.to,
      ...(e.label ? { label: e.label } : {}),
      weight: n,
      count: { value: n },
      ...(e.kind === "loop" ? { loop: true as const } : {}),
    };
  });
  return { nodes, edges };
}
