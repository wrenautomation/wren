/**
 * The layout lab's engines. A placer gives each station a point; `finishMetro` makes the scene
 * (tracks, names, chips, rails). Any placer can give x and any other y. Then `snap` levels stations
 * that are nearly level, and `even` puts one even step inside each column, like the hand maps.
 */
import type { ElkNode } from "elkjs/lib/elk-api.js";
import { elkOf } from "../../graph/layout.js";
import { RADIUS, textWidth } from "../geometry.js";
import { finishMetro, layoutMetro, type Placement } from "../layout.js";
import { isMark, type MetroScene, type Point, type Zone } from "../types.js";
import { DEFAULT_COLUMNS, type MetroView, type ViewStation } from "../view.js";

export type Finish = "none" | "snap";

export interface Engine {
  id: string;
  name: string;
  /** What it does, in one line. */
  note: string;
  run: (view: MetroView) => Promise<MetroScene>;
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

/** Stations within `gap` px in y take one y: the mean of their run. */
function snapY(pos: Map<string, Point>, gap = 28) {
  const ids = [...pos.keys()].sort((a, b) => (pos.get(a) as Point)[1] - (pos.get(b) as Point)[1]);
  let run: string[] = [];
  const flush = () => {
    const y = Math.round(run.reduce((t, k) => t + (pos.get(k) as Point)[1], 0) / run.length);
    for (const k of run) pos.set(k, [(pos.get(k) as Point)[0], y]);
    run = [];
  };
  for (const k of ids) {
    const last = run[run.length - 1];
    if (last && (pos.get(k) as Point)[1] - (pos.get(last) as Point)[1] > gap) flush();
    run.push(k);
  }
  if (run.length) flush();
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
          sources: [t.from],
          targets: [t.to],
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

/** Today's layout, read back as points. */
const currentPlace = async (v: MetroView) =>
  new Map(
    layoutMetro(v)
      .st.filter(isMark)
      .map((s) => [s.id, [s.x, s.y] as Point]),
  );

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

export type Source = "current" | "elk-bk" | "elk-ns";
export const SOURCES: Source[] = ["current", "elk-bk", "elk-ns"];
const placeBy: Record<Source, (v: MetroView) => Promise<Map<string, Point>>> = {
  current: currentPlace,
  "elk-bk": (v) => elkPlace(v, "BRANDES_KOEPF"),
  "elk-ns": (v) => elkPlace(v, "NETWORK_SIMPLEX"),
};

export interface Mix {
  /** Where the left-to-right order and spacing come from. */
  x: Source;
  /** Where the up-down places come from. */
  y: Source;
  /** One even step in each column, like the hand maps. */
  even: boolean;
  /** Level near-level stations. */
  finish: Finish;
}

export const mixId = (m: Mix) =>
  `x:${m.x}${m.even ? "+even" : ""} y:${m.y}${m.finish === "none" ? "" : `+${m.finish}`}`;

const SOURCE_NAME: Record<Source, string> = {
  current: "today",
  "elk-bk": "ELK BK",
  "elk-ns": "ELK NS",
};

/** "x ELK BK, even · y today": what each axis came from. */
export const mixName = (m: Mix) =>
  `x ${m.x === "current" ? "today" : "ELK"}${m.even ? ", even" : ""} · y ${SOURCE_NAME[m.y]}${m.finish === "snap" ? ", snapped" : ""}`;

/** Any mix of a placer for x and one for y, then the finisher. */
export async function runMix(view: MetroView, m: Mix): Promise<MetroScene> {
  const [px, py] = await Promise.all([placeBy[m.x](view), m.y === m.x ? null : placeBy[m.y](view)]);
  const pos = new Map<string, Point>();
  for (const [k, p] of px) pos.set(k, [p[0], (py ? (py.get(k) ?? p) : p)[1]]);
  if (m.finish === "snap") snapY(pos);
  if (m.even) evenX(view, pos);
  return finishMetro(view, normalise(view, pos));
}

/** Both ELK modes give the same x (the layers); they differ in y. Snap leaves today's rows as they are. */
export const MIXES: Mix[] = (["current", "elk-bk"] as const).flatMap((x) =>
  SOURCES.flatMap((y) =>
    (x === "current" ? [false] : [false, true]).flatMap((even) =>
      (y === "current" ? (["none"] as const) : (["none", "snap"] as const)).map((finish) => ({
        x,
        y,
        even,
        finish,
      })),
    ),
  ),
);

export const ENGINES: Engine[] = [
  {
    id: "current",
    name: "Today (layoutMetro, whole)",
    note: "today's layoutMetro, whole",
    run: async (v) => layoutMetro(v),
  },
  ...MIXES.map((m) => ({
    id: mixId(m),
    name: mixName(m),
    note: "",
    run: (v: MetroView) => runMix(v, m),
  })),
];
