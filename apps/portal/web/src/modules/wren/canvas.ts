/**
 * A drawn workflow as the graph kit's nodes and wires, with its live numbers: each node's count
 * over the last 30 days and today, each wire's count and its rate from what came into the node it
 * leaves. A wire without a count of its own counts its arrivals on the spine. A workflow card
 * with no count of its own shows its inside's first number, and the furthest one with any. Real events become dots
 * on their wires. Pure, so it's tested without a browser.
 */
import {
  type BarsRow,
  type GraphDot,
  type GraphEdge,
  type GraphMark,
  type GraphNode,
  type GraphRole,
  type GraphTone,
  percent,
} from "@wren/ui";
import { type CountRef, countKey, type Drawn } from "../marketplace/boxes.js";

/** A number over the last 30 days, and today's part of it. */
export interface Count {
  value: number;
  today: number;
}

/** Arrivals at one port on the spine: `spine_events` rows. */
export interface PortRef {
  workflow: string;
  node: string;
  port: string;
}

type DrawnNode = Drawn["nodes"][number];
type DrawnWire = Drawn["wires"][number];

export const portKey = (p: PortRef) => `event:${p.workflow}:${p.node}:${p.port}`;

/** Which box a wire end sits on: a node's id, or the workflow's own `in.x` and `out.x`. */
export const boxOf = (end: string) => {
  const [head = ""] = end.split(".");
  return head === "in" || head === "out" ? end : head;
};

/** Where a wire lands, as the spine records arrivals there. */
export const landing = (workflow: string, to: string): PortRef => {
  const at = to.indexOf(".");
  return { workflow, node: to.slice(0, at), port: to.slice(at + 1) };
};

/** The arrivals a drawing counts: every wire with no count of its own. */
export const portsIn = (w: Drawn): PortRef[] =>
  w.wires.filter((x) => !x.count && boxOf(x.from) !== boxOf(x.to)).map((x) => landing(w.id, x.to));

const wireCount = (
  w: Drawn,
  x: DrawnWire,
  counts: ReadonlyMap<string, Count>,
): Count | undefined =>
  x.count ? counts.get(countKey(x.count)) : counts.get(portKey(landing(w.id, x.to)));

/** A workflow's inside, as numbers: its first counted node or wire and its last. */
export function insideOf(
  w: Drawn,
  counts: ReadonlyMap<string, Count>,
): { label: string; count: Count; ref?: CountRef }[] {
  const nodes = w.nodes.flatMap((n) => {
    const c = n.count ? counts.get(countKey(n.count)) : undefined;
    return n.count && c ? [{ label: n.count.label, count: c, ref: n.count }] : [];
  });
  if (nodes.length) return nodes;
  return w.wires.flatMap((x) => {
    const c = wireCount(w, x, counts);
    return c && boxOf(x.from) !== boxOf(x.to)
      ? [{ label: x.label ?? "", count: c, ...(x.count ? { ref: x.count } : {}) }]
      : [];
  });
}

/** How deep the canvas opens: past it, a card no longer opens. */
export const DEPTH_MAX = 8;

/**
 * The id a card's canvas reads its inside by: a workflow's own id, or, for a part that runs a
 * workflow of steps, the part's (its inside is no record of its own).
 */
export const openedBy = (n: { uses?: string | null; opens?: string | null }): string =>
  (n.uses ?? n.opens) as string;

/**
 * The canvas path one level into `opens`, or null when that would loop: `opens` is already on
 * the path (a workflow inside itself), or the path is `DEPTH_MAX` deep. Play follows it on its
 * own, so a loop here would open forever.
 */
export function deeper(path: readonly string[], opens: string): string[] | null {
  if (path.includes(opens) || path.length >= DEPTH_MAX) return null;
  return [...path, opens];
}

/**
 * The trail read for `path` is this path's, not the one before it: the loader keeps the last
 * answer while the next one loads, and drawing it under the new path opens the old card again.
 */
export const trailIsFor = (
  path: readonly string[],
  trail: readonly ({ asked: string } | null)[] | null,
) => !!trail && trail.length === path.length && trail.at(-1)?.asked === path.at(-1);

export interface Where {
  /** The canvas a card opens into. */
  canvas: (n: DrawnNode) => string | undefined;
  /** The list behind a number. */
  rows: (c: CountRef) => string | undefined;
}

/** What a part does, by its id's area: its tile's color on the canvas. */
export function roleOfPart(uses: string | null | undefined): GraphRole {
  const [area = "", what = ""] = (uses ?? "").split(".");
  if (!uses || uses === "planned" || area === "logic") return "logic";
  if (area === "trigger") return "trigger";
  if (
    /score|triage|draft|planner|sort|answer|study/.test(what) ||
    ["watch", "comments"].includes(area)
  )
    return "ai";
  if (["research", "records", "leads", "signals"].includes(area)) return "data";
  if (["delivery", "books", "billing", "reactivation"].includes(area)) return "deliver";
  return "channel";
}

const portsOf = (ps: readonly { id: string; label: string; kind?: string }[] | undefined) =>
  ps?.length ? ps.map((p) => ({ id: p.id, label: p.label, kind: p.kind })) : undefined;
/** A wire end's port: "node.port" names one; the workflow's own ends have just the one. */
const portAt = (end: string) => {
  const [head = "", port] = end.split(".");
  return head === "in" || head === "out" ? undefined : port;
};

const stateOf = (n: DrawnNode, team: boolean): GraphNode["state"] => {
  const flow = !!n.uses && n.opens === n.uses;
  if (!n.uses) return { label: "Custom step", tone: "neutral" };
  if (n.paused) return { label: n.paused, tone: "warn" };
  if (n.ready === "planned")
    return { label: flow ? "Parts in development" : "In development", tone: "neutral" };
  if (n.ready === "coming")
    return team ? { label: "Runs for Wren", tone: "good" } : { label: "Coming", tone: "neutral" };
  return n.ready === "ready" ? { label: "Ready", tone: "good" } : undefined;
};

/**
 * The kit's nodes and wires for `w`: its inputs and outputs dashed at the ends, a workflow inside
 * stacked and linking to its canvas, a part opening beside it. A wire back into its own node is a
 * line on that node. Two wires between the same cards draw as one, the second's words under the
 * first's.
 */
export function graphOf(
  w: Drawn,
  {
    counts,
    inner = new Map(),
    where,
    team,
    allOut = false,
    marks,
  }: {
    counts: ReadonlyMap<string, Count>;
    /** The drawings of the workflows its cards open into, for their numbers. */
    inner?: ReadonlyMap<string, Drawn>;
    where: Where;
    team: boolean;
    /** Every output, wired or not: something to wire to while editing. */
    allOut?: boolean;
    /** A diff's marks: by node id, and by wire as `from>to` boxes. */
    marks?: { nodes: ReadonlyMap<string, GraphMark>; edges: ReadonlyMap<string, GraphMark> };
  },
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const into = new Map<string, number>();
  const loops = new Map<string, string[]>();
  const edges = new Map<string, GraphEdge>();
  const refs = new Map<string, string>();
  for (const x of w.wires) {
    const from = boxOf(x.from);
    const to = boxOf(x.to);
    const c = wireCount(w, x, counts);
    if (from === to) {
      const what = c ? `${c.value.toLocaleString("en-US")} ${x.label ?? ""}` : (x.label ?? "");
      loops.set(to, [
        ...(loops.get(to) ?? []),
        `Again${x.wait ? ` after ${x.wait}` : ""}: ${what}`,
      ]);
      continue;
    }
    if (c) into.set(to, (into.get(to) ?? 0) + c.value);
    const id = `${from}>${to}`;
    const had = edges.get(id);
    if (!had && x.count) refs.set(id, countKey(x.count));
    const fromPort = portAt(x.from);
    const source = w.nodes.find((n) => n.id === from)?.out?.find((p) => p.id === fromPort);
    const e: GraphEdge = {
      from,
      to,
      fromPort,
      toPort: portAt(x.to),
      kind: source?.kind ?? w.in.find((p) => `in.${p.id}` === from)?.kind,
      label: x.label,
      count: c,
      when: x.when,
      wait: x.wait,
      mark: marks?.edges.get(id),
    };
    edges.set(
      id,
      had
        ? {
            ...had,
            notes: [
              ...(had.notes ?? []),
              [
                c ? `${c.value.toLocaleString("en-US")} ${x.label ?? ""}` : x.label,
                x.when && `if ${x.when}`,
              ]
                .filter(Boolean)
                .join(", "),
            ],
          }
        : e,
    );
  }
  // What came into a card, to rate what leaves it: what its wires carried in, else its own count
  // when that counts something other than the wire does.
  const cameIn = (id: string, wire: string | undefined) => {
    const n = w.nodes.find((m) => m.id === id);
    const own =
      n?.count && countKey(n.count) !== wire ? counts.get(countKey(n.count))?.value : undefined;
    return into.get(id) ?? own;
  };
  for (const [id, e] of edges) {
    const from = cameIn(e.from, refs.get(id));
    if (from && e.count && e.count.value <= from) e.rate = { from, to: e.count.value };
  }

  const end = (id: string, p: { label: string; kind?: string }, side: "in" | "out"): GraphNode => ({
    id,
    kind: "record",
    label: p.label,
    role: side === "in" ? "trigger" : "deliver",
    dashed: true,
    ...(side === "in"
      ? { outs: [{ id: "out", label: p.label, kind: p.kind }] }
      : { ins: [{ id: "in", label: p.label, kind: p.kind }] }),
    facets: { Kind: "End" },
  });
  const nodes = w.nodes.map((n): GraphNode => {
    const own = n.count ? counts.get(countKey(n.count)) : undefined;
    const inside = !own && n.opens ? inner.get(n.opens) : undefined;
    const steps = inside ? insideOf(inside, counts) : [];
    // Big: what comes in first. Under it: the furthest stage that has any, else the last.
    const first = steps[0];
    const rest = steps.slice(1);
    const last = rest.filter((x) => x.count.value > 0).at(-1) ?? rest.at(-1);
    const state = stateOf(n, team);
    const loop = loops.get(n.id) ?? [];
    return {
      id: n.id,
      kind: n.opens ? "workflow" : n.uses ? "part" : "step",
      role: n.opens && n.opens !== n.uses ? "logic" : roleOfPart(n.uses),
      ins: portsOf(n.in),
      outs: portsOf(n.out),
      label: n.name,
      note: n.note ?? undefined,
      state,
      number:
        n.count && own
          ? { value: own.value, today: own.today, label: n.count.label, href: where.rows(n.count) }
          : first
            ? {
                value: first.count.value,
                today: first.count.today,
                label: first.label,
                href: first.ref && where.rows(first.ref),
              }
            : undefined,
      more: last
        ? {
            value: last.count.value,
            today: last.count.today,
            label: last.label,
            href: last.ref && where.rows(last.ref),
          }
        : undefined,
      lines: loop.length ? loop.map((text) => ({ text })) : undefined,
      href: n.opens ? where.canvas(n) : undefined,
      dim: !(n.uses && n.opens === n.uses) && n.ready === "planned",
      stacked: !!n.opens,
      mark: marks?.nodes.get(n.id),
      facets: {
        Kind: n.opens ? "Workflow" : n.uses ? "Part" : "Custom step",
        ...(state ? { State: state.label } : {}),
      },
    };
  });
  const used = new Set([...edges.values()].flatMap((e) => [e.from, e.to]));
  return {
    nodes: [
      ...w.in.map((p) => end(`in.${p.id}`, p, "in")),
      ...nodes,
      ...w.out
        .filter((p) => allOut || used.has(`out.${p.id}`))
        .map((p) => end(`out.${p.id}`, p, "out")),
    ],
    edges: [...edges.values()],
  };
}

/**
 * A workflow's stages as a funnel, in the order it draws them: each with its number and its rate
 * from the stage before. Fewer than two counted stages make no funnel.
 */
export function funnelOf(w: Drawn, counts: ReadonlyMap<string, Count>): BarsRow[] {
  const stages = insideOf(w, counts);
  if (stages.length < 2) return [];
  return stages.map((s, i) => {
    const before = stages[i - 1];
    const rate = before ? percent(s.count.value, before.count.value) : "";
    return {
      label: s.label.charAt(0).toUpperCase() + s.label.slice(1),
      value: s.count.value,
      note: rate ? `${rate} of the stage before` : undefined,
    };
  });
}

/** One spine row, as the console's list gives it. */
export interface EventRow {
  id: string;
  workflow: string;
  node: string;
  port: string;
  state: string;
  at: string;
}

const TONE: Record<string, GraphTone> = { failed: "bad", waiting: "warn", held: "warn" };

/**
 * Each event as a dot on the wire it arrived by in `w`, or a wash on the card whose inside it
 * happened in; an event in neither draws nothing. Failed is red, waiting or held amber.
 */
export function dotsOf(events: readonly EventRow[], w: Drawn): GraphDot[] {
  return events.flatMap((ev): GraphDot[] => {
    const tone = TONE[ev.state] ?? TONE[ev.port] ?? "accent";
    if (ev.workflow === w.id) {
      // A step inside a part ("follow.text1") lights its part's card.
      const [head = ""] = ev.node.split(".");
      if (head !== ev.node && w.nodes.some((n) => n.id === head))
        return [{ id: ev.id, node: head, tone }];
      const to = `${ev.node}.${ev.port}`;
      const wire = w.wires.find((x) => x.to === to && boxOf(x.from) !== boxOf(x.to));
      return wire ? [{ id: ev.id, edge: `${boxOf(wire.from)}>${boxOf(wire.to)}`, tone }] : [];
    }
    const card = w.nodes.find((n) => n.opens === ev.workflow);
    return card ? [{ id: ev.id, node: card.id, tone }] : [];
  });
}
