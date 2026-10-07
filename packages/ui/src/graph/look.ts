/**
 * How a node looks as a node (designs/2026-10-06-workflow-editor.md, 0): a tile colored by its
 * role, ports as handles colored by the kind of event on them, inputs left and outputs right, and
 * curved wires with an arrow. The geometry is here, pure, so the canvas, the exported SVG and the
 * layout agree on where a port sits.
 */

/** What a node does in the business; its tile's color. */
export type GraphRole = "trigger" | "channel" | "logic" | "ai" | "data" | "deliver";

/** One handle on a node: an input or an output, with the kind of event it carries. */
export interface GraphPort {
  id: string;
  label: string;
  /** The event kind on it ("lead", "reply"): its color. */
  kind?: string | undefined;
}

/** Hues that read on a light and a dark page: the tile tints toward paper, the icon is the hue. */
export const ROLE_HUE: Record<GraphRole, string> = {
  trigger: "oklch(0.64 0.15 150)",
  channel: "oklch(0.6 0.15 255)",
  logic: "oklch(0.7 0.14 75)",
  ai: "oklch(0.6 0.17 300)",
  data: "oklch(0.6 0.04 250)",
  deliver: "oklch(0.62 0.16 25)",
};

/** Each event kind's color, on its handles and wires; an unknown kind is the ink's. */
const KIND_HUE: Record<string, string> = {
  lead: ROLE_HUE.channel,
  person: ROLE_HUE.data,
  firm: ROLE_HUE.data,
  reply: ROLE_HUE.trigger,
  call: ROLE_HUE.logic,
  form: ROLE_HUE.logic,
  client: ROLE_HUE.deliver,
  invoice: ROLE_HUE.deliver,
  post: ROLE_HUE.ai,
  video: ROLE_HUE.ai,
  comment: ROLE_HUE.ai,
  item: ROLE_HUE.ai,
  mail: ROLE_HUE.channel,
};
export const hueOf = (kind: string | undefined, or = "var(--ui-ink-3)") =>
  (kind && KIND_HUE[kind]) || or;

/** Node geometry (px). */
export const LOOK = {
  pad: 10,
  /** The icon tile, and the header row it sets: name over one line under it. */
  tile: 30,
  head: 32,
  number: 26,
  more: 16,
  line: 18,
  /** Each labeled port row, and the gap above them. */
  port: 18,
  ports: 6,
  /** The most lines a node lists; the hover card has every one. */
  lines: 5,
};

export interface Sized {
  ins?: readonly GraphPort[] | undefined;
  outs?: readonly GraphPort[] | undefined;
  number?: unknown;
  more?: unknown;
  lines?: readonly unknown[] | undefined;
}

/** Ports draw on their own rows only when a side has two or more; one sits by the header. */
export const portRows = (n: Sized) =>
  Math.max(
    (n.ins?.length ?? 0) > 1 ? (n.ins?.length ?? 0) : 0,
    (n.outs?.length ?? 0) > 1 ? (n.outs?.length ?? 0) : 0,
  );

/** Where the port rows start, from the node's top. */
function rowsTop(n: Sized): number {
  return (
    LOOK.pad +
    LOOK.head +
    (n.number ? LOOK.number : 0) +
    (n.more ? LOOK.more : 0) +
    Math.min(n.lines?.length ?? 0, LOOK.lines) * LOOK.line +
    LOOK.ports
  );
}

/** A node's height: header, number, lines, then a row per port. */
export function lookHeight(n: Sized): number {
  const rows = portRows(n);
  return rowsTop(n) - LOOK.ports + (rows ? LOOK.ports + rows * LOOK.port : 0) + LOOK.pad;
}

/**
 * How far down a node a port's handle sits: its row when that side has rows, else level with
 * the header. Unknown or no port: the header.
 */
export function portY(n: Sized, side: "in" | "out", port?: string | undefined): number {
  const list = side === "in" ? n.ins : n.outs;
  const i = port && list ? list.findIndex((p) => p.id === port) : -1;
  if ((list?.length ?? 0) < 2 || i < 0) return LOOK.pad + LOOK.head / 2;
  return rowsTop(n) + i * LOOK.port + LOOK.port / 2;
}

export interface Pt {
  x: number;
  y: number;
}

/**
 * A curved wire from `a` to `b`, leaving and arriving level (`across`) or upright, and the point
 * halfway along it, where its pill sits. One running backwards bows out wider.
 */
export function wireCurve(a: Pt, b: Pt, across: boolean): { d: string; mid: Pt; end: Pt } {
  const span = across ? b.x - a.x : b.y - a.y;
  const pull = Math.max(36, Math.abs(span) / 2) + (span < 0 ? 60 : 0);
  const c1 = across ? { x: a.x + pull, y: a.y } : { x: a.x, y: a.y + pull };
  const c2 = across ? { x: b.x - pull, y: b.y } : { x: b.x, y: b.y - pull };
  const r = (n: number) => Math.round(n * 10) / 10;
  const mid = {
    x: r((a.x + 3 * c1.x + 3 * c2.x + b.x) / 8),
    y: r((a.y + 3 * c1.y + 3 * c2.y + b.y) / 8),
  };
  return {
    d: `M${r(a.x)},${r(a.y)} C${r(c1.x)},${r(c1.y)} ${r(c2.x)},${r(c2.y)} ${r(b.x)},${r(b.y)}`,
    mid,
    end: b,
  };
}

/** The arrowhead at `end`, pointing right (`across`) or down: a small closed triangle. */
export function arrowAt(end: Pt, across: boolean, size = 6): string {
  const h = size / 2;
  return across
    ? `M${end.x - size},${end.y - h} L${end.x},${end.y} L${end.x - size},${end.y + h} Z`
    : `M${end.x - h},${end.y - size} L${end.x},${end.y} L${end.x + h},${end.y - size} Z`;
}

/** The pill's words: the count, then the condition or the wait; else what moves. */
export function pillText(e: {
  label?: string | undefined;
  count?: { value: number } | undefined;
  when?: string | undefined;
  wait?: string | undefined;
}): string {
  const rule = e.when ? `if ${e.when}` : e.wait ? `after ${e.wait}` : "";
  const n = e.count ? e.count.value.toLocaleString("en-US") : "";
  if (n && rule) return `${n} · ${rule}`;
  return n || rule || e.label || "";
}

/** About how wide a pill draws for `text`, capped. */
export const pillWidth = (text: string) =>
  text ? Math.min(168, Math.ceil(text.length * 6.2) + 16) : 0;
