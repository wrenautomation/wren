/**
 * The query web (11-08): each search is a hub, its answer on the card; a source with findings
 * links to every search that found it. Any node opens in place into what it holds. Pure: keys,
 * children, edges and the solve. The stage measures and moves the DOM.
 * Keys: q search, s source, p page, n read pages with no finding, u pages not read, v one such
 * page, f finding, x its quote, d a search's dropped hits, h one dropped hit, m "N more".
 */
import { forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import { type Indexed, jit } from "./model.js";

export interface WebState {
  exp: ReadonlySet<string>;
  lift: ReadonlySet<number>;
  more: ReadonlyMap<string, number>;
  wide: boolean;
}

export const parse = (k: string): [string, number, number] => {
  const [a = 0, b = 0] = k.slice(1).split(".").map(Number);
  return [k[0] ?? "", a, b];
};
export const capOf = (wide: boolean) => (wide ? 8 : 6);
/** The leading run of one kind: only that run pages; other kinds always show. */
const runOf = (ks: readonly string[]) => {
  let i = 0;
  while (i < ks.length && ks[i]?.[0] === ks[0]?.[0]) i++;
  return i;
};

const KIDS = new WeakMap<Indexed, Map<string, readonly string[]>>();
/** What a node holds, in spawn order. Once per run index: every mark asks on every render. */
export function kids(L: Indexed, key: string): readonly string[] {
  const m = KIDS.get(L) ?? new Map<string, readonly string[]>();
  KIDS.set(L, m);
  const v = m.get(key) ?? kidsOf(L, key);
  m.set(key, v);
  return v;
}

function kidsOf(L: Indexed, key: string): string[] {
  if (key[0] === "m") return [];
  const [t, a, b] = parse(key);
  const src = () => L.byId.get(a)?.s;
  if (t === "s") {
    const s = src();
    if (!s) return [];
    const nf = (i: number) => s.fs.filter((f) => f.p === i).length;
    const out = s.pages
      .map((_, i) => i)
      .filter((i) => nf(i))
      .sort((x, y) => nf(y) - nf(x))
      .map((i) => `p${a}.${i}`);
    if (s.pages.some((_, i) => !nf(i))) out.push(`n${a}`);
    if (s.unread.length) out.push(`u${a}`);
    return out;
  }
  if (t === "p")
    return (src()?.fs ?? []).map((f, fi) => (f.p === b ? `f${a}.${fi}` : "")).filter(Boolean);
  if (t === "n") {
    const s = src();
    return s
      ? s.pages.map((_, i) => (s.fs.some((f) => f.p === i) ? "" : `p${a}.${i}`)).filter(Boolean)
      : [];
  }
  if (t === "u") return (src()?.unread ?? []).map((_, i) => `v${a}.${i}`);
  if (t === "f") return src()?.fs[b]?.q ? [`x${a}.${b}`] : [];
  // sources with findings are on the map already, as spokes
  if (t === "q")
    return [
      ...(L.byQ.get(a)?.ss ?? []).filter((id) => !L.byId.get(id)?.s.kept).map((id) => `s${id}`),
      ...((L.drops.get(a) ?? []).length ? [`d${a}`] : []),
    ];
  if (t === "d") return (L.drops.get(a) ?? []).map((i) => `h${i}`);
  return [];
}

function shown(L: Indexed, st: WebState, k: string) {
  const ks = kids(L, k);
  const r = runOf(ks);
  const lim = st.more.get(k) ?? capOf(st.wide);
  return r > lim ? [...ks.slice(0, lim), `m${k}`, ...ks.slice(r)] : ks;
}
export const leftOf = (L: Indexed, st: WebState, k: string) =>
  runOf(kids(L, k)) - (st.more.get(k) ?? capOf(st.wide));

/** The nodes on the map: every search, every source with a finding, plus what each open node holds, breadth first. */
export function presentSet(L: Indexed, st: WebState) {
  const base = [
    ...L.run.searches.map((q) => `q${q.i}`),
    ...L.rank.filter((n) => n.s.kept || st.lift.has(n.id)).map((n) => `s${n.id}`),
  ];
  const par = new Map<string, string | null>(base.map((k) => [k, null]));
  const order = [...base];
  for (let i = 0; i < order.length; i++) {
    const k = order[i] as string;
    if (st.exp.has(k))
      for (const c of shown(L, st, k))
        if (!par.has(c)) {
          par.set(c, k);
          order.push(c);
        }
  }
  // open nodes whose parent closed go too
  const exp = new Set([...st.exp].filter((k) => par.has(k)));
  const more = new Map([...st.more].filter(([k]) => exp.has(k)));
  return { order, par, exp, more };
}

export type EdgeKind = "hub" | "tree" | "via" | "found";
export interface WebEdge {
  id: string;
  a: string;
  b: string;
  kind: EdgeKind;
  w: number;
  tree: boolean;
  /** speaker, on hub edges */
  k?: string | undefined;
}

/** The edges are derived from what is on the map, never stored per open node. */
export function webEdges(L: Indexed, order: string[], par: Map<string, string | null>) {
  const on = new Set(order);
  const E: WebEdge[] = [];
  const add = (a: string | null | undefined, b: string, kind: EdgeKind, w = 0) => {
    if (!a || !on.has(a) || !on.has(b)) return;
    E.push({
      id: `${a}|${b}|${kind}`,
      a,
      b,
      kind,
      w,
      tree: par.get(b) === a || par.get(a) === b,
    });
  };
  for (const k of order) {
    const [t, a, b] = parse(k);
    const s = L.byId.get(a)?.s;
    if (t === "s" && s)
      for (const qi of L.reach.get(a) ?? []) {
        const q = `q${qi}`;
        const n = E.length;
        add(q, k, s.kept ? "hub" : par.get(k) === q ? "tree" : "found", s.kept);
        const e = E[n];
        if (e?.kind === "hub") e.k = L.byId.get(a)?.k;
      }
    else if (t === "p") add(par.get(k) || `s${a}`, k, "tree");
    else if (t === "n" || t === "u") add(`s${a}`, k, "tree");
    else if (t === "v") add(`u${a}`, k, "tree");
    else if (t === "f" && s) {
      const f = s.fs[b];
      if (!f) continue;
      const pk = `p${a}.${f.p}`;
      add(on.has(pk) ? pk : `s${a}`, k, on.has(pk) ? "tree" : "via");
    } else if (t === "x") add(`f${a}.${b}`, k, "tree");
    else if (t === "d") add(`q${a}`, k, "tree");
    else if (t === "h" || t === "m") add(par.get(k), k, "tree");
  }
  return E;
}

/** A node on the map. hold: 2 never moves (the clicked node), true gives way a tenth as much. */
export interface WNode {
  key: string;
  w: number;
  h: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  ax: number | null;
  ay: number | null;
  hold: boolean | 2;
  free: boolean;
}

const diag = (o: { w: number; h: number }) => Math.hypot(o.w, o.h);

export function webBox(os: Iterable<WNode>) {
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  for (const o of os) {
    x0 = Math.min(x0, o.x - o.w / 2);
    y0 = Math.min(y0, o.y - o.h / 2);
    x1 = Math.max(x1, o.x + o.w / 2);
    y1 = Math.max(y1, o.y + o.h / 2);
  }
  return { x0, y0, x1, y1 };
}

/**
 * Rectangles push apart along their shallow axis. Returns the hits it found. A grid of the
 * largest box: two that overlap sit in the same or a next cell, so a node meets only its
 * neighbours. A pass that moves nothing ran on a fresh grid, so its 0 is exact.
 */
export function rectCollide(ns: WNode[], pad: number) {
  const cell = new Map<number, number[]>();
  const push = (a: WNode, b: WNode) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ox = (a.w + b.w) / 2 + pad - Math.abs(dx);
    const oy = (a.h + b.h) / 2 + pad - Math.abs(dy);
    // under half a pixel is a touch: float error would count it forever
    if (ox <= 0.5 || oy <= 0.5) return 0;
    const wa = a.hold === 2 ? 0 : a.hold ? 0.1 : 1;
    const wb = b.hold === 2 ? 0 : b.hold ? 0.1 : 1;
    const sw = wa + wb || 2;
    const fa = (wa || (sw === 2 ? 1 : 0)) / sw;
    const fb = (wb || (sw === 2 ? 1 : 0)) / sw;
    if (ox < oy) {
      // a pixel past touching: a crowd parts in far fewer passes
      const m = (ox + 1) * (dx < 0 ? -1 : 1);
      a.x -= m * fa;
      b.x += m * fb;
    } else {
      const m = (oy + 1) * (dy < 0 ? -1 : 1);
      a.y -= m * fa;
      b.y += m * fb;
    }
    return 1;
  };
  const f = () => {
    let cw = 1;
    let ch = 1;
    for (const n of ns) {
      cw = Math.max(cw, n.w + pad);
      ch = Math.max(ch, n.h + pad);
    }
    cell.clear();
    // cells within ±2^20 of the origin: far past any web
    const at = (gx: number, gy: number) => (gx + 1048576) * 2097152 + gy + 1048576;
    const gx = new Int32Array(ns.length);
    const gy = new Int32Array(ns.length);
    ns.forEach((n, i) => {
      gx[i] = Math.floor(n.x / cw);
      gy[i] = Math.floor(n.y / ch);
      const k = at(gx[i] as number, gy[i] as number);
      const c = cell.get(k);
      if (c) c.push(i);
      else cell.set(k, [i]);
    });
    let hit = 0;
    for (let i = 0; i < ns.length; i++)
      for (let ox = -1; ox <= 1; ox++)
        for (let oy = -1; oy <= 1; oy++)
          for (const j of cell.get(at((gx[i] as number) + ox, (gy[i] as number) + oy)) ?? [])
            if (j > i) hit += push(ns[i] as WNode, ns[j] as WNode);
    return hit;
  };
  // d3 calls a force with alpha; the collide ignores it
  return Object.assign(f, { initialize: () => {} });
}

/** Push apart what still overlaps; held nodes give way last. */
export function settle(all: WNode[], wide: boolean) {
  const rc = rectCollide(all, wide ? 16 : 12);
  let pass = 0;
  while (pass++ < 300 && rc());
  // still stuck between held nodes: everyone gives way evenly
  if (pass > 300) {
    for (const n of all) n.hold = false;
    pass = 0;
    while (pass++ < 800 && rc());
  }
}

type Places = Map<string, readonly [number, number]>;
// `${run}|${wide}|${order}` → places, oldest first; LAST: each run and width's newest key
const SOLVED = new Map<string, Places>();
const LAST = new Map<string, string>();
const KEEP = 48;

/**
 * Where a run's web was last solved, across mounts: the same run, width and nodes come back as
 * they were (exact); else its newest places, as anchors for what is new (a live run grows).
 */
export function placesOf(run: string, wide: boolean, order: readonly string[]) {
  const hit = SOLVED.get(`${run}|${wide}|${order.join(" ")}`);
  if (hit) return { at: hit, exact: true };
  const last = LAST.get(`${run}|${wide}`);
  const at = last ? SOLVED.get(last) : undefined;
  return at ? { at, exact: false } : null;
}

/** Keeps a copy of each place: the nodes move on (tween, next solve) and must not drag it. */
export function keepPlaces(
  run: string,
  wide: boolean,
  order: readonly string[],
  N: ReadonlyMap<string, WNode>,
) {
  const k = `${run}|${wide}|${order.join(" ")}`;
  SOLVED.delete(k);
  SOLVED.set(k, new Map([...N].map(([key, n]) => [key, [n.x, n.y] as const])));
  LAST.set(`${run}|${wide}`, k);
  for (const old of SOLVED.keys()) {
    if (SOLVED.size <= KEEP) break;
    SOLVED.delete(old);
  }
}

export interface SolveIn {
  L: Indexed;
  N: Map<string, WNode>;
  order: string[];
  par: Map<string, string | null>;
  E: WebEdge[];
  /** new nodes, measured, not yet placed */
  fresh: Set<WNode>;
  anim: boolean;
  /** the node opened or closed */
  fk: string | null;
  wide: boolean;
  /** where a shelf chip was, for a lifted source */
  shelfAt: Map<string, [number, number]>;
}

/**
 * Lay out the web. With anim, old nodes stay near their places: only those near the opened node
 * make room, sized to what it adds; the rest hold still. Solved off screen; returns each node's
 * start and end, so the stage moves each one once.
 */
export function solveWeb(o: SolveIn) {
  const { L, N, order, par, E, fresh, anim, fk, wide } = o;
  const old = [...N.values()].filter((n) => !fresh.has(n));
  const B0 = old.length ? webBox(old) : { x0: 0, y0: 0, x1: 0, y1: 0 };
  const cx0 = (B0.x0 + B0.x1) / 2;
  const cy0 = (B0.y0 + B0.y1) / 2;
  const nq = L.run.searches.length;
  const ax = wide ? 1.5 : 0.7;
  // several runs: each linked group solves alone, then the groups pack in run order
  const groups = !anim && L.run.runs ? linked(order, E) : null;
  const ring = new Map<string, readonly [number, number]>();
  const lay = (cs: readonly string[], at: (k: string, j: number) => number) => {
    const R = 90 * Math.sqrt(cs.length);
    cs.forEach((k, j) => {
      const a = at(k, j) * Math.PI * 2 - Math.PI / 2;
      ring.set(k, [Math.cos(a) * R * ax, Math.sin(a) * R]);
    });
  };
  if (groups)
    for (const g of groups) {
      const qs = g.filter((k) => k[0] === "q");
      lay(qs, (_, j) => j / qs.length);
    }
  else
    lay(
      L.run.searches.map((q) => `q${q.i}`),
      (_, j) => j / nq,
    );
  order.forEach((k, i) => {
    const n = N.get(k) as WNode;
    if (!fresh.has(n)) {
      n.ax = anim ? n.x : null;
      n.ay = anim ? n.y : null;
      return;
    }
    const pk = par.get(k);
    const p = pk ? N.get(pk) : undefined;
    if (p && pk) {
      const sib = kids(L, pk);
      const at = sib.indexOf(k);
      const j = at < 0 ? sib.length : at;
      const m = Math.max(sib.length, 1);
      const out =
        Math.hypot(p.x - cx0, p.y - cy0) > 20 ? Math.atan2(p.y - cy0, p.x - cx0) : i * 2.4;
      const a = out + (j - (m - 1) / 2) * Math.min(0.55, 2.8 / m);
      const rr = (diag(p) + diag(n)) * 0.36 + 26;
      n.x = p.x + Math.cos(a) * rr;
      n.y = p.y + Math.sin(a) * rr;
    } else if (k[0] === "q") {
      [n.x, n.y] = ring.get(k) ?? [0, 0];
    } else {
      // a spoke starts between the searches that found it
      const cs = (L.reach.get(+k.slice(1)) ?? [])
        .map((qi) => N.get(`q${qi}`))
        .filter((q): q is WNode => !!q);
      const was = o.shelfAt.get(k);
      if (cs.length) {
        n.x = cs.reduce((s, q) => s + q.x, 0) / cs.length + jit(i) * 60;
        n.y = cs.reduce((s, q) => s + q.y, 0) / cs.length + jit(i + 99) * 60;
      } else if (was) {
        [n.x, n.y] = was;
      } else {
        n.x = cx0 + jit(i) * 200;
        n.y = B0.y1 + 60;
      }
    }
  });
  const all = order.map((k) => N.get(k) as WNode);
  // tween start: old nodes where they are, new ones at their parent's spot
  const from = new Map<WNode, [number, number]>();
  for (const n of all) {
    const pk = par.get(n.key);
    const p = fresh.has(n) && pk ? N.get(pk) : undefined;
    const f = p ? from.get(p) : undefined;
    from.set(n, fresh.has(n) ? (f ? [f[0], f[1]] : p ? [p.x, p.y] : [n.x, n.y]) : [n.x, n.y]);
  }
  const links: Link[] = E.map((e) => ({
    source: N.get(e.a) as WNode,
    target: N.get(e.b) as WNode,
    e,
  }));
  // a spoke found by many searches: each pull weaker, so it settles between them
  const hubsOf = (e: WebEdge) => L.reach.get(+e.b.slice(1))?.length ?? 1;
  const dist = (l: Link) => {
    const d = diag(l.source) + diag(l.target);
    return l.e.kind === "hub" ? 30 + d * 0.32 : l.e.tree ? 14 + d * 0.3 : 60 + d * 0.36;
  };
  const strength = (l: Link) =>
    l.e.kind === "hub" ? 0.5 / Math.min(hubsOf(l.e), 3) : l.e.tree ? 0.7 : 0.03;
  const P = fk ? N.get(fk) : undefined;
  if (anim) {
    const need =
      P && fresh.size
        ? Math.sqrt([...fresh].reduce((s, n) => s + n.w * n.h, 0) / Math.PI) * 1.6 +
          diag(P) / 2 +
          60
        : 0;
    for (const n of all)
      if (!fresh.has(n)) {
        n.free = !!P && n !== P && Math.hypot(n.x - P.x, n.y - P.y) < need;
        if (!n.free) {
          n.fx = n.x;
          n.fy = n.y;
          n.hold = true;
        }
      }
    if (P) P.hold = 2;
  }
  if (groups) {
    const gi = new Map(groups.flatMap((g, j) => g.map((k) => [k, j] as const)));
    const parts = groups.map((g) => g.map((k) => N.get(k) as WNode));
    for (const [j, ns] of parts.entries())
      simulate(
        ns,
        links.filter((l) => gi.get(l.e.a) === j),
        { dist, strength, wide, anim },
      );
    pack(parts, wide);
    // a phone stays one column: there the pull's repulsion widens it past the fit
    if (wide) compact(parts, links, { dist, strength });
  } else simulate(all, links, { dist, strength, wide, anim });
  for (const n of all) {
    n.fx = null;
    n.fy = null;
  }
  settle(all, wide);
  for (const n of all) {
    n.ax = null;
    n.ay = null;
    n.vx = 0;
    n.vy = 0;
    n.free = false;
    n.hold = false;
  }
  const to = new Map(all.map((n) => [n, [n.x, n.y] as [number, number]]));
  return { all, from, to };
}

type Link = { source: WNode; target: WNode; e: WebEdge };
interface SimOpt {
  dist: (l: Link) => number;
  strength: (l: Link) => number;
  wide: boolean;
  anim: boolean;
}

function simulate(all: WNode[], links: Link[], o: SimOpt) {
  const { dist, strength, wide, anim } = o;
  const pad = wide ? 16 : 12;
  const sim = forceSimulation(all)
    .force("l", forceLink<WNode, Link>(links).distance(dist).strength(strength))
    .force("q", repel())
    .force("x", forceX<WNode>(0).strength(wide ? 0.035 : 0.09))
    .force("y", forceY<WNode>(0).strength(wide ? 0.07 : 0.03))
    .force(
      "ax",
      forceX<WNode>((n) => n.ax ?? 0).strength((n) => (n.ax != null ? 0.12 : 0)),
    )
    .force(
      "ay",
      forceY<WNode>((n) => n.ay ?? 0).strength((n) => (n.ay != null ? 0.12 : 0)),
    )
    .force("r", rectCollide(all, pad))
    .stop();
  sim.alpha(anim ? 0.5 : 1);
  // 300 from alpha 1 is d3's own end (alphaMin); past it nothing moves a pixel
  for (let i = 0; i < (anim ? 220 : 300); i++) sim.tick();
}

const repel = () =>
  forceManyBody<WNode>()
    .strength((n) => ("qs".includes(n.key[0] ?? "") ? -260 : -110))
    .distanceMax(600);

/**
 * Draw the packed groups together: the pull acts on each group's middle, so a group moves as
 * one and keeps its shape; the usual forces still hold each group's nodes apart.
 */
export function compact(parts: WNode[][], links: Link[], o: Pick<SimOpt, "dist" | "strength">) {
  const { dist, strength } = o;
  const all = parts.flat();
  const pull = (alpha: number) => {
    for (const g of parts) {
      let cx = 0;
      let cy = 0;
      for (const n of g) {
        cx += n.x;
        cy += n.y;
      }
      const k = alpha * 0.04;
      // harder up and down: the room is wider than tall
      const dx = (-cx / g.length) * k;
      const dy = (-cy / g.length) * k * 1.4;
      for (const n of g) {
        n.vx = (n.vx ?? 0) + dx;
        n.vy = (n.vy ?? 0) + dy;
      }
    }
  };
  const sim = forceSimulation(all)
    .force("l", forceLink<WNode, Link>(links).distance(dist).strength(strength))
    .force("q", repel())
    .force("g", pull)
    .force("r", rectCollide(all, 16))
    .stop();
  sim.alpha(0.5);
  for (let i = 0; i < 160; i++) sim.tick();
}

/** Keys joined by edges, as groups; the group with the lowest run's search comes first. */
export function linked(order: readonly string[], E: readonly WebEdge[]) {
  const up = new Map(order.map((k) => [k, k]));
  const root = (k: string): string => {
    const p = up.get(k) ?? k;
    if (p === k) return k;
    const r = root(p);
    up.set(k, r);
    return r;
  };
  for (const e of E) up.set(root(e.a), root(e.b));
  const by = new Map<string, string[]>();
  for (const k of order) {
    const r = root(k);
    by.set(r, [...(by.get(r) ?? []), k]);
  }
  // search keys are numbered in run order; a group with no search goes last
  const first = (g: string[]) => Math.min(...g.filter((k) => k[0] === "q").map((k) => +k.slice(1)));
  return [...by.values()].sort((a, b) => first(a) - first(b));
}

/**
 * Groups in run order, each at the lowest spot it fits under a width (skyline packing); of the
 * widths tried, the one whose box is small and nearest the room's shape wins.
 */
export function pack(parts: WNode[][], wide: boolean) {
  const gap = wide ? 48 : 36;
  // the room's shape, and the widest the fit still reads at its zoom floor (graph.tsx fitView)
  const aim = wide ? 1.2 : 0.6;
  const cap = wide ? 1600 : 900;
  const bs = parts.map((p) => {
    const b = webBox(p);
    return { b, w: b.x1 - b.x0 + gap, h: b.y1 - b.y0 + gap };
  });
  const at = (W: number) => {
    // the skyline: [x0, x1, top] runs, left to right
    let sky: [number, number, number][] = [[0, W, 0]];
    const xy = bs.map(({ w, h }) => {
      let best = { x: 0, y: Infinity };
      for (const [x] of sky) {
        if (x + w > W + 0.5 && x > 0) continue;
        let y = 0;
        for (const [a, b, t] of sky) if (a < x + w && b > x) y = Math.max(y, t);
        if (y < best.y) best = { x, y };
      }
      const { x, y } = best;
      const cut: [number, number, number][] = [];
      for (const [a, b, t] of sky) {
        if (b <= x || a >= x + w) cut.push([a, b, t]);
        else {
          if (a < x) cut.push([a, x, t]);
          if (b > x + w) cut.push([x + w, b, t]);
        }
      }
      cut.push([x, x + w, y + h]);
      sky = cut.sort((p, q) => p[0] - q[0]);
      return best;
    });
    const w = Math.max(...xy.map((p, j) => p.x + (bs[j]?.w ?? 0))) - gap;
    const h = Math.max(...xy.map((p, j) => p.y + (bs[j]?.h ?? 0))) - gap;
    // area, times how far the shape is off the aim
    const off = Math.max(w / h / aim, aim / (w / h));
    return { xy, w, h, score: w * h * off };
  };
  const lo = Math.max(...bs.map((b) => b.w));
  const hi = Math.max(
    lo,
    Math.min(
      cap,
      bs.reduce((s, b) => s + b.w, 0),
    ),
  );
  let best = at(lo);
  for (let i = 1; i <= 24; i++) {
    const t = at(lo + ((hi - lo) * i) / 24);
    if (t.score < best.score) best = t;
  }
  best.xy.forEach(({ x, y }, j) => {
    const { b } = bs[j] as (typeof bs)[number];
    const dx = x - best.w / 2 - b.x0;
    const dy = y - best.h / 2 - b.y0;
    for (const n of parts[j] as WNode[]) {
      n.x += dx;
      n.y += dy;
    }
  });
}
