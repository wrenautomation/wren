/**
 * The Map's layout (designs/2026-11-12-explorer.md, Map: Draw): one elk `layered` call with
 * INCLUDE_CHILDREN. An open box is a compound node with a title bar; a closed box a card sized by
 * its name and meta line; a line an edge with room for its count. Boxes come back relative to
 * their parent (React Flow's `parentId`), lines in map units from the top left.
 */
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import { textWidth } from "../metro/geometry.js";
import { elkOf } from "./layout.js";
import type { Point } from "./model.js";

/** A box as `mapAt` sends it (core `MapBox`). */
export interface MapBoxIn {
  path: string;
  name: string;
  kind: string;
  /** the open box it sits in; the root for the top */
  parent: string;
  open: boolean;
  count?: number | undefined;
  leaf?: boolean | undefined;
  /** asked open, held closed: too many to draw */
  full?: boolean | undefined;
}
/** A bundle of links between two shown boxes (core `MapLine`). */
export interface MapLineIn {
  id: string;
  from: string;
  to: string;
  count: number;
  rels: Record<string, number>;
}
/** One root's Map (core `PathMap`). */
export interface MapIn {
  root: string;
  boxes: readonly MapBoxIn[];
  lines: readonly MapLineIn[];
  /** links with both ends in one closed box, by box */
  inside: Readonly<Record<string, number>>;
  /** links to another root, by root */
  outside: Readonly<Record<string, number>>;
}

/** Card and frame sizes (px): the layout and the drawing read the same ones. */
const CARD = { w: 200, padX: 12, padY: 10, icon: 22, line: 18, meta: 16 } as const;
const FRAME = { top: 38, side: 14, bottom: 14, least: 120, most: 360, close: 28 } as const;
/** Layered elk puts unlinked siblings in one layer; past this many, spine edges split it. */
const GRID_FROM = 7;
const SPINE = "~spine:";
const NAME_PX = 13;
const META_PX = 12;

/** An open box's title: its width (name, icon, close button) up to `most`, then it wraps. */
export function titleOf(b: MapBoxIn, most: number = FRAME.most): { least: number; top: number } {
  const chrome = 2 * CARD.padX + CARD.icon + FRAME.close + 8;
  const words = `${b.name}${b.count != null ? `  ${b.count.toLocaleString("en-US")}` : ""}`;
  const want = textWidth(words, NAME_PX) + chrome;
  const least = Math.min(most, Math.max(FRAME.least, Math.ceil(want)));
  const lines = linesOf(words, NAME_PX, most - chrome);
  return { least, top: FRAME.top + (lines - 1) * CARD.line };
}

/** The card's second line: how many it holds, links inside, or why it stays closed. */
export function metaOf(b: MapBoxIn, inside: number): string {
  if (b.full) return "Too many to draw: open a smaller folder";
  const parts: string[] = [];
  if (b.count != null && !b.leaf) parts.push(b.count.toLocaleString("en-US"));
  if (inside)
    parts.push(`${inside.toLocaleString("en-US")} ${inside === 1 ? "link" : "links"} inside`);
  return parts.join(" · ");
}

const linesOf = (text: string, px: number, room: number) =>
  text ? Math.max(1, Math.ceil(textWidth(text, px) / room)) : 0;

/** A closed card's height: its whole name wraps, never cut; the meta line wraps too. */
function cardHeight(b: MapBoxIn, inside: number): number {
  const room = CARD.w - 2 * CARD.padX - CARD.icon;
  const name = linesOf(b.name, NAME_PX, room);
  const meta = linesOf(metaOf(b, inside), META_PX, CARD.w - 2 * CARD.padX);
  return 2 * CARD.padY + name * CARD.line + meta * CARD.meta;
}

export interface MapRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** an open box: its title bar's height */
  top?: number;
}
export interface MapLaid {
  width: number;
  height: number;
  /** relative to the open box it sits in */
  boxes: Record<string, MapRect>;
  lines: Record<string, { points: Point[]; label?: Point | undefined }>;
}

const under = (path: string, top: string) => path.startsWith(`${top}/`);

/** How far a reverse twin sits from its line (px): both at their widest (8) plus a gap. */
const TWIN_GAP = 11;

const normalOf = (a: Point, b: Point) => {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
};
/** A route moved `d` to its right on screen (y down), corners kept square; its pill moves with its nearest leg. */
export function offsetOf(
  pts: readonly Point[],
  label: Point | undefined,
  d: number,
): { points: Point[]; label?: Point | undefined } {
  const legs = pts.slice(1).map((p, i) => normalOf(pts[i] as Point, p));
  const points = pts.map((p, i) => {
    const a = legs[i - 1] ?? legs[i];
    const b = legs[i] ?? legs[i - 1];
    if (!a || !b) return { ...p };
    const k = 1 + a.x * b.x + a.y * b.y;
    if (k < 1e-6) return { x: p.x + a.x * d, y: p.y + a.y * d };
    return { x: p.x + (d * (a.x + b.x)) / k, y: p.y + (d * (a.y + b.y)) / k };
  });
  if (!label) return { points };
  let near = 0;
  let best = Number.POSITIVE_INFINITY;
  pts.slice(1).forEach((p, i) => {
    const q = pts[i] as Point;
    const m = Math.hypot((p.x + q.x) / 2 - label.x, (p.y + q.y) / 2 - label.y);
    if (m < best) [best, near] = [m, i];
  });
  const n = legs[near] ?? { x: 0, y: 0 };
  return { points, label: { x: label.x + n.x * d, y: label.y + n.y * d } };
}

/** The count on a line: a pill elk keeps clear. */
export const countText = (n: number) => (n > 1 ? n.toLocaleString("en-US") : "");

export async function layoutMap(map: MapIn, dir: "RIGHT" | "DOWN" = "RIGHT"): Promise<MapLaid> {
  const kids = new Map<string, MapBoxIn[]>();
  for (const b of map.boxes) kids.set(b.parent, [...(kids.get(b.parent) ?? []), b]);
  // big folder: hidden spine edges k(i) → k(i+rows) make each column its own layer; elk's
  // partitions would, but INCLUDE_CHILDREN ignores them
  const spines: ElkExtendedEdge[] = [];
  const spread = (list: readonly MapBoxIn[]) => {
    // down (a phone): a layer is a row, 2 cards wide at most
    if (list.length < (dir === "DOWN" ? 3 : GRID_FROM)) return;
    const per =
      dir === "DOWN"
        ? 2
        : Math.ceil(list.length / Math.max(1, Math.round(Math.sqrt(list.length / 2))));
    list.forEach((b, i) => {
      const next = list[i + per];
      if (next)
        spines.push({ id: `${SPINE}${spines.length}`, sources: [b.path], targets: [next.path] });
    });
  };
  // down (a phone): a frame no wider than one card, so its title wraps instead
  const most = dir === "DOWN" ? CARD.w + 2 * FRAME.side : FRAME.most;
  const tops = new Map<string, number>();
  const nodeOf = (b: MapBoxIn): ElkNode => {
    const inner = kids.get(b.path) ?? [];
    if (b.open && inner.length) {
      const t = titleOf(b, most);
      tops.set(b.path, t.top);
      spread(inner);
      return {
        id: b.path,
        layoutOptions: {
          "elk.padding": `[top=${t.top},left=${FRAME.side},bottom=${FRAME.bottom},right=${FRAME.side}]`,
          "elk.nodeSize.constraints": "MINIMUM_SIZE",
          // elk reads a compound node's minimum in its own turned axes: down swaps them
          "elk.nodeSize.minimum":
            dir === "DOWN"
              ? `(${t.top + FRAME.bottom}, ${t.least})`
              : `(${t.least}, ${t.top + FRAME.bottom})`,
        },
        children: inner.map(nodeOf),
      };
    }
    return { id: b.path, width: CARD.w, height: cardHeight(b, map.inside[b.path] ?? 0) };
  };
  const shown = new Set(map.boxes.map((b) => b.path));
  // a box and its own kid: the frame already holds it, so no line
  const drawn = map.lines.filter(
    (l) => shown.has(l.from) && shown.has(l.to) && !under(l.from, l.to) && !under(l.to, l.from),
  );
  // elk lays every line out in box order, so a link back to an earlier box never loops round
  // the map; its points reverse after, so the arrow keeps the real direction
  const order = new Map(map.boxes.map((b, i) => [b.path, i]));
  const flipped = new Set(
    drawn.filter((l) => (order.get(l.from) ?? 0) > (order.get(l.to) ?? 0)).map((l) => l.id),
  );
  const top = kids.get(map.root) ?? [];
  spread(top);
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": dir,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.randomSeed": "1",
      "elk.json.edgeCoords": "ROOT",
      "elk.spacing.nodeNode": "20",
      "elk.spacing.edgeNode": "14",
      "elk.spacing.edgeEdge": "8",
      // a lit line is up to ~5 px wide: its pill stays clear of it
      "elk.spacing.edgeLabel": "6",
      "elk.spacing.componentComponent": "32",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.layered.spacing.edgeNodeBetweenLayers": "16",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      // near the target end, where merged lines have parted: a pill names one line
      "elk.edgeLabels.placement": "TAIL",
      // lines that share an end leave it at one point and share a trunk: a fan, not a hairball
      "elk.layered.mergeEdges": "true",
      "elk.padding": "[top=0,left=0,bottom=0,right=0]",
    },
    children: top.map(nodeOf),
    edges: [
      ...spines,
      ...drawn.map(
        (l): ElkExtendedEdge => ({
          id: l.id,
          sources: [flipped.has(l.id) ? l.to : l.from],
          targets: [flipped.has(l.id) ? l.from : l.to],
          ...(countText(l.count)
            ? {
                labels: [
                  {
                    id: `${l.id}:n`,
                    width: textWidth(countText(l.count), 11) + 12,
                    height: 18,
                    // elk skips a label with no text
                    text: "n",
                  },
                ],
              }
            : {}),
        }),
      ),
    ],
  };
  const out = await (await elkOf()).layout(graph);
  const laid: MapLaid = { width: out.width ?? 0, height: out.height ?? 0, boxes: {}, lines: {} };
  const walk = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      const top = tops.get(c.id);
      laid.boxes[c.id] = {
        x: c.x ?? 0,
        y: c.y ?? 0,
        width: c.width ?? 0,
        height: c.height ?? 0,
        ...(top != null ? { top } : {}),
      };
      walk(c);
    }
  };
  walk(out);
  const edges = (n: ElkNode): ElkExtendedEdge[] => [
    ...((n.edges ?? []) as ElkExtendedEdge[]),
    ...(n.children ?? []).flatMap(edges),
  ];
  // a link and its reverse share one route after the flip: the flipped one moves beside it
  const pair = (from: string, to: string) => `${from}\n${to}`;
  const pairs = new Set(drawn.map((l) => pair(l.from, l.to)));
  const twinned = new Set(
    drawn.filter((l) => flipped.has(l.id) && pairs.has(pair(l.to, l.from))).map((l) => l.id),
  );
  for (const e of edges(out)) {
    const s = e.sections?.[0];
    if (!s || e.id.startsWith(SPINE)) continue;
    const l = e.labels?.[0];
    const points = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({
      x: p.x,
      y: p.y,
    }));
    if (flipped.has(e.id)) points.reverse();
    const label =
      l?.x !== undefined && l.y !== undefined
        ? { x: l.x + (l.width ?? 0) / 2, y: l.y + (l.height ?? 0) / 2 }
        : undefined;
    laid.lines[e.id] = twinned.has(e.id) ? offsetOf(points, label, TWIN_GAP) : { points, label };
  }
  return laid;
}
