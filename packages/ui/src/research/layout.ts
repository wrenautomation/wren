/**
 * Where a run's graph draws, for a given width: claims in a column, one island per kind of source,
 * a line from a claim to each source that backs it. Pure and seeded by order: the same run gives
 * the same picture. Draft of the layout in the round 4 mock, with no source names on the canvas.
 */
import { type ResearchRun, type ResearchSource, usedOf } from "./model.js";

export interface Disc {
  id: string;
  x: number;
  y: number;
  /** Area = findings kept. */
  r: number;
  /** The dark centre: findings a claim uses. 0 = none. */
  core: number;
  kept: boolean;
  claims: readonly number[];
}

export interface Island {
  kind: string;
  /** Centre of its two head lines, and their top. */
  cx: number;
  top: number;
  path: string;
  sources: number;
  kept: number;
  used: number;
  discs: Disc[];
}

export interface Hub {
  n: number;
  x: number;
  y: number;
}

export interface Edge {
  claim: number;
  source: string;
  d: string;
  width: number;
}

export interface Lay {
  width: number;
  height: number;
  islands: Island[];
  hubs: Hub[];
  edges: Edge[];
}

type Pt = [number, number];
const HEAD = 32;
const GAP = 12;
const PAD = 11;
export const HUB_R = 10;

const radius = (kept: number) => (kept ? 4.5 + 2.4 * Math.sqrt(kept) : 5);

/** Largest first on a flat spiral: each disc takes the first free place. */
function pack(sources: readonly ResearchSource[], stretch: number): Disc[] {
  const out: Disc[] = [];
  const order = [...sources].sort((a, b) => b.findings.length - a.findings.length);
  for (const s of order) {
    const kept = s.findings.length;
    const used = usedOf(s);
    const r = radius(kept);
    let x = 0;
    let y = 0;
    for (let t = 0; t < 4000; t += 0.3) {
      x = Math.cos(t) * t * 2.1 * stretch;
      y = Math.sin(t) * t * 2.1;
      if (out.every((o) => Math.hypot(o.x - x, o.y - y) >= o.r + r + 5)) break;
    }
    out.push({
      id: s.id,
      x,
      y,
      r,
      core: used ? Math.max(3, r * Math.sqrt(used / kept)) : 0,
      kept: kept > 0,
      claims: [...new Set(s.findings.flatMap((f) => (f.claim === undefined ? [] : [f.claim])))],
    });
  }
  return out;
}

const cross = (o: Pt, a: Pt, b: Pt) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function hull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (list: Pt[]) => {
    const h: Pt[] = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2] as Pt, h[h.length - 1] as Pt, p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...half(pts), ...half(pts.reverse())];
}

/** One smooth outline round every disc of an island. */
function outline(discs: readonly Disc[]): { path: string; box: [number, number, number, number] } {
  const pts: Pt[] = [];
  for (const d of discs)
    for (let a = 0; a < 14; a++)
      pts.push([
        d.x + Math.cos((a * Math.PI) / 7) * (d.r + PAD),
        d.y + Math.sin((a * Math.PI) / 7) * (d.r + PAD),
      ]);
  const h = hull(pts);
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const f = (n: number) => n.toFixed(1);
  let path = "";
  h.forEach((p, i) => {
    const m = mid(p, h[(i + 1) % h.length] as Pt);
    path += i ? `Q${f(p[0])},${f(p[1])} ${f(m[0])},${f(m[1])}` : "";
  });
  const first = h[0] as Pt;
  const start = mid(first, h[1] as Pt);
  const end = `Q${f(first[0])},${f(first[1])} ${f(start[0])},${f(start[1])}Z`;
  const xs = h.map((p) => p[0]);
  const ys = h.map((p) => p[1]);
  return {
    path: `M${f(start[0])},${f(start[1])}${path}${end}`,
    box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
}

const moved = (path: string, dx: number, dy: number) =>
  path.replace(
    /(-?[\d.]+),(-?[\d.]+)/g,
    (_, x, y) => `${(+x + dx).toFixed(1)},${(+y + dy).toFixed(1)}`,
  );

export function layRun(run: ResearchRun, width: number): Lay {
  const hubsOn = run.claims.length > 0;
  const x0 = hubsOn ? 2 * HUB_R + 22 : 0;
  const room = Math.max(120, width - x0);
  const kinds = new Map<string, ResearchSource[]>();
  for (const s of run.sources) kinds.set(s.kind, [...(kinds.get(s.kind) ?? []), s]);
  const size = (v: readonly ResearchSource[]) => v.reduce((a, s) => a + s.findings.length, 0);
  const made = [...kinds.entries()]
    .sort((a, b) => size(b[1]) - size(a[1]))
    .map(([kind, v]) => {
      // as flat as its share of the width lets it be: a narrow card stacks, a wide one sits islands side by side
      const most = room < 360 ? room : room * 0.6;
      let discs = pack(v, 3);
      let line = outline(discs);
      for (const stretch of [2.4, 1.9, 1.5, 1.2, 0.9, 0.65, 0.45]) {
        if (line.box[2] - line.box[0] <= most) break;
        discs = pack(v, stretch);
        line = outline(discs);
      }
      const [bx0, by0, bx1, by1] = line.box;
      const kept = size(v);
      const used = v.reduce((a, s) => a + usedOf(s), 0);
      // the two head lines need their own room: about 6.4 px a letter
      const w = Math.min(room, Math.max(bx1 - bx0, kind.length * 7.2, 104));
      return {
        kind,
        discs,
        line,
        kept,
        used,
        n: v.length,
        w,
        h: by1 - by0,
        in: (w - (bx1 - bx0)) / 2,
      };
    });
  // shelf: islands side by side, a new row when the width is full
  const rows: { v: typeof made; w: number; h: number }[] = [];
  for (const c of made) {
    let row = rows.find((r) => r.w + GAP + c.w <= room);
    if (!row) {
      row = { v: [], w: -GAP, h: 0 };
      rows.push(row);
    }
    row.v.push(c);
    row.w += GAP + c.w;
    row.h = Math.max(row.h, c.h);
  }
  const islands: Island[] = [];
  const at = new Map<string, Disc>();
  let y = 6;
  for (const row of rows) {
    let x = x0 + (room - row.w) / 2;
    for (const c of row.v) {
      const dx = x + c.in - c.line.box[0];
      const dy = y + HEAD - c.line.box[1];
      const discs = c.discs.map((d) => ({ ...d, x: d.x + dx, y: d.y + dy }));
      for (const d of discs) at.set(d.id, d);
      islands.push({
        kind: c.kind,
        cx: x + c.w / 2,
        top: y,
        path: moved(c.line.path, dx, dy),
        sources: c.n,
        kept: c.kept,
        used: c.used,
        discs,
      });
      x += c.w + GAP;
    }
    y += HEAD + row.h + GAP;
  }
  const step = 2 * HUB_R + 8;
  const height = Math.max(y - GAP + 6, hubsOn ? run.claims.length * step + 12 : 0);
  // the claims stay one group, at the height of the sources they use
  const ys = [...at.values()].filter((d) => d.claims.length).map((d) => d.y);
  const mid = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : height / 2;
  const span = (run.claims.length - 1) * step;
  const first = Math.max(HUB_R + 6, Math.min(height - HUB_R - 6 - span, mid - span / 2));
  const hubs: Hub[] = run.claims.map((c, i) => ({ n: c.n, x: HUB_R + 2, y: first + i * step }));
  const edges: Edge[] = [];
  for (const h of hubs)
    for (const d of at.values()) {
      if (!d.claims.includes(h.n)) continue;
      const s = run.sources.find((q) => q.id === d.id);
      const n = s ? s.findings.filter((f) => f.claim === h.n).length : 1;
      const xa = h.x + HUB_R;
      const a = Math.atan2(h.y - d.y, xa - d.x);
      const r = d.core || d.r;
      const x1 = d.x + Math.cos(a) * r;
      const y1 = d.y + Math.sin(a) * r;
      const k = Math.hypot(x1 - xa, y1 - h.y) * 0.42;
      edges.push({
        claim: h.n,
        source: d.id,
        width: 0.9 + Math.min(n, 6) * 0.4,
        d: `M${xa},${h.y.toFixed(1)}C${(xa + k).toFixed(1)},${h.y.toFixed(1)} ${(x1 + Math.cos(a) * k * 0.55).toFixed(1)},${(y1 + Math.sin(a) * k * 0.55).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`,
      });
    }
  return { width, height, islands, hubs, edges };
}
