/**
 * The search tree, the lanes and the web's shelf: what each shows (at render) and where it goes
 * (once measured). Ported from the artifact's layTree, layLanes and buildShelf.
 */
import { f1, type GNode, type Indexed, SPEAKER_ORDER, type Speaker } from "./model.js";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Size = (key: string) => { w: number; h: number };

/** Lay a list into rows of a set width; returns where they end. */
export function flow(
  keys: string[],
  size: Size,
  at: Map<string, Box>,
  x0: number,
  y0: number,
  w: number,
  gx: number,
  gy: number,
) {
  let x = x0;
  let y = y0;
  let rh = 0;
  for (const k of keys) {
    const s = size(k);
    if (x > x0 && x + s.w > x0 + w) {
      x = x0;
      y += rh + gy;
      rh = 0;
    }
    at.set(k, { x, y, ...s });
    x += s.w + gx;
    rh = Math.max(rh, s.h);
  }
  return y + rh;
}

export interface FlatEdge {
  id: string;
  a: string;
  b: string;
  t: "elbow" | "stub" | "curve";
  /** search, -1 for the root's */
  q?: number;
  qs?: number[];
  /** source and claim, on lanes */
  s?: number;
  c?: number;
  w?: number | undefined;
  k?: Speaker;
}

export function flatPath(e: FlatEdge, A: Box, B: Box) {
  if (e.t === "stub") {
    const y1 = A.y + Math.min(A.h, B.h) / 2;
    return `M${f1(A.x + A.w)},${f1(y1)}L${f1(B.x)},${f1(y1)}`;
  }
  const x1 = A.x + A.w;
  const y1 = A.y + A.h / 2;
  const x2 = B.x;
  const y2 = B.y + B.h / 2;
  const m = (x1 + x2) / 2;
  return `M${f1(x1)},${f1(y1)}C${f1(m)},${f1(y1)} ${f1(m)},${f1(y2)} ${f1(x2)},${f1(y2)}`;
}

// 2. search tree: run, rounds, searches; each search ends in the sources it found first
export interface TreeRow {
  r: number;
  qs: { i: number; mine: GNode[]; cut: number; again: number; open: boolean }[];
}
export function treeOf(L: Indexed, open: ReadonlySet<string>): TreeRow[] {
  const own = new Map<number, number>();
  const qs = L.run.searches.slice().sort((a, b) => a.r - b.r || a.i - b.i);
  for (const q of qs) for (const id of q.ss) if (!own.has(id)) own.set(id, q.i);
  return L.rounds
    .map((r) => ({
      r,
      qs: qs
        .filter((q) => q.r === r)
        .map((q) => {
          const mine = q.ss
            .map((id) => L.byId.get(id))
            .filter((n): n is GNode => !!n && own.get(n.id) === q.i)
            .sort((a, b) => a.rank - b.rank);
          const o = open.has(`q${q.i}`);
          return {
            i: q.i,
            mine,
            cut: o ? mine.length : 3,
            again: q.ss.length - mine.length,
            open: o,
          };
        }),
    }))
    .filter((row) => row.qs.length);
}
export function treeEdges(rows: TreeRow[]): FlatEdge[] {
  const E: FlatEdge[] = [];
  for (const row of rows) {
    for (const o of row.qs) {
      E.push({ id: `r${row.r}|q${o.i}`, a: `rd${row.r}`, b: `q${o.i}`, q: o.i, t: "elbow" });
      // the cluster shows a chip, "more", "found before" or "kept no hit": always something
      E.push({ id: `q${o.i}|cl`, a: `q${o.i}`, b: `cl${o.i}`, q: o.i, t: "stub" });
    }
    E.push({
      id: `rt|r${row.r}`,
      a: "rt",
      b: `rd${row.r}`,
      q: -1,
      qs: row.qs.map((o) => o.i),
      t: "elbow",
    });
  }
  return E;
}
export function layTree(rows: TreeRow[], size: Size) {
  const at = new Map<string, Box>();
  const root = size("rt");
  const xr = root.w + 40;
  const xq = xr + Math.max(0, ...rows.map((r) => size(`rd${r.r}`).w)) + 40;
  const qw = Math.max(0, ...rows.flatMap((r) => r.qs.map((o) => size(`q${o.i}`).w)));
  const xc = xq + qw + 28;
  let y = 0;
  for (const row of rows) {
    const y0 = y;
    for (const o of row.qs) {
      const qe = size(`q${o.i}`);
      const cl = size(`cl${o.i}`);
      at.set(`q${o.i}`, { x: xq, y, ...qe });
      at.set(`cl${o.i}`, { x: xc, y, ...cl });
      y += Math.max(qe.h, cl.h) + 10;
    }
    const re = size(`rd${row.r}`);
    at.set(`rd${row.r}`, { x: xr, y: (y0 + y - 10) / 2 - re.h / 2, ...re });
    y += 22;
  }
  at.set("rt", { x: 0, y: 0, ...root });
  return at;
}

// 3. lanes: one lane per speaker, claims on the right, curves between
export interface Lane {
  k: Speaker;
  ns: GNode[];
  linked: GNode[];
  rest: GNode[];
  quiet: GNode[];
  open: boolean;
}
export function lanesOf(L: Indexed, open: ReadonlySet<string>): Lane[] {
  return SPEAKER_ORDER.filter((k) => L.nodes.some((n) => n.k === k)).map((k) => {
    const ns = L.rank.filter((n) => n.k === k);
    return {
      k,
      ns,
      linked: ns.filter((n) => n.nc),
      rest: ns.filter((n) => !n.nc && n.s.kept),
      quiet: ns.filter((n) => !n.s.kept),
      open: open.has(`k${k}`),
    };
  });
}
export function laneEdges(lanes: Lane[]): FlatEdge[] {
  return lanes.flatMap((ln) =>
    ln.linked.flatMap((n) =>
      Object.keys(n.s.claims).map((c) => ({
        id: `s${n.id}|c${c}`,
        a: `s${n.id}`,
        b: `c${c}`,
        s: n.id,
        c: +c,
        w: n.s.claims[+c],
        k: n.k,
        t: "curve" as const,
      })),
    ),
  );
}
export function layLanes(L: Indexed, lanes: Lane[], size: Size, wide: boolean) {
  const at = new Map<string, Box>();
  const fw = wide ? 300 : 230;
  let y = 0;
  let colW = wide ? 240 : 200;
  for (const ln of lanes) {
    const lb = size(`lb${ln.k}`);
    at.set(`lb${ln.k}`, { x: 0, y, ...lb });
    y += lb.h + 6;
    for (const n of ln.linked) {
      const s = size(`s${n.id}`);
      at.set(`s${n.id}`, { x: 0, y, ...s });
      colW = Math.max(colW, s.w);
      y += s.h + 6;
    }
    if (ln.rest.length) {
      if (ln.open) {
        y =
          flow(
            ln.rest.map((n) => `s${n.id}`),
            size,
            at,
            0,
            y,
            fw,
            5,
            5,
          ) + 6;
        at.set(`mo${ln.k}`, { x: 0, y, ...size(`mo${ln.k}`) });
        y += 28;
      } else {
        const m = size(`mo${ln.k}`);
        at.set(`mo${ln.k}`, { x: 0, y, ...m });
        y += m.h + 6;
      }
    }
    if (ln.quiet.length)
      y =
        flow(
          ln.quiet.map((n) => `s${n.id}`),
          size,
          at,
          0,
          y + 2,
          fw,
          5,
          5,
        ) + 6;
    y += 22;
  }
  const xc = colW + (wide ? 220 : 90);
  const C = L.claims
    .map((c) => {
      const s = size(`c${c.i}`);
      const ys = c.ss
        .map((n) => at.get(`s${n.id}`))
        .filter((b): b is Box => !!b)
        .map((b) => b.y + b.h / 2);
      return { i: c.i, s, by: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : y, y: 0 };
    })
    .sort((a, b) => a.by - b.by);
  // each claim at its sources' mean height: a top-down pass, then a bottom-up pass, never overlapping
  let cy = -1e9;
  for (const o of C) {
    o.y = Math.max(cy, o.by - o.s.h / 2);
    cy = o.y + o.s.h + 12;
  }
  let lim = Math.max(y - 22, cy - 12);
  for (let i = C.length - 1; i >= 0; i--) {
    const o = C[i];
    if (!o) continue;
    o.y = Math.min(o.y, lim - o.s.h);
    lim = o.y - 12;
  }
  for (const o of C) at.set(`c${o.i}`, { x: xc, y: o.y, ...o.s });
  return at;
}

// the shelf: sources not on the web, by speaker; it rides below the web as the web grows
export interface Shelf {
  rest: { k: Speaker; ns: GNode[] }[];
  restN: number;
  restF: number;
  quiet: { t: string; ns: GNode[]; id: "rd" | "gh" }[];
}
export function shelfOf(L: Indexed, on: (id: number) => boolean): Shelf {
  const rest = L.rank.filter((n) => !n.nc && n.s.kept && !on(n.id));
  const quiet = L.nodes.filter((n) => !n.s.kept && !on(n.id));
  return {
    rest: SPEAKER_ORDER.map((k) => ({ k, ns: rest.filter((n) => n.k === k) })).filter(
      (g) => g.ns.length,
    ),
    restN: rest.length,
    restF: rest.reduce((s, n) => s + n.s.kept, 0),
    quiet: (
      [
        { t: "Read, no finding", ns: quiet.filter((n) => n.s.pages.length), id: "rd" },
        { t: "Kept, not read", ns: quiet.filter((n) => !n.s.pages.length), id: "gh" },
      ] as const
    )
      .filter((g) => g.ns.length)
      .map((g) => ({ ...g, ns: [...g.ns] })),
  };
}
/** Where each shelf mark sits, from the shelf's top left. */
export function layShelf(sh: Shelf, size: Size, wide: boolean) {
  const at = new Map<string, Box>();
  const sw = wide ? 900 : 330;
  let y = 0;
  if (sh.restN) {
    at.set("shb", { x: 0, y, ...size("shb") });
    y += 34;
    for (const g of sh.rest) {
      const lb = size(`shk${g.k}`);
      at.set(`shk${g.k}`, { x: 0, y, ...lb });
      y =
        flow(
          g.ns.map((n) => `sh${n.id}`),
          size,
          at,
          0,
          y + lb.h + 4,
          sw,
          6,
          6,
        ) + 14;
    }
  }
  let x = 0;
  for (const g of sh.quiet) {
    const lb = size(`shq${g.id}`);
    at.set(`shq${g.id}`, { x, y, ...lb });
    const w = Math.max(lb.w, Math.min(sw / 2 - 20, g.ns.length * 17));
    const yy = flow(
      g.ns.map((n) => `sh${n.id}`),
      size,
      at,
      x,
      y + lb.h + 6,
      w,
      5,
      5,
    );
    x += w + 40;
    if (x > sw - 60) {
      x = 0;
      y = yy + 14;
    }
  }
  return at;
}
