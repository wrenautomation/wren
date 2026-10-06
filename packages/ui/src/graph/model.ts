/**
 * The graph kit's data: what a node and a wire say, how big each draws, what a wire's numbers
 * read as, what search and filters keep, and the drawing as an SVG file. Pure, so it's tested
 * without a browser; `canvas.tsx` draws it on React Flow.
 */

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
  /** Where a click goes when the page opens nothing in place. */
  href?: string | undefined;
  /** Faded: not had, not built. */
  dim?: boolean | undefined;
  /** An end of the drawing (what comes in, what goes out): drawn dashed, as an account is. */
  dashed?: boolean | undefined;
  /** Opens into more nodes: drawn as a stack. */
  stacked?: boolean | undefined;
  /** What the filters read: { State: "Built", Channel: "Email" }. */
  facets?: Readonly<Record<string, string>> | undefined;
}

export interface GraphEdge {
  from: string;
  to: string;
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
}

export const edgeId = (e: Pick<GraphEdge, "from" | "to">) => `${e.from}>${e.to}`;

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

/** A node's width by kind, and the type it draws at. */
export const NODE_WIDTH: Record<GraphKind, number> = {
  part: 232,
  workflow: 232,
  step: 232,
  host: 232,
  record: 300,
  account: 196,
};
const PAD_Y = 22;
const ROW = { label: 17, small: 16, number: 26, line: 19 };
const CHAR = { label: 7.3, small: 6.5 };
const INSET = 26;

const rows = (s: string | undefined, char: number, w: number, most: number) =>
  s ? Math.min(most, Math.max(1, Math.ceil((s.length * char) / (w - INSET)))) : 0;

/** About how tall a node draws: its label (two rows), note (two), numbers and lines. */
export function nodeSize(n: GraphNode): { width: number; height: number } {
  const width = NODE_WIDTH[n.kind];
  // The state sits beside the label, taking part of its row.
  const label = rows(n.label + (n.state ? `  ${n.state.label}` : ""), CHAR.label, width - 22, 2);
  const lines = Math.min(n.lines?.length ?? 0, 7);
  const height =
    PAD_Y +
    ROW.label * label +
    ROW.small * rows(n.note, CHAR.small, width, 2) +
    (n.number
      ? ROW.number + 4 + ROW.small * (rows(numberText(n.number), CHAR.small, width - 20, 3) - 1)
      : 0) +
    (n.more ? ROW.small : 0) +
    ROW.line * lines;
  return { width, height: Math.max(52, Math.ceil(height)) };
}

/** A number's line as it reads: its digits count wider than small text, so a few more. */
const numberText = (n: GraphNumber) =>
  `${n.value.toLocaleString("en-US")}xxxx ${n.label}${n.today ? ` · ${n.today} today` : ""}`;

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
  font: string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Cut to about `w` px of `char`-wide letters, with an ellipsis. */
const clip = (s: string, w: number, char: number) => {
  const most = Math.floor(w / char);
  return s.length > most ? `${s.slice(0, Math.max(1, most - 1))}…` : s;
};

/** The drawing as a standalone SVG file: boxes, labels, numbers, lines and their words. */
export function svgOf(
  laid: Laid,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  ink: Ink,
  pad = 24,
): string {
  const w = Math.ceil(laid.width + 2 * pad);
  const h = Math.ceil(laid.height + 2 * pad);
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${esc(ink.font)}">`,
    `<rect width="${w}" height="${h}" fill="${ink.tile}"/>`,
    `<g transform="translate(${pad} ${pad})">`,
  ];
  for (const e of edges) {
    const at = laid.edges[edgeId(e)];
    if (!at) continue;
    out.push(
      `<path d="${roundedPath(at.points)}" fill="none" stroke="${ink.ink3}" stroke-width="1.5"/>`,
    );
    const lines = wireLines(e);
    if (at.label)
      for (const [i, l] of lines.entries())
        out.push(
          `<text x="${at.label.x}" y="${at.label.y + 12 + i * 15}" font-size="11" fill="${ink.ink2}">${esc(clip(l, 190, 6.1))}</text>`,
        );
  }
  for (const n of nodes) {
    const b = laid.nodes[n.id];
    if (!b) continue;
    const dash = n.kind === "account" || n.dashed ? ` stroke-dasharray="4 3"` : "";
    const fade = n.dim ? ` opacity="0.5"` : "";
    out.push(`<g transform="translate(${b.x} ${b.y})"${fade}>`);
    if (n.stacked)
      out.push(
        `<rect x="4" y="4" width="${b.width}" height="${b.height}" fill="${ink.paper}" stroke="${ink.hair}"/>`,
      );
    out.push(
      `<rect width="${b.width}" height="${b.height}" fill="${n.kind === "account" || n.dashed ? ink.tile : ink.paper}" stroke="${ink.ink3}"${dash}/>`,
      `<text x="12" y="20" font-size="13" font-weight="600" fill="${ink.ink}">${esc(clip(n.label, b.width - 24, 7.3))}</text>`,
    );
    let y = 20;
    if (n.note) {
      y += 16;
      out.push(
        `<text x="12" y="${y}" font-size="12" fill="${ink.ink2}">${esc(clip(n.note, b.width - 24, 6.5))}</text>`,
      );
    }
    if (n.number) {
      y += 24;
      out.push(
        `<text x="12" y="${y}" font-size="12" fill="${ink.ink2}"><tspan font-size="18" font-weight="600" fill="${ink.ink}">${num(n.number.value)}</tspan> ${esc(clip(n.number.label, b.width - 90, 6.5))}</text>`,
      );
    }
    for (const l of n.lines ?? []) {
      y += 18;
      if (y > b.height - 6) break;
      out.push(
        `<text x="12" y="${y}" font-size="12" fill="${ink.ink2}">${esc(clip(`${l.sign ? `${l.sign} ` : ""}${l.text}`, b.width - 24, 6.5))}</text>`,
      );
    }
    out.push("</g>");
  }
  out.push("</g></svg>");
  return out.join("\n");
}
