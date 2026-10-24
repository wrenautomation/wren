/**
 * The layout lab's engines (designs/2026-10-23-metro-layout-lab.md). A placer gives each station a
 * point; `finishMetro` makes the scene (tracks, names, chips, rails). The ELK engines take ELK's
 * layers as x, one even step apart like the hand maps, so the step sets the width; y comes from ELK
 * or the LP. A back track (a loop) goes to ELK turned round, so the loop's ends stay near. The LP
 * keeps it as a track, which pulls the loop's ends level.
 */
import type { ElkNode } from "elkjs/lib/elk-api.js";
import { elkOf } from "../../graph/layout.js";
import { RADIUS, textWidth } from "../geometry.js";
import { finishMetro, layoutMetro, type Placement } from "../layout.js";
import type { MetroScene, Point, Zone } from "../types.js";
import { DEFAULT_COLUMNS, type MetroView, type ViewStation } from "../view.js";
import { lpY } from "./lp.js";

export interface Engine {
  id: string;
  name: string;
  /** What it does, in one line. */
  note: string;
  /** `step`: the px between two x slots, where the engine uses one. */
  run: (view: MetroView, step?: number) => Promise<MetroScene>;
}

/** The room a station takes: its marker, and its name and sub above and below, so the mark is the centre. */
function sizeOf(s: ViewStation): { width: number; height: number } {
  const r = s.kind === "hub" ? RADIUS.hub : 10;
  const text = Math.max(s.label ? textWidth(s.label) : 0, s.sub ? textWidth(s.sub, 12) : 0);
  const words = (s.label ? 22 : 0) + (s.sub ? 15 : 0);
  return { width: Math.max(2 * r + 8, text + 8), height: 2 * r + 2 * words };
}

/** Zones from where each column's stations landed, split halfway between neighbours. */
function zonesOf(view: MetroView, pos: ReadonlyMap<string, Point>, pad = 60): Zone[] {
  const columns = view.columns ?? DEFAULT_COLUMNS;
  const span = columns.map((c) => {
    const xs = view.stations
      .filter((s) => s.column === c && pos.has(s.id))
      .map((s) => (pos.get(s.id) as Point)[0]);
    return xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
  });
  // An empty column takes one step after the last one.
  let at = 0;
  const filled = span.map((s) => {
    const v: [number, number] = s ? [s[0] as number, s[1] as number] : [at + 120, at + 120];
    at = v[1];
    return v;
  });
  return columns.map((c, i) => {
    const prev = filled[i - 1];
    const next = filled[i + 1];
    const cur = filled[i] as [number, number];
    const x0 = prev ? (prev[1] + cur[0]) / 2 : cur[0] - pad;
    const x1 = next ? (cur[1] + next[0]) / 2 : cur[1] + pad;
    return [x0, x1, c];
  });
}

/** Moved so the map starts at the left edge with room on top for the zone names. */
function normalise(view: MetroView, pos: Map<string, Point>): Placement {
  const zones0 = zonesOf(view, pos);
  const dx = -(zones0[0]?.[0] ?? 0);
  const ys = [...pos.values()].map((p) => p[1]);
  const dy = 90 - Math.min(...ys);
  const moved = new Map([...pos].map(([k, [x, y]]) => [k, [x + dx, y + dy] as Point]));
  const zones = zonesOf(view, moved);
  return { pos: moved, zones, bottom: Math.max(...[...moved.values()].map((p) => p[1])) + 40 };
}

async function elkPlace(
  view: MetroView,
  placement: "BRANDES_KOEPF" | "NETWORK_SIMPLEX",
): Promise<Map<string, Point>> {
  const columns = view.columns ?? DEFAULT_COLUMNS;
  const ids = new Set(view.stations.map((s) => s.id));
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.randomSeed": "1",
      "elk.partitioning.activate": "true",
      "elk.spacing.nodeNode": "24",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.nodePlacement.strategy": placement,
      ...(placement === "BRANDES_KOEPF"
        ? { "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED" }
        : {}),
      "elk.edgeLabels.placement": "CENTER",
      "elk.layered.edgeLabels.sideSelection": "ALWAYS_UP",
    },
    children: view.stations.map((s) => ({
      id: s.id,
      ...sizeOf(s),
      layoutOptions: {
        "elk.partitioning.partition": String(Math.max(0, columns.indexOf(s.column))),
      },
    })),
    edges: view.tracks
      .filter((t) => t.from !== t.to && ids.has(t.from) && ids.has(t.to))
      .map((t, i) => {
        const words = t.by === "person" ? `${t.owner ?? ""} · ${t.promise ?? ""}` : t.label;
        return {
          id: `e${i}`,
          sources: [t.back ? t.to : t.from],
          targets: [t.back ? t.from : t.to],
          ...(words
            ? {
                labels: [
                  { id: `e${i}:w`, width: textWidth(words, 12) + 18, height: 22, text: "words" },
                ],
              }
            : {}),
        };
      }),
  };
  const out = await (await elkOf()).layout(graph);
  const pos = new Map<string, Point>();
  for (const c of out.children ?? [])
    pos.set(c.id, [(c.x ?? 0) + (c.width ?? 0) / 2, (c.y ?? 0) + (c.height ?? 0) / 2]);
  return pos;
}

/** One even step inside each column, in the placer's order; columns follow each other. */
function evenX(view: MetroView, pos: Map<string, Point>, step = 120, merge = 24) {
  const columns = view.columns ?? DEFAULT_COLUMNS;
  let start = 0;
  for (const c of columns) {
    const ids = view.stations.filter((s) => s.column === c && pos.has(s.id)).map((s) => s.id);
    const xs = [...new Set(ids.map((k) => (pos.get(k) as Point)[0]))].sort((a, b) => a - b);
    // Stations within `merge` px share a slot.
    const slots: number[] = [];
    for (const x of xs)
      if (!slots.length || x - (slots[slots.length - 1] as number) > merge) slots.push(x);
    const slotOf = (x: number) =>
      slots.reduce(
        (best, s, i) => (Math.abs(s - x) < Math.abs((slots[best] as number) - x) ? i : best),
        0,
      );
    for (const k of ids) {
      const [x, y] = pos.get(k) as Point;
      pos.set(k, [start + (slotOf(x) + 0.5) * step, y]);
    }
    start += Math.max(1, slots.length) * step;
  }
}

/** ELK's order, then the LP's y: each even x slot keeps ELK's top-to-bottom order. */
async function elkLpPlace(view: MetroView, step: number): Promise<Map<string, Point>> {
  const elk = await elkPlace(view, "BRANDES_KOEPF");
  const even = new Map(elk);
  evenX(view, even, step);
  const xs = [...new Set([...even.values()].map(([x]) => x))].sort((a, b) => a - b);
  const slot = new Map([...even].map(([k, [x]]) => [k, xs.indexOf(x)]));
  const size = new Map(view.stations.map((s) => [s.id, sizeOf(s).height]));
  return lpY(view, elk, slot, (k) => size.get(k) ?? 0);
}

/** A placer: a point for each station of a view. */
export type Placer = (v: MetroView) => Promise<Map<string, Point>>;

/** The step between two x slots, in px: the map's width. */
export const STEPS = [90, 105, 120, 150] as const;
export const DEFAULT_STEP = 120;

/** ELK's layers, one even step apart, then a placer's y. */
async function elkEven(view: MetroView, y: Placer, step: number): Promise<MetroScene> {
  const [elk, py] = await Promise.all([elkPlace(view, "BRANDES_KOEPF"), y(view)]);
  const pos = new Map([...elk].map(([k, p]) => [k, [p[0], (py.get(k) ?? p)[1]] as Point]));
  evenX(view, pos, step);
  return finishMetro(view, normalise(view, pos));
}

/** Today's layout, ELK with its own y, and ELK with the LP's y. The step sets the width of the two ELK ones. */
export const ENGINES: Engine[] = [
  {
    id: "current",
    name: "Today",
    note: "today's layoutMetro; it keeps its own widths",
    run: async (v) => layoutMetro(v),
  },
  {
    id: "elk-bk",
    name: "ELK BK",
    note: "ELK's layers, even steps, ELK's Brandes-Köpf y",
    run: (v, step = DEFAULT_STEP) => elkEven(v, (w) => elkPlace(w, "BRANDES_KOEPF"), step),
  },
  {
    id: "elk-lp",
    name: "ELK + LP",
    note: "ELK's layers, even steps, the LP's y",
    run: (v, step = DEFAULT_STEP) => elkEven(v, (w) => elkLpPlace(w, step), step),
  },
];
