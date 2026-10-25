/**
 * The map's layout (designs/2026-10-23-metro-fold-tree.md): ELK layered with Brandes-Köpf
 * placement, the view's columns as partitions. x comes from ELK's layers, one even step apart like
 * the hand maps; y is ELK's. A back track (a loop) goes to ELK turned round, so the loop's ends stay
 * near. Each open node of the fold tree is a box: ELK keeps its stations together, and the map draws
 * a frame round them. `finishMetro` makes the scene (tracks, names, chips, rails).
 */
import type { ElkNode } from "elkjs/lib/elk-api.js";
import { elkOf } from "../graph/layout.js";
import { RADIUS, textWidth } from "./geometry.js";
import { finishMetro, type Placement, SPACE, tryMetro } from "./layout.js";
import type { MetroScene, Point, Zone } from "./types.js";
import { DEFAULT_COLUMNS, type MetroView, type ViewStation } from "./view.js";

/** An open node: the stations right inside it, and the open node it sits in. */
export interface PlaceBox {
  id: string;
  parent?: string | undefined;
  stations: readonly string[];
}

/** A box's frame: left, top, right, bottom. */
export type Frame = [number, number, number, number];

/** The px between two x slots: the map's width. */
export const STEP = 120;

/** A frame's room round its stations; the top keeps room for its tab. */
const PAD = { side: 14, top: 34 } as const;

/** The room a station takes: its marker, its name and sub above and below, a chip under it. */
export function sizeOf(s: ViewStation): { width: number; height: number } {
  const r = s.kind === "hub" ? RADIUS.hub : 10;
  const text = Math.max(
    s.label ? textWidth(s.label) : 0,
    s.sub ? textWidth(s.was ? `${s.was} ${s.sub}` : s.sub, 12) : 0,
  );
  const words = (s.label ? 22 : 0) + (s.sub ? 15 : 0) + (s.repeat ? 26 : 0);
  return { width: Math.max(2 * r + 8, text + 8), height: 2 * r + 2 * words };
}

const columnsOf = (view: MetroView) => {
  const columns = [...(view.columns ?? DEFAULT_COLUMNS)];
  for (const s of view.stations) if (!columns.includes(s.column)) columns.push(s.column);
  // A column whose stations all sit in a fold from another column has no zone: the fold holds it.
  const held = new Set(view.stations.flatMap((s) => s.spans ?? []));
  return columns.filter((c) => !held.has(c) || view.stations.some((s) => s.column === c));
};

/** Zones from where each column's stations landed, split halfway between neighbours. */
function zonesOf(view: MetroView, pos: ReadonlyMap<string, Point>, pad = 60): Zone[] {
  const columns = columnsOf(view);
  const span = columns.map((c) => {
    const xs = view.stations
      .filter((s) => s.column === c && pos.has(s.id))
      .map((s) => (pos.get(s.id) as Point)[0]);
    return xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
  });
  // An empty column takes one step after the last one.
  let at = 0;
  const filled = span.map((s) => {
    const v: [number, number] = s ? [s[0] as number, s[1] as number] : [at + STEP, at + STEP];
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

/** One even step inside each column, in ELK's order; columns follow each other. */
function evenX(
  view: MetroView,
  pos: Map<string, Point>,
  stepOf: (column: string) => number,
  merge = 24,
) {
  let start = 0;
  for (const c of columnsOf(view)) {
    const step = stepOf(c);
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

async function elkPlace(view: MetroView, boxes: readonly PlaceBox[]): Promise<Map<string, Point>> {
  const columns = columnsOf(view);
  const byId = new Map(view.stations.map((s) => [s.id, s]));
  const partition = (column: string) => ({
    "elk.partitioning.partition": String(Math.max(0, columns.indexOf(column))),
  });
  // An exit hangs under its source (finishMetro puts it there), so ELK leaves it out and keeps
  // room under the source. ELK drops a node's own margins, so the source is taller instead: as
  // much above as below, so its circle stays at the centre and its rows stay straight.
  const exitOf = new Map<string, string>();
  for (const t of view.tracks)
    if (byId.get(t.to)?.kind === "exit" && byId.has(t.from) && !exitOf.has(t.to))
      exitOf.set(t.to, t.from);
  const sources = new Set(exitOf.values());
  const leaf = (s: ViewStation, top: boolean): ElkNode => {
    const { width, height } = sizeOf(s);
    const room = sources.has(s.id) ? Math.max(0, SPACE.exit + 2 * RADIUS.exit - height / 2) : 0;
    return {
      id: s.id,
      width,
      height: height + 2 * room,
      layoutOptions: {
        // A layer lines up its circles, whatever each label's width (ELK aligns an edge otherwise).
        "elk.alignment": "CENTER",
        ...(top ? partition(s.column) : {}),
      },
    };
  };
  // A box holds its stations and the boxes inside it. Only the outermost take a column.
  const inBox = new Set(boxes.flatMap((b) => b.stations));
  const kids = (parent: string | undefined) => boxes.filter((b) => b.parent === parent);
  const firstOf = (b: PlaceBox): ViewStation | undefined =>
    byId.get(b.stations[0] ?? "") ?? kids(b.id).map(firstOf).find(Boolean);
  const box = (b: PlaceBox, top: boolean): ElkNode => {
    const first = firstOf(b);
    return {
      id: `box:${b.id}`,
      layoutOptions: {
        "elk.padding": `[top=${PAD.top},left=${PAD.side},bottom=${PAD.side},right=${PAD.side}]`,
        ...(top && first ? partition(first.column) : {}),
      },
      children: [
        ...b.stations.flatMap((id) => {
          const s = byId.get(id);
          return s && !exitOf.has(id) ? [leaf(s, false)] : [];
        }),
        ...kids(b.id).map((k) => box(k, false)),
      ],
    };
  };
  // Boxes take the place of their first station, so the model order (ELK's tie-break) holds.
  const topOf = new Map(
    kids(undefined).map((b) => [firstOf(b)?.id, b] as [string | undefined, PlaceBox]),
  );
  const children = view.stations.flatMap((s): ElkNode[] => {
    const b = topOf.get(s.id);
    if (b) return [box(b, true)];
    return inBox.has(s.id) || exitOf.has(s.id) ? [] : [leaf(s, true)];
  });
  const ids = new Set(view.stations.filter((s) => !exitOf.has(s.id)).map((s) => s.id));
  const order = new Map(view.stations.map((s, i) => [s.id, i]));
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.randomSeed": "1",
      "elk.partitioning.activate": "true",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": "24",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.edgeLabels.placement": "CENTER",
      "elk.layered.edgeLabels.sideSelection": "ALWAYS_UP",
    },
    children,
    // A track back to a station listed earlier runs on a rail under its row (finishMetro), so
    // it leaves the rows to the forward tracks.
    edges: view.tracks
      .filter((t) => ids.has(t.from) && ids.has(t.to))
      .filter(
        (t) => (order.get(t.back ? t.from : t.to) ?? 0) > (order.get(t.back ? t.to : t.from) ?? 0),
      )
      .map((t, i) => {
        const words =
          t.by === "person"
            ? t.owner || t.promise
              ? `${t.owner ?? "?"} · ${t.promise ?? "?"}`
              : undefined
            : t.label;
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
  const walk = (n: ElkNode, ox: number, oy: number) => {
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      if (c.id.startsWith("box:")) walk(c, x, y);
      else pos.set(c.id, [x + (c.width ?? 0) / 2, y + (c.height ?? 0) / 2]);
    }
  };
  walk(out, 0, 0);
  return pos;
}

/** Each box's frame, from where its stations and inner boxes landed. */
function framesOf(
  view: MetroView,
  boxes: readonly PlaceBox[],
  pos: ReadonlyMap<string, Point>,
): Map<string, Frame> {
  const byId = new Map(view.stations.map((s) => [s.id, s]));
  const out = new Map<string, Frame>();
  const frameOf = (b: PlaceBox): Frame | undefined => {
    const known = out.get(b.id);
    if (known) return known;
    const parts: Frame[] = b.stations.flatMap((id): Frame[] => {
      const s = byId.get(id);
      const p = pos.get(id);
      if (!s || !p) return [];
      const { width, height } = sizeOf(s);
      return [[p[0] - width / 2, p[1] - height / 2, p[0] + width / 2, p[1] + height / 2]];
    });
    for (const k of boxes) if (k.parent === b.id) parts.push(...[frameOf(k)].filter(isFrame));
    if (!parts.length) return undefined;
    const f: Frame = [
      Math.min(...parts.map((q) => q[0])) - PAD.side,
      Math.min(...parts.map((q) => q[1])) - PAD.top,
      Math.max(...parts.map((q) => q[2])) + PAD.side,
      Math.max(...parts.map((q) => q[3])) + PAD.side,
    ];
    out.set(b.id, f);
    return f;
  };
  for (const b of boxes) frameOf(b);
  return out;
}

const isFrame = (f: Frame | undefined): f is Frame => !!f;

/** The placed map, and a frame for each box. */
export interface Placed {
  scene: MetroScene;
  frames: Map<string, Frame>;
}

/** How many times the placer widens a gap for a name or a chip before the chips fold to dots. */
const WIDEN = 3;

/**
 * Place a view: ELK's layers one step apart in each column, moved so the map starts at the left
 * edge with room on top for the zone names, then made into a scene. Where a name or a chip finds
 * no room, the columns under it take a half step more and the scene is made again; after `WIDEN`
 * tries, chips fold to dots.
 */
export async function placeMetro(
  view: MetroView,
  o: { boxes?: readonly PlaceBox[]; step?: number } = {},
): Promise<Placed> {
  const boxes = o.boxes ?? [];
  const step = o.step ?? STEP;
  const elk = await elkPlace(view, boxes);
  const steps = new Map<string, number>();
  for (let i = 0; ; i++) {
    const pos = new Map(elk);
    evenX(view, pos, (c) => steps.get(c) ?? step);
    const frames0 = framesOf(view, boxes, pos);
    const zones0 = zonesOf(view, pos);
    const tops = [...pos.values()].map((p) => p[1]).concat([...frames0.values()].map((f) => f[1]));
    const dx = -(zones0[0]?.[0] ?? 0);
    const dy = 90 - Math.min(...tops);
    const moved = new Map([...pos].map(([k, [x, y]]) => [k, [x + dx, y + dy] as Point]));
    const frames = new Map(
      [...frames0].map(([k, f]) => [k, [f[0] + dx, f[1] + dy, f[2] + dx, f[3] + dy] as Frame]),
    );
    const bottom = Math.max(
      ...[...moved.values()].map((p) => p[1] + 40),
      ...[...frames.values()].map((f) => f[3] + 16),
    );
    const at: Placement = { pos: moved, zones: zonesOf(view, moved), bottom };
    if (i === WIDEN) return { scene: finishMetro(view, at), frames };
    const tried = tryMetro(view, at);
    if (!tried.bad.length) return { scene: tried.scene, frames };
    // The columns a bad span touches widen. A span with no width (a name) widens its own column.
    for (const [x0, x1, c] of at.zones)
      if (tried.bad.some(([a, b]) => a < x1 && b >= x0))
        steps.set(c, (steps.get(c) ?? step) + step / 2);
  }
}

/** The scene of a view with nothing folded. */
export const layoutView = async (view: MetroView, step?: number): Promise<MetroScene> =>
  (await placeMetro(view, step ? { step } : {})).scene;
