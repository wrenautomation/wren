/**
 * The claim web (round 13): claims and the sources that back them; any node opens in place into
 * what it holds. Pure: keys, children, edges and the solve. The stage measures and moves the DOM.
 * Keys: c claim, s source, p page, n read pages with no finding, u pages not read, v one such
 * page, f finding, x its quote, q search, d its dropped hits, h one dropped hit, m "N more".
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
const runOf = (ks: string[]) => {
  let i = 0;
  while (i < ks.length && ks[i]?.[0] === ks[0]?.[0]) i++;
  return i;
};

/** What a node holds, in spawn order. */
export function kids(L: Indexed, key: string): string[] {
  if (key[0] === "m") return [];
  const [t, a, b] = parse(key);
  const src = () => L.byId.get(a)?.s;
  if (t === "c")
    return (L.claims[a]?.ss ?? []).flatMap((n) =>
      n.s.fs.map((f, fi) => (f.c === a ? `f${n.id}.${fi}` : "")).filter(Boolean),
    );
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
    for (const qi of L.reach.get(a) ?? []) out.push(`q${qi}`);
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
  if (t === "q")
    return [
      ...(L.byQ.get(a)?.ss ?? []).map((id) => `s${id}`),
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

/** The nodes on the map: the base, plus what each open node holds, breadth first. */
export function presentSet(L: Indexed, st: WebState) {
  const base = [
    ...L.claims.map((c) => `c${c.i}`),
    ...L.rank.filter((n) => n.nc || st.lift.has(n.id)).map((n) => `s${n.id}`),
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

export type EdgeKind = "claim" | "tree" | "backs" | "via" | "found";
export interface WebEdge {
  id: string;
  a: string;
  b: string;
  kind: EdgeKind;
  w: number;
  tree: boolean;
  /** speaker, on claim edges */
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
      for (const c of Object.keys(s.claims)) {
        add(k, `c${c}`, "claim", s.claims[+c]);
        const e = E[E.length - 1];
        if (e?.kind === "claim" && e.a === k) e.k = L.byId.get(a)?.k;
      }
    else if (t === "p") add(par.get(k) || `s${a}`, k, "tree");
    else if (t === "n" || t === "u") add(`s${a}`, k, "tree");
    else if (t === "v") add(`u${a}`, k, "tree");
    else if (t === "f" && s) {
      const f = s.fs[b];
      if (!f) continue;
      const pk = `p${a}.${f.p}`;
      add(on.has(pk) ? pk : `s${a}`, k, on.has(pk) ? "tree" : "via");
      if (f.c >= 0) add(k, `c${f.c}`, "backs");
    } else if (t === "x") add(`f${a}.${b}`, k, "tree");
    else if (t === "q")
      for (const id of L.byQ.get(a)?.ss ?? [])
        add(k, `s${id}`, par.get(k) === `s${id}` || par.get(`s${id}`) === k ? "tree" : "found");
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

export const diag = (o: { w: number; h: number }) => Math.hypot(o.w, o.h);

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

/** Rectangles push apart along their shallow axis. Returns the hits it found. */
export function rectCollide(ns: WNode[], pad: number) {
  const f = () => {
    let hit = 0;
    for (let i = 0; i < ns.length; i++)
      for (let j = i + 1; j < ns.length; j++) {
        const a = ns[i] as WNode;
        const b = ns[j] as WNode;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const ox = (a.w + b.w) / 2 + pad - Math.abs(dx);
        const oy = (a.h + b.h) / 2 + pad - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        hit++;
        const wa = a.hold === 2 ? 0 : a.hold ? 0.1 : 1;
        const wb = b.hold === 2 ? 0 : b.hold ? 0.1 : 1;
        const sw = wa + wb || 2;
        const fa = (wa || (sw === 2 ? 1 : 0)) / sw;
        const fb = (wb || (sw === 2 ? 1 : 0)) / sw;
        if (ox < oy) {
          const m = ox * (dx < 0 ? -1 : 1);
          a.x -= m * fa;
          b.x += m * fb;
        } else {
          const m = oy * (dy < 0 ? -1 : 1);
          a.y -= m * fa;
          b.y += m * fb;
        }
      }
    return hit;
  };
  // d3 calls a force with alpha; the collide ignores it
  return Object.assign(f, { initialize: () => {} });
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
  const nc = L.claims.length;
  const R = 90 * Math.sqrt(nc);
  const ax = wide ? 1.5 : 0.7;
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
    } else if (k[0] === "c") {
      const a = (+k.slice(1) / nc) * Math.PI * 2 - Math.PI / 2;
      n.x = Math.cos(a) * R * ax;
      n.y = Math.sin(a) * R;
    } else {
      const g = L.byId.get(+k.slice(1));
      const cs = Object.keys(g?.s.claims ?? {})
        .map((c) => N.get(`c${c}`))
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
  const links = E.map((e) => ({ source: N.get(e.a) as WNode, target: N.get(e.b) as WNode, e }));
  type Link = (typeof links)[number];
  const ncOf = (e: WebEdge) => Object.keys(L.byId.get(+e.a.slice(1))?.s.claims ?? {}).length;
  const dist = (l: Link) => {
    const d = diag(l.source) + diag(l.target);
    return l.e.kind === "claim" ? 30 + d * 0.32 : l.e.tree ? 14 + d * 0.3 : 60 + d * 0.36;
  };
  const strength = (l: Link) =>
    l.e.kind === "claim" ? 0.5 / Math.min(ncOf(l.e), 3) : l.e.tree ? 0.7 : 0.03;
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
  const pad = wide ? 16 : 12;
  const sim = forceSimulation(all)
    .force("l", forceLink<WNode, Link>(links).distance(dist).strength(strength))
    .force(
      "q",
      forceManyBody<WNode>()
        .strength((n) => ("cs".includes(n.key[0] ?? "") ? -260 : -110))
        .distanceMax(600),
    )
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
  for (let i = 0; i < (anim ? 220 : 360); i++) sim.tick();
  for (const n of all) {
    n.fx = null;
    n.fy = null;
  }
  const rc = rectCollide(all, pad);
  let pass = 0;
  while (pass++ < 300 && rc());
  // still stuck between held nodes: everyone gives way evenly
  if (pass > 300) {
    for (const n of all) n.hold = false;
    pass = 0;
    while (pass++ < 800 && rc());
  }
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
