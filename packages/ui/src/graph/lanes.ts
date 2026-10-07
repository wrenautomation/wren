/**
 * A layout for things in time order: a column each, left to right, a row per lane (a channel), so
 * a lead's touches read as a timeline with a line per channel. On a phone it's one column, top to
 * bottom, each node naming its lane. Pure and synchronous: elk isn't needed for a line.
 */
import type { LayoutEdge, LayoutNode } from "./layout.js";
import type { Laid } from "./model.js";

/** Gaps (px): between columns (more when a wire carries words), between lanes, and rows. */
const GAP = { column: 40, lane: 28, row: 28, label: 6 };

export function lanes(
  nodes: readonly (LayoutNode & { lane?: string | undefined })[],
  edges: readonly LayoutEdge[],
  dir: "RIGHT" | "DOWN",
): Laid {
  const out: Laid = { width: 0, height: 0, nodes: {}, edges: {} };
  if (!nodes.length) return out;
  // Words on the wire into a node set how far it sits from the one before.
  const into = new Map(edges.map((e) => [e.to, e]));
  const room = (id: string) => into.get(id)?.label ?? { width: 0, height: 0 };

  if (dir === "DOWN") {
    let y = 0;
    for (const [i, n] of nodes.entries()) {
      if (i) y += Math.max(GAP.row, room(n.id).height + 2 * GAP.label);
      out.nodes[n.id] = { x: 0, y, width: n.width, height: n.height };
      y += n.height;
    }
    out.width = Math.max(...nodes.map((n) => n.width));
    out.height = y;
  } else {
    const order = [...new Set(nodes.map((n) => n.lane ?? ""))];
    const tall = new Map<string, number>();
    for (const n of nodes) tall.set(n.lane ?? "", Math.max(tall.get(n.lane ?? "") ?? 0, n.height));
    const top = new Map<string, number>();
    let y = 0;
    for (const lane of order) {
      top.set(lane, y);
      y += (tall.get(lane) ?? 0) + GAP.lane;
    }
    let x = 0;
    for (const [i, n] of nodes.entries()) {
      if (i) x += Math.max(GAP.column, room(n.id).width + 2 * GAP.label);
      out.nodes[n.id] = { x, y: top.get(n.lane ?? "") ?? 0, width: n.width, height: n.height };
      x += n.width;
    }
    out.width = x;
    out.height = y - GAP.lane;
  }

  for (const e of edges) {
    const a = out.nodes[e.from];
    const b = out.nodes[e.to];
    if (!a || !b || e.from === e.to) continue;
    const words = e.label ?? { width: 0, height: 0 };
    if (dir === "DOWN") {
      const x = a.x + Math.min(a.width, b.width) / 2;
      out.edges[e.id] = {
        points: [
          { x, y: a.y + a.height },
          { x, y: b.y },
        ],
        label: { x: x + GAP.label, y: (a.y + a.height + b.y - words.height) / 2 },
      };
    } else {
      const from = { x: a.x + a.width, y: a.y + a.height / 2 };
      const to = { x: b.x, y: b.y + b.height / 2 };
      // It turns at the far end, so a line climbing to a lane above misses its words.
      const turn = to.x - GAP.label / 2;
      out.edges[e.id] = {
        points:
          from.y === to.y ? [from, to] : [from, { x: turn, y: from.y }, { x: turn, y: to.y }, to],
        label: { x: from.x + GAP.label, y: from.y - words.height - GAP.label / 2 },
      };
    }
  }
  return out;
}
