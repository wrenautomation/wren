/**
 * The graph kit's data: what a node and a wire say, how big each draws, what a wire's numbers
 * read as, what search and filters keep, and the drawing as an SVG file. Pure, so it's tested
 * without a browser; `canvas.tsx` draws it on React Flow.
 */

import {
  arrowAt,
  type GraphPort,
  type GraphRole,
  hueOf,
  LOOK,
  lookHeight,
  loopCurve,
  pillText,
  pillWidth,
  portY,
  ROLE_HUE,
  wireCurve,
} from "./look.js";

export type { GraphPort, GraphRole } from "./look.js";

export type GraphKind = "part" | "workflow" | "account" | "step" | "record" | "host";
export type GraphTone = "good" | "warn" | "bad" | "accent" | "neutral";

export interface GraphNumber {
  /** The last 30 days, or whatever `label` says. */
  value: number;
  /** What it counts: "checked leads". */
  label: string;
  today?: number | undefined;
  /** The rows behind it. */
  href?: string | undefined;
}

export interface GraphNode {
  id: string;
  kind: GraphKind;
  label: string;
  /** One short line: what it does here. */
  note?: string | undefined;
  /** Its state as one word, with the tone it shows in. */
  state?: { label: string; tone: GraphTone } | undefined;
  /** Its main number, and a second one under it (a workflow's first stage, say). */
  number?: GraphNumber | undefined;
  more?: GraphNumber | undefined;
  /** Lines of detail, each with a sign: a version's added and retired copy. */
  lines?: { text: string; sign?: "+" | "−" | undefined }[] | undefined;
  /** More lines for the hover card only, as said: a node's four numbers. */
  hover?: readonly string[] | undefined;
  /** Where a click goes when the page opens nothing in place. */
  href?: string | undefined;
  /** Faded: not had, not built. */
  dim?: boolean | undefined;
  /** An end of the drawing (what comes in, what goes out): drawn dashed, as an account is. */
  dashed?: boolean | undefined;
  /** Opens into more nodes: drawn as a stack. */
  stacked?: boolean | undefined;
  /** What it does, its tile's color; by kind when left out (`roleOf`). */
  role?: GraphRole | undefined;
  /** A token for the tile's color (`var(--ui-cue-2)`), in place of the role's. An exported file keeps the role's. */
  tint?: string | undefined;
  /** Its inputs and outputs, each a handle; a side with two or more labels each one. */
  ins?: readonly GraphPort[] | undefined;
  outs?: readonly GraphPort[] | undefined;
  /** Its row in a `lanes` layout: "Email", "Texts". */
  lane?: string | undefined;
  /** What the filters read: { State: "Built", Channel: "Email" }. */
  facets?: Readonly<Record<string, string>> | undefined;
  /** A change shown as a diff: added green, removed red, changed in its settings. */
  mark?: GraphMark | undefined;
}

/** How a node or wire differs from what's live, in a diff. */
export type GraphMark = "added" | "removed" | "changed";

export interface GraphEdge {
  from: string;
  to: string;
  /** The output it leaves from and the input it lands on, when the nodes name their ports. */
  fromPort?: string | undefined;
  toPort?: string | undefined;
  /** The event kind on it, its color; the output's kind when left out. */
  kind?: string | undefined;
  /** What moves on it: "warm replies". */
  label?: string | undefined;
  /** Its number over the period, and today's. */
  count?: { value: number; today?: number | undefined } | undefined;
  /** What came into the node it leaves, against what left on it. */
  rate?: { from: number; to: number } | undefined;
  /** Its condition and wait, in words. */
  when?: string | undefined;
  wait?: string | undefined;
  /** More lines, said as they are. */
  notes?: readonly string[] | undefined;
  mark?: GraphMark | undefined;
  /** People who crossed it: with `ribbons`, its width is this against the drawing's largest. */
  weight?: number | undefined;
  /** A return to an earlier node: thin, dashed, and out of the layering. */
  loop?: true | undefined;
}

/** A ribbon's narrowest and widest (px). */
export const RIBBON = { min: 2, max: 48 } as const;

/**
 * A ribbon's width: `weight` against `max`, the largest weight in the drawing, linear, with the
 * widest at `RIBBON.max`. A weight of nothing, or a drawing with none, is the least.
 */
export function ribbonWidth(weight: number, max: number): number {
  if (!(weight > 0) || !(max > 0)) return RIBBON.min;
  const w = Math.min(RIBBON.max, Math.max(RIBBON.min, (weight / max) * RIBBON.max));
  return Math.round(w * 10) / 10;
}

/** The largest weight among the flow wires (loops don't count). */
export const ribbonMax = (edges: readonly GraphEdge[]): number =>
  edges.reduce((m, e) => (e.loop ? m : Math.max(m, e.weight ?? 0)), 0);

export const edgeId = (e: Pick<GraphEdge, "from" | "to">) => `${e.from}>${e.to}`;

/** What a palette item carries when dragged onto a graph (`onDrop`): its id as text. */
export const GRAPH_DROP = "application/x-wren-node";

const num = (n: number) => n.toLocaleString("en-US");

/** "7.5%", "31%", "0%": one decimal under ten. */
export function percent(part: number, whole: number): string {
  if (whole <= 0) return "";
  const p = (part / whole) * 100;
  return `${p < 10 && p > 0 ? Math.round(p * 10) / 10 : Math.round(p)}%`;
}

/** A wire's lines: what moves and how many, the rate from the node before, its rule and wait. */
export function wireLines(e: GraphEdge): string[] {
  const what = e.count
    ? `${num(e.count.value)}${e.label ? ` ${e.label}` : ""}${e.count.today ? ` · ${num(e.count.today)} today` : ""}`
    : (e.label ?? "");
  const rate =
    e.rate && e.rate.from > 0
      ? `${num(e.rate.from)} → ${num(e.rate.to)}, ${percent(e.rate.to, e.rate.from)}`
      : "";
  return [
    what,
    rate,
    e.when ? `if ${e.when}` : "",
    e.wait ? `after ${e.wait}` : "",
    ...(e.notes ?? []),
  ].filter(Boolean);
}

/** A node's width by kind: compact, as a node is. */
export const NODE_WIDTH: Record<GraphKind, number> = {
  part: 216,
  workflow: 216,
  step: 216,
  host: 216,
  record: 232,
  account: 184,
};

/** A node's role by its kind, when it names none. */
export function roleOf(n: Pick<GraphNode, "role" | "kind">): GraphRole {
  if (n.role) return n.role;
  return n.kind === "account"
    ? "trigger"
    : n.kind === "record" || n.kind === "host"
      ? "data"
      : n.kind === "workflow"
        ? "logic"
        : "channel";
}

/** How big a node draws: its header, number, lines and a row per port (`look.ts`). */
export function nodeSize(n: GraphNode): { width: number; height: number } {
  return { width: NODE_WIDTH[n.kind], height: lookHeight(n) };
}

/** Where a wire leaves and lands on two laid boxes: at its ports, or the sides' middles. */
export function wireEnds(
  e: Pick<GraphEdge, "fromPort" | "toPort">,
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  an: GraphNode | undefined,
  bn: GraphNode | undefined,
  across: boolean,
) {
  return across
    ? {
        from: { x: a.x + a.width, y: a.y + (an ? portY(an, "out", e.fromPort) : a.height / 2) },
        to: { x: b.x, y: b.y + (bn ? portY(bn, "in", e.toPort) : b.height / 2) },
      }
    : {
        from: { x: a.x + a.width / 2, y: a.y + a.height },
        to: { x: b.x + b.width / 2, y: b.y },
      };
}

/** A wire's color: its kind's, else its output's. */
export function wireHue(e: GraphEdge, from: GraphNode | undefined): string {
  return hueOf(
    e.kind ?? from?.outs?.find((p) => p.id === e.fromPort)?.kind ?? from?.outs?.[0]?.kind,
  );
}

/** Room a wire's pill takes, for the layout to keep clear. */
export function pillSize(e: GraphEdge): { width: number; height: number } {
  const w = pillWidth(pillText(e));
  return w ? { width: w, height: 20 } : { width: 0, height: 0 };
}

/** Room a wire's lines take: elk keeps it clear between the columns. */
export function labelSize(lines: readonly string[]): { width: number; height: number } {
  if (!lines.length) return { width: 0, height: 0 };
  const widest = Math.max(...lines.map((l) => l.length));
  return { width: Math.min(190, Math.ceil(widest * 6.1) + 8), height: lines.length * 15 + 4 };
}

/** Whether `n` matches what's typed: its label, note, state or any facet. */
export function matches(n: GraphNode, q: string): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [n.label, n.note, n.state?.label, ...Object.values(n.facets ?? {})]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((w) => text.includes(w));
}

/** Each facet with two or more values among `nodes`, its values sorted: the filters to offer. */
export function facetsOf(nodes: readonly GraphNode[]): [string, string[]][] {
  const all = new Map<string, Set<string>>();
  for (const n of nodes)
    for (const [k, v] of Object.entries(n.facets ?? {})) {
      if (!all.has(k)) all.set(k, new Set());
      all.get(k)?.add(v);
    }
  return [...all]
    .filter(([, vs]) => vs.size > 1)
    .map(([k, vs]): [string, string[]] => [k, [...vs].sort()]);
}

/** The nodes search and filters keep; null when nothing narrows them. */
export function litOf(
  nodes: readonly GraphNode[],
  q: string,
  picks: Readonly<Record<string, string>>,
): Set<string> | null {
  const on = Object.entries(picks).filter(([, v]) => v);
  if (!q.trim() && !on.length) return null;
  return new Set(
    nodes
      .filter((n) => matches(n, q) && on.every(([k, v]) => n.facets?.[k] === v))
      .map((n) => n.id),
  );
}

export interface Point {
  x: number;
  y: number;
}

/** A line through `points`, its corners rounded by up to `r`. */
export function roundedPath(points: readonly Point[], r = 8): string {
  const [first, ...rest] = points;
  if (!first) return "";
  let d = `M${first.x},${first.y}`;
  for (let i = 0; i < rest.length; i++) {
    const p = rest[i] as Point;
    const prev = (i === 0 ? first : rest[i - 1]) as Point;
    const next = rest[i + 1];
    if (!next) {
      d += ` L${p.x},${p.y}`;
      break;
    }
    const a = Math.min(r, Math.hypot(p.x - prev.x, p.y - prev.y) / 2);
    const b = Math.min(r, Math.hypot(next.x - p.x, next.y - p.y) / 2);
    const k = Math.min(a, b);
    const into = towards(p, prev, k);
    const out = towards(p, next, k);
    d += ` L${into.x},${into.y} Q${p.x},${p.y} ${out.x},${out.y}`;
  }
  return d;
}

function towards(from: Point, to: Point, by: number): Point {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    x: round(from.x + ((to.x - from.x) / len) * by),
    y: round(from.y + ((to.y - from.y) / len) * by),
  };
}

/** A laid-out graph: each node's box, each wire's route and where its lines sit. */
export interface Laid {
  width: number;
  height: number;
  nodes: Record<string, { x: number; y: number; width: number; height: number }>;
  edges: Record<string, { points: Point[]; label?: Point | undefined }>;
}

/** The colors an exported drawing is in, read off the page's tokens. */
export interface Ink {
  paper: string;
  ink: string;
  ink2: string;
  ink3: string;
  hair: string;
  tile: string;
  /** Under the drawing; the tile when left out. */
  ground?: string | undefined;
  font: string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Cut to about `w` px of `char`-wide letters, with an ellipsis. */
const clip = (s: string, w: number, char: number) => {
  const most = Math.floor(w / char);
  return s.length > most ? `${s.slice(0, Math.max(1, most - 1))}…` : s;
};

type Box = { x: number; y: number; width: number; height: number };

/**
 * Where each ribbon leaves and lands. Ribbons that share a node sit side by side along its
 * edge, in the order of the nodes they go to, so none hides another. When they are wider than
 * the node, they overlap evenly.
 */
function ribbonEnds(
  boxes: Readonly<Record<string, Box>>,
  flow: readonly { id: string; e: GraphEdge; w: number }[],
  across: boolean,
): Map<string, { from: Point; to: Point }> {
  const cross = (b: Box) => (across ? b.y + b.height / 2 : b.x + b.width / 2);
  const out = new Map<string, { from: Point; to: Point }>();
  const sides = new Map<string, { id: string; w: number; key: number }[]>();
  for (const f of flow) {
    const a = boxes[f.e.from];
    const b = boxes[f.e.to];
    if (!a || !b) continue;
    for (const [node, side, other] of [
      [f.e.from, "out", b],
      [f.e.to, "in", a],
    ] as const) {
      const k = `${node}|${side}`;
      const list = sides.get(k) ?? [];
      list.push({ id: f.id, w: f.w, key: cross(other) });
      sides.set(k, list);
    }
  }
  const at = new Map<string, number>();
  for (const [k, list] of sides) {
    const [node] = k.split("|") as [string];
    const box = boxes[node] as Box;
    const room = across ? box.height : box.width;
    const total = list.reduce((n, i) => n + i.w, 0);
    const squeeze = total > room ? room / total : 1;
    let pos = cross(box) - (total * squeeze) / 2;
    for (const i of [...list].sort((x, y) => x.key - y.key)) {
      at.set(`${k}|${i.id}`, pos + (i.w * squeeze) / 2);
      pos += i.w * squeeze;
    }
  }
  for (const f of flow) {
    const a = boxes[f.e.from];
    const b = boxes[f.e.to];
    if (!a || !b) continue;
    const ya = at.get(`${f.e.from}|out|${f.id}`) ?? cross(a);
    const yb = at.get(`${f.e.to}|in|${f.id}`) ?? cross(b);
    out.set(
      f.id,
      across
        ? { from: { x: a.x + a.width, y: ya }, to: { x: b.x, y: yb } }
        : { from: { x: ya, y: a.y + a.height }, to: { x: yb, y: b.y } },
    );
  }
  return out;
}

/** One wire as drawn: its path, head and the point its pill sits at. */
export interface DrawnWire {
  id: string;
  e: GraphEdge;
  d: string;
  /** The head; empty on a ribbon, which is wide enough to show its way. */
  arrow: string;
  mid: Point;
  /** Stroke width of a ribbon, else null for a wire. */
  width: number | null;
  loop: boolean;
}

/**
 * Every wire the layout placed, as paths: curved wires, ribbons (`ribbons`) whose width is the
 * wire's weight, and loops (drawn between the laid nodes whether the layout routed them or not).
 * The canvas and the exported file both draw from this.
 */
export function wiresOf(
  laid: Laid,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  across: boolean,
  ribbons = false,
): DrawnWire[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: DrawnWire[] = [];
  const max = ribbons ? ribbonMax(edges) : 0;
  const flow = edges.flatMap((e) =>
    !e.loop && laid.nodes[e.from] && laid.nodes[e.to] && laid.edges[edgeId(e)]
      ? [{ id: edgeId(e), e, w: ribbonWidth(e.weight ?? 0, max) }]
      : [],
  );
  const slots = ribbons ? ribbonEnds(laid.nodes, flow, across) : null;
  const drawn = new Map(flow.map((f) => [f.id, f] as const));
  for (const e of edges) {
    const id = edgeId(e);
    const a = laid.nodes[e.from];
    const b = laid.nodes[e.to];
    if (!a || !b) continue;
    if (e.loop) {
      if (e.from === e.to) continue;
      const c = loopCurve(a, b, across);
      out.push({ id, e, d: c.d, arrow: c.arrow, mid: c.mid, width: null, loop: true });
      continue;
    }
    const f = drawn.get(id);
    if (!f) continue;
    const ends = slots?.get(id) ?? wireEnds(e, a, b, byId.get(e.from), byId.get(e.to), across);
    const c = wireCurve(ends.from, ends.to, across);
    out.push({
      id,
      e,
      d: c.d,
      arrow: ribbons ? "" : arrowAt(c.end, across),
      mid: c.mid,
      width: ribbons ? f.w : null,
      loop: false,
    });
  }
  return out;
}

/** The drawing as a standalone SVG file: nodes with their tiles and ports, curved wires and pills. */
export function svgOf(
  laid: Laid,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  ink: Ink,
  pad = 24,
  across = true,
  ribbons = false,
): string {
  const w = Math.ceil(laid.width + 2 * pad);
  const h = Math.ceil(laid.height + 2 * pad);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${esc(ink.font)}">`,
    `<rect width="${w}" height="${h}" fill="${ink.ground ?? ink.tile}"/>`,
    `<g transform="translate(${pad} ${pad})">`,
  ];
  const pills: string[] = [];
  for (const w of wiresOf(laid, nodes, edges, across, ribbons)) {
    const hue = wireHue(w.e, byId.get(w.e.from));
    if (w.loop) {
      out.push(
        `<path d="${w.d}" fill="none" stroke="${ink.ink3}" stroke-width="1" stroke-dasharray="4 3"/>`,
        `<path d="${w.arrow}" fill="${ink.ink3}"/>`,
      );
    } else if (w.width !== null) {
      out.push(
        `<path d="${w.d}" fill="none" stroke="${hue}" stroke-opacity="0.45" stroke-width="${w.width}"/>`,
      );
    } else {
      out.push(
        `<path d="${w.d}" fill="none" stroke="${hue}" stroke-width="1.5"/>`,
        `<path d="${w.arrow}" fill="${hue}"/>`,
      );
    }
    const text = pillText(w.e);
    if (text) {
      const pw = pillWidth(text);
      pills.push(
        `<rect x="${w.mid.x - pw / 2}" y="${w.mid.y - 10}" width="${pw}" height="20" rx="10" fill="${ink.paper}" stroke="${ink.hair}"/>`,
        `<text x="${w.mid.x}" y="${w.mid.y + 4}" font-size="11" text-anchor="middle" fill="${ink.ink2}">${esc(clip(text, pw - 12, 6.2))}</text>`,
      );
    }
  }
  for (const n of nodes) {
    const b = laid.nodes[n.id];
    if (!b) continue;
    const dash = n.kind === "account" || n.dashed ? ` stroke-dasharray="4 3"` : "";
    const fade = n.dim ? ` opacity="0.5"` : "";
    const hue = ROLE_HUE[roleOf(n)];
    out.push(`<g transform="translate(${b.x} ${b.y})"${fade}>`);
    if (n.stacked)
      out.push(
        `<rect x="4" y="-4" width="${b.width}" height="${b.height}" rx="8" fill="${ink.paper}" stroke="${ink.hair}"/>`,
      );
    out.push(
      `<rect width="${b.width}" height="${b.height}" rx="8" fill="${n.kind === "account" || n.dashed ? ink.tile : ink.paper}" stroke="${ink.ink3}"${dash}/>`,
      `<rect x="${LOOK.pad}" y="${LOOK.pad + 1}" width="${LOOK.tile}" height="${LOOK.tile}" rx="7" fill="${hue}" fill-opacity="0.16"/>`,
      `<circle cx="${LOOK.pad + LOOK.tile / 2}" cy="${LOOK.pad + 1 + LOOK.tile / 2}" r="5" fill="${hue}"/>`,
    );
    const x = LOOK.pad + LOOK.tile + 10;
    const text = (y: number, size: number, fill: string, t: string, weight = "") =>
      out.push(
        `<text x="${x}" y="${y}" font-size="${size}"${weight} fill="${fill}">${esc(clip(t, b.width - x - 18, size * 0.55))}</text>`,
      );
    text(n.note ? LOOK.pad + 13 : LOOK.pad + 20, 13, ink.ink, n.label, ` font-weight="600"`);
    if (n.note) text(LOOK.pad + 29, 11.5, ink.ink2, n.note);
    let y = LOOK.pad + LOOK.head;
    if (n.number) {
      y += LOOK.number;
      out.push(
        `<text x="${LOOK.pad}" y="${y - 6}" font-size="11.5" fill="${ink.ink2}"><tspan font-size="17" font-weight="600" fill="${ink.ink}">${num(n.number.value)}</tspan> ${esc(clip(n.number.label, b.width - 90, 6.2))}</text>`,
      );
    }
    if (n.more) {
      y += LOOK.more;
      out.push(
        `<text x="${LOOK.pad}" y="${y - 4}" font-size="11.5" fill="${ink.ink2}">${num(n.more.value)} ${esc(clip(n.more.label, b.width - 70, 6.2))}</text>`,
      );
    }
    for (const l of (n.lines ?? []).slice(0, LOOK.lines)) {
      y += LOOK.line;
      out.push(
        `<text x="${LOOK.pad}" y="${y - 5}" font-size="11.5" fill="${ink.ink2}">${esc(clip(`${l.sign ? `${l.sign} ` : ""}${l.text}`, b.width - 2 * LOOK.pad, 6.2))}</text>`,
      );
    }
    if (across) {
      for (const [side, list] of [
        ["in", n.ins ?? []],
        ["out", n.outs ?? []],
      ] as const)
        for (const p of list.length ? list : [undefined]) {
          const py = portY(n, side, p?.id);
          const px = side === "in" ? 0 : b.width;
          out.push(
            `<circle cx="${px}" cy="${py}" r="4" fill="${ink.paper}" stroke="${hueOf(p?.kind, ink.ink3)}" stroke-width="1.5"/>`,
          );
          if (p && list.length > 1)
            out.push(
              `<text x="${side === "in" ? px + 9 : px - 9}" y="${py + 4}" font-size="11" text-anchor="${side === "in" ? "start" : "end"}" fill="${ink.ink2}">${esc(clip(p.label, b.width / 2 - 14, 6))}</text>`,
            );
        }
    }
    out.push("</g>");
  }
  out.push(...pills, "</g></svg>");
  return out.join("\n");
}
