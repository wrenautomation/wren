/**
 * A run's steps as a graph: which step builds on which, the column each sits
 * in, and the line from one to the next. Pure, so it's tested without a browser.
 */

/** The node for what a run reads ("Your list") and the one for who it hands off to. */
export const INPUT = "@input";
export const OUTPUT = "@output";

export interface FlowStep {
  id: string;
  /** The steps it builds on. Left out: the step before it. Empty: it reads the run's input. */
  after?: string[] | undefined;
}

export interface FlowNode {
  id: string;
  col: number;
  /** Its place in its column, from 0. */
  index: number;
  /** How many share its column. */
  of: number;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** Columns it crosses: 1 is the next one over. */
  span: number;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  cols: number;
  /** The most nodes in any one column. */
  rows: number;
}

/**
 * `steps`, in order, as columns: a step sits one column past the furthest step
 * it builds on. Steps `keep` turns away drop out, and the lines through them
 * join up around them. `ends` adds a node before the first steps and one after
 * whatever nothing else builds on.
 */
export function flowOf(
  steps: readonly FlowStep[],
  keep: (id: string) => boolean,
  ends: { input: boolean; output: boolean } = { input: false, output: false },
  /** Steps that build on nothing sit one column before their first user, not at the start. */
  late = false,
): FlowGraph {
  // The first of a repeated id wins; the ends' own ids aren't steps.
  const seenIds = new Set<string>();
  const unique = steps.filter(
    (s) => s.id !== INPUT && s.id !== OUTPUT && !seenIds.has(s.id) && seenIds.add(s.id),
  );
  const raw = new Map(
    unique.map((s, i) => [s.id, s.after ?? (i > 0 ? [unique[i - 1]?.id ?? ""] : [])]),
  );
  const kept = unique.filter((s) => keep(s.id));
  if (!kept.length) return { nodes: [], edges: [], cols: 0, rows: 0 };

  // What each kept step builds on, looking through the ones dropped.
  const deps = new Map<string, string[]>();
  for (const s of kept) {
    const out = new Set<string>();
    const seen = new Set<string>([s.id]);
    const walk = (ids: readonly string[]) => {
      for (const d of ids) {
        if (seen.has(d) || !raw.has(d)) continue;
        seen.add(d);
        if (keep(d)) out.add(d);
        else walk(raw.get(d) ?? []);
      }
    };
    walk(raw.get(s.id) ?? []);
    deps.set(s.id, [...out]);
  }

  const first = ends.input ? 1 : 0;
  const cols = new Map<string, number>();
  const colOf = (id: string, path: Set<string>): number => {
    const known = cols.get(id);
    if (known !== undefined) return known;
    // A loop in `after` is a mistake; break it rather than hang.
    if (path.has(id)) return first;
    path.add(id);
    const ds = deps.get(id) ?? [];
    const c = ds.length ? 1 + Math.max(...ds.map((d) => colOf(d, path))) : first;
    path.delete(id);
    cols.set(id, c);
    return c;
  };
  for (const s of kept) colOf(s.id, new Set());
  if (late)
    for (const s of kept) {
      if (deps.get(s.id)?.length) continue;
      const users = kept
        .filter((t) => deps.get(t.id)?.includes(s.id))
        .map((t) => cols.get(t.id) ?? first);
      if (users.length) cols.set(s.id, Math.max(first, Math.min(...users) - 1));
    }
  // A loop can leave a column empty; close the gap.
  const used = [...new Set(cols.values())].sort((a, b) => a - b);
  for (const [id, c] of cols) cols.set(id, used.indexOf(c) + first);

  const edges: FlowEdge[] = [];
  const at = (id: string) => cols.get(id) ?? 0;
  for (const s of kept) {
    // A line that would run backwards is the loop's back half; leave it out.
    const ds = (deps.get(s.id) ?? []).filter((d) => at(d) < at(s.id));
    if (!ds.length && ends.input) edges.push({ from: INPUT, to: s.id, span: at(s.id) });
    for (const d of ds) edges.push({ from: d, to: s.id, span: at(s.id) - at(d) });
  }
  const last = Math.max(...kept.map((s) => at(s.id)));
  if (ends.input) cols.set(INPUT, 0);
  if (ends.output) {
    cols.set(OUTPUT, last + 1);
    const built = new Set(edges.map((e) => e.from));
    for (const s of kept)
      if (!built.has(s.id)) edges.push({ from: s.id, to: OUTPUT, span: last + 1 - at(s.id) });
  }

  const order = [...(ends.input ? [INPUT] : []), ...kept.map((s) => s.id)];
  if (ends.output) order.push(OUTPUT);
  const count = new Map<number, number>();
  for (const id of order) count.set(at(id), (count.get(at(id)) ?? 0) + 1);
  const taken = new Map<number, number>();
  const nodes = order.map((id): FlowNode => {
    const col = at(id);
    const index = taken.get(col) ?? 0;
    taken.set(col, index + 1);
    return { id, col, index, of: count.get(col) ?? 1 };
  });
  return { nodes, edges, cols: Math.max(...count.keys()) + 1, rows: Math.max(...count.values()) };
}

/** A node's place in the graph's box, in pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Steps run left to right, or top to bottom on a narrow screen. */
export type FlowAxis = "across" | "down";

const TURN = 10;
const px = (n: number) => Math.round(n * 10) / 10;

/** How far from a box a line turns when it turns `near` that box. */
const BEND = 18;

/**
 * The line from node `a` to node `b`, as SVG path data: square turns with soft
 * corners. To the next column it turns halfway across the gap, or `near` one end so
 * a label has the long side. Further, it runs on past the columns between: across,
 * level with `a` then into `b` from above or below; down, out along the left edge
 * at `gutter` and back in.
 */
export function edgePath(
  a: Box,
  b: Box,
  span: number,
  axis: FlowAxis,
  gutter = 6,
  near?: "from" | "to",
): string {
  if (axis === "across") {
    const sx = a.x + a.w;
    const sy = a.y + a.h / 2;
    const ty = b.y + b.h / 2;
    if (span > 1 && (sy < b.y || sy > b.y + b.h)) {
      const cx = b.x + b.w / 2;
      const dir = ty > sy ? 1 : -1;
      const ey = dir > 0 ? b.y : b.y + b.h;
      const r = Math.max(0, Math.min(TURN, Math.abs(ey - sy) / 2, (cx - sx) / 2));
      return `M${px(sx)} ${px(sy)}H${px(cx - r)}Q${px(cx)} ${px(sy)} ${px(cx)} ${px(sy + dir * r)}V${px(ey)}`;
    }
    const tx = b.x;
    if (Math.abs(ty - sy) < 1) return `M${px(sx)} ${px(sy)}H${px(tx)}`;
    const mx = near === "from" ? sx + BEND : near === "to" ? tx - BEND : (sx + tx) / 2;
    const dir = ty > sy ? 1 : -1;
    const r = Math.min(TURN, Math.abs(ty - sy) / 2, Math.abs(mx - sx), Math.abs(tx - mx));
    return `M${px(sx)} ${px(sy)}H${px(mx - r)}Q${px(mx)} ${px(sy)} ${px(mx)} ${px(sy + dir * r)}V${px(ty - dir * r)}Q${px(mx)} ${px(ty)} ${px(mx + r)} ${px(ty)}H${px(tx)}`;
  }
  if (span > 1) {
    const sy = a.y + a.h / 2;
    const ty = b.y + b.h / 2;
    const r = Math.max(0, Math.min(TURN, a.x - gutter, b.x - gutter, Math.abs(ty - sy) / 2));
    return `M${px(a.x)} ${px(sy)}H${px(gutter + r)}Q${px(gutter)} ${px(sy)} ${px(gutter)} ${px(sy + r)}V${px(ty - r)}Q${px(gutter)} ${px(ty)} ${px(gutter + r)} ${px(ty)}H${px(b.x)}`;
  }
  const sx = a.x + a.w / 2;
  const sy = a.y + a.h;
  const tx = b.x + b.w / 2;
  const ty = b.y;
  if (Math.abs(tx - sx) < 1) return `M${px(sx)} ${px(sy)}V${px(ty)}`;
  const my = (sy + ty) / 2;
  const dir = tx > sx ? 1 : -1;
  const r = Math.min(TURN, Math.abs(tx - sx) / 2, Math.abs(ty - sy) / 2);
  return `M${px(sx)} ${px(sy)}V${px(my - r)}Q${px(sx)} ${px(my)} ${px(sx + dir * r)} ${px(my)}H${px(tx - dir * r)}Q${px(tx)} ${px(my)} ${px(tx)} ${px(my + r)}V${px(ty)}`;
}

/**
 * Where a line's label sits, across, its last row resting just above the line: at `a`'s side
 * when the line is the only one leaving `a`, else at `b`'s, so labels on lines that fan out or
 * in never share a spot. A line that runs on past columns enters `b` from above or below, so
 * its label stays at `a`'s side.
 */
export function labelAt(
  a: Box,
  b: Box,
  span: number,
  end: "from" | "to",
): { x: number; y: number; anchor: "start" | "end" } {
  const sy = a.y + a.h / 2;
  if (end === "from" || (span > 1 && (sy < b.y || sy > b.y + b.h)))
    return { x: a.x + a.w + 10, y: sy - 4, anchor: "start" };
  return { x: b.x - 6, y: b.y + b.h / 2 - 4, anchor: "end" };
}

/** Room between nodes: across, between columns then rows; down, side by side then between rows. */
const GAP = { across: { x: 40, y: 22 }, down: { x: 8, y: 28 } };
/** Down, the room on the left for a line that skips a step. */
const GUTTER = 18;
const isEnd = (id: string) => id === INPUT || id === OUTPUT;

/**
 * Where each node sits in a box `width` wide, given each node's height as drawn. Across, the
 * columns share the width (one holding only an end gets 0.7 of a share), and each column's
 * nodes center on slots as tall as the tallest node. Down, each column is a row and its nodes
 * share it; an end is half wide, centered. A step takes its slot's or row's full height, so the
 * counts and bars beside it line up; an end keeps its own.
 */
export function layoutOf(
  g: FlowGraph,
  axis: FlowAxis,
  width: number,
  heights: Readonly<Record<string, number>>,
  /** Across, the room between columns, over the default: room for a line's label. */
  gapX?: number,
): { boxes: Record<string, Box>; height: number } {
  const gap = { ...GAP[axis], ...(gapX !== undefined && axis === "across" ? { x: gapX } : {}) };
  const boxes: Record<string, Box> = {};
  const hOf = (id: string) => heights[id] ?? 0;
  if (axis === "across") {
    const share = Array.from({ length: g.cols }, (_, c) =>
      g.nodes.some((n) => n.col === c && !isEnd(n.id)) ? 1 : 0.7,
    );
    const unit = (width - gap.x * (g.cols - 1)) / share.reduce((a, b) => a + b, 0);
    const left = share.map((_, c) => share.slice(0, c).reduce((x, s) => x + s * unit + gap.x, 0));
    const tall = Math.max(0, ...g.nodes.map((n) => hOf(n.id)));
    const slot = (tall + gap.y) / 2;
    for (const n of g.nodes) {
      const h = isEnd(n.id) ? hOf(n.id) : tall;
      const y = (g.rows - n.of + n.index * 2) * slot + (tall - h) / 2;
      boxes[n.id] = { x: left[n.col] ?? 0, y, w: (share[n.col] ?? 1) * unit, h };
    }
    return { boxes, height: g.rows * tall + Math.max(0, g.rows - 1) * gap.y };
  }
  const room = width - GUTTER;
  let top = 0;
  for (let c = 0; c < g.cols; c++) {
    const row = g.nodes.filter((n) => n.col === c);
    const tall = Math.max(0, ...row.map((n) => hOf(n.id)));
    for (const n of row) {
      const h = isEnd(n.id) ? hOf(n.id) : tall;
      const w = isEnd(n.id) ? room / 2 : (room - gap.x * (n.of - 1)) / n.of;
      const x = GUTTER + (isEnd(n.id) ? room / 4 : n.index * (w + gap.x));
      boxes[n.id] = { x, y: top + (tall - h) / 2, w, h };
    }
    top += tall + gap.y;
  }
  return { boxes, height: Math.max(0, top - gap.y) };
}
