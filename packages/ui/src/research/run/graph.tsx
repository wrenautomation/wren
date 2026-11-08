/**
 * `RunGraph`: one birdwatch run as a graph (designs/2026-11-05-research-web.md, round 13; the
 * artifact LdYvUurK). Three layouts of the same run: the claim web, the search tree and lanes.
 * Props only: it fetches nothing.
 *
 * React draws every mark, panel and list. The layouts measure the marks, then write each one's
 * transform and each edge's `d` through refs, so React never owns a position: a hover re-renders
 * classes, never moves a node. The web solves off screen, then moves each node once (web.ts).
 */
import "./run.css";
import "d3-transition";
import { easeCubicOut } from "d3-ease";
import { select } from "d3-selection";
import { type Timer, timer } from "d3-timer";
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity } from "d3-zoom";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Empty, Loading } from "../../feedback.js";
import {
  type Box,
  type FlatEdge,
  flatPath,
  laneEdges,
  lanesOf,
  layLanes,
  layShelf,
  layTree,
  type Size,
  shelfOf,
  treeEdges,
  treeOf,
} from "./lays.js";
import { Badge, ClaimMark, EvBar, Ico, type MarkProps, SourceMark, WebMark } from "./marks.js";
import {
  countOf,
  EV_ORDER,
  evCounts,
  f1,
  type GNode,
  indexRun,
  pic,
  pl,
  type RunGraphData,
  SPEAKERS,
} from "./model.js";
import { PanelBody, type PanelCtx, type Pick } from "./panel.js";
import { type Hit, type Ident, pkey, same, toggled, webIdent, webPick } from "./picks.js";
import { capOf, kids, leftOf, presentSet, solveWeb, type WNode, webBox, webEdges } from "./web.js";

export type { Pick } from "./panel.js";
export { LAYS, type LayId } from "./side.js";

import { cls, type Focus, Key, LAYS, type LayId, Side, Summary, Table } from "./side.js";

const SIDEW = 252;
const PW = 380;
const reduced = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface RunGraphProps {
  /** undefined while it loads */
  run?: RunGraphData | undefined;
  /** why it failed to load */
  failed?: ReactNode;
  /** controlled layout, for a host that keeps it in the url */
  lay?: LayId | undefined;
  onLay?: (l: LayId) => void;
}

export function RunGraph({ run, failed, lay, onLay }: RunGraphProps) {
  if (failed)
    return (
      <Empty title="This run didn't load">
        <span>{failed}</span>
      </Empty>
    );
  if (!run) return <Loading shape="cards" lines={3} heading label="Loading the run" />;
  return <Graph key={run.rid} run={run} lay={lay} onLay={onLay} />;
}

function Graph({
  run,
  lay: layP,
  onLay,
}: {
  run: RunGraphData;
  lay?: LayId | undefined;
  onLay?: ((l: LayId) => void) | undefined;
}) {
  const L = useMemo(() => indexRun(run), [run]);
  const [layS, setLayS] = useState<LayId>(layP ?? "web");
  const lay = layP ?? layS;
  const [wide, setWide] = useState(true);
  const [round, setRound] = useState(0);
  const [tab, setTab] = useState<"c" | "q" | "d">("c");
  const [pick, setPickS] = useState<Pick | null>(null);
  const [hover, setHover] = useState<Pick | null>(null);
  const [hole, setHole] = useState<string | null>(null);
  const [sort, setSort] = useState<[string, number]>(["kept", -1]);
  const [dq, setDq] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [exp, setExp] = useState<ReadonlySet<string>>(new Set());
  const [lift, setLift] = useState<ReadonlySet<number>>(new Set());
  const [more, setMore] = useState<ReadonlyMap<string, number>>(new Map());
  const [gone, setGone] = useState<string[]>([]);
  const [fonts, setFonts] = useState(0);
  const [fitN, setFitN] = useState(0);
  const [tip, setTip] = useState<{ id: number; el: HTMLElement } | null>(null);
  const [copied, setCopied] = useState(false);
  const qKey = `birdwatch-read:${L.run.rid}`;
  const [queue, setQueue] = useState<ReadonlySet<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(qKey) || "[]") as string[]);
    } catch {
      return new Set();
    }
  });

  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLElement>()).current;
  const paths = useRef(new Map<string, SVGPathElement>()).current;
  const boxes = useRef(new Map<string, Box>()).current;
  const regs = useRef(new Map<string, (el: HTMLElement | null) => void>()).current;
  const pregs = useRef(new Map<string, (el: SVGPathElement | null) => void>()).current;
  const wg = useRef({
    nodes: new Map<string, WNode>(),
    shelf: new Map<string, Box>(),
    at: "",
    fitB: null as { x0: number; y0: number; x1: number; y1: number } | null,
    tw: null as Timer | null,
    born: new Map<string, number>(),
  }).current;
  const pend = useRef<{
    anim: boolean;
    fk: string | null;
    fit: number | null;
    center: Pick | null;
  }>({
    anim: false,
    fk: null,
    fit: 0,
    center: null,
  });
  const T = useRef<ZoomTransform>(zoomIdentity);
  const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const live = useRef({ pick, wide, lay });
  live.current = { pick, wide, lay };

  const reg = (k: string) => {
    let f = regs.get(k);
    if (!f) {
      f = (el) => {
        if (el) els.set(k, el);
        else els.delete(k);
      };
      regs.set(k, f);
    }
    return f;
  };
  const preg = (k: string) => {
    let f = pregs.get(k);
    if (!f) {
      f = (el) => {
        if (el) paths.set(k, el);
        else paths.delete(k);
      };
      pregs.set(k, f);
    }
    return f;
  };

  // the scenes: what each layout shows; positions come later, from the marks' sizes
  const ws = { exp, lift, more, wide };
  const pres = useMemo(
    () => (lay === "web" ? presentSet(L, { exp, lift, more, wide }) : null),
    [L, lay, exp, lift, more, wide],
  );
  const wE = useMemo(() => (pres ? webEdges(L, pres.order, pres.par) : []), [L, pres]);
  const shelf = useMemo(
    () => (pres ? shelfOf(L, (id) => pres.par.has(`s${id}`)) : null),
    [L, pres],
  );
  const rows = useMemo(() => (lay === "tree" ? treeOf(L, open) : []), [L, lay, open]);
  const lanes = useMemo(() => (lay === "lanes" ? lanesOf(L, open) : []), [L, lay, open]);
  const flatE: FlatEdge[] = useMemo(
    () => (lay === "tree" ? treeEdges(rows) : lay === "lanes" ? laneEdges(lanes) : []),
    [lay, rows, lanes],
  );
  const late = (n: GNode | undefined) => !!n && !!round && n.s.r > round;

  // focus: hover or pick lights a node and its neighbours; a summary bar lights a group
  const nbrs = (key: string) => {
    const out = new Set([key]);
    for (const e of wE) {
      if (e.a === key) out.add(e.b);
      if (e.b === key) out.add(e.a);
    }
    return out;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: nbrs reads wE
  const F = useMemo((): Focus | null => {
    const p = pick || hover;
    const web = lay === "web";
    if (p?.t === "n")
      return { S: new Set(), C: new Set(), Q: new Set(), K: web ? nbrs(p.key) : new Set([p.key]) };
    let f: Focus | null = null;
    if (p?.t === "c") {
      const c = L.claims[p.i];
      f = { S: new Set(c?.ss.map((n) => n.id)), C: new Set([p.i]), Q: new Set() };
    } else if (p?.t === "q")
      f = { S: new Set(L.byQ.get(p.i)?.ss), C: new Set(), Q: new Set([p.i]) };
    else if (p?.t === "s") {
      const n = L.byId.get(p.id);
      f = {
        S: new Set([p.id]),
        C: new Set(Object.keys(n?.s.claims ?? {}).map(Number)),
        Q: new Set(L.reach.get(p.id)),
      };
    }
    if (!f && hole) {
      const ns = L.nodes.filter((n) =>
        hole[0] === "k"
          ? n.k === hole.slice(2)
          : hole === "nr"
            ? !n.s.pages.length || n.s.unread.length
            : hole === "rn"
              ? n.s.pages.length && !n.s.kept
              : hole === "nc"
                ? n.s.kept && !n.nc
                : hole.startsWith("e:")
                  ? n.s.fs.some(
                      (x) =>
                        ((EV_ORDER as string[]).includes(x.e) ? x.e : "other") === hole.slice(2),
                    )
                  : false,
      );
      f = {
        S: new Set(ns.map((n) => n.id)),
        C: new Set(hole[0] === "k" ? ns.flatMap((n) => Object.keys(n.s.claims).map(Number)) : []),
        Q: new Set(),
      };
    }
    if (f && web && p) f.K = nbrs(pkey(p));
    return f;
  }, [pick, hover, hole, lay, L, wE]);
  const onOf = (id: Ident) =>
    !!F &&
    (!!(id.n && F.K?.has(id.n)) ||
      (id.s != null
        ? F.S.has(id.s)
        : id.c != null
          ? F.C.has(id.c)
          : id.q != null && F.Q.has(id.q)));
  const pk = pkey(pick);
  const pkOf = (id: Ident) => !!pk && (id.n === pk || (pick?.t === "q" && id.q === pick.i));

  const hits = new Map<string, Hit>();
  const mp = (key: string, hit: Hit, extra?: Partial<MarkProps>): MarkProps => {
    hits.set(key, hit);
    return { n: key, reg: reg(key), on: onOf(hit.id), pk: pkOf(hit.id), ...extra };
  };

  // picks
  const setPick = (p: Pick | null, center = false) => {
    setPickS(p);
    setHover(null);
    setTip(null);
    if (p?.t === "c") setTab("c");
    if (p?.t === "q") setTab("q");
    if (p?.t === "D") setTab("d");
    pend.current.center = center && p ? p : null;
  };
  const askFit = (ms: number) => {
    pend.current.fit = ms;
    setFitN((n) => n + 1);
  };
  const toggleQ = (id: string) => {
    const q = toggled(queue, id);
    setQueue(q);
    try {
      localStorage.setItem(qKey, JSON.stringify([...q]));
    } catch {
      /* private mode */
    }
  };
  const clearQ = () => {
    setQueue(new Set());
    try {
      localStorage.setItem(qKey, "[]");
    } catch {
      /* private mode */
    }
  };
  const cmd = `birdwatch open ${L.run.rid} ${[...queue].join(" ")} --why "asked to read it"`;

  // a click opens or closes a web node and picks it
  const toggleNode = (key: string, onShelf: boolean) => {
    if (key[0] === "m") {
      const pk2 = key.slice(1);
      pend.current = { ...pend.current, anim: true, fk: pk2 };
      setMore(new Map(more).set(pk2, (more.get(pk2) ?? capOf(wide)) + capOf(wide)));
      return;
    }
    const p = webPick(key);
    if (!kids(L, key).length) return setPick(same(pick, p) ? null : p);
    const closing = exp.has(key);
    const nexp = toggled(exp, key);
    const nlift = new Set(lift);
    if (key[0] === "s") {
      if (closing) nlift.delete(+key.slice(1));
      else if (onShelf) nlift.add(+key.slice(1));
    }
    const np = presentSet(L, { exp: nexp, lift: nlift, more, wide });
    if (closing && pres && !reduced()) {
      const removed = pres.order.filter((k) => !np.par.has(k));
      setGone((g) => [...g, ...removed]);
      setTimeout(() => setGone((g) => g.filter((k) => !removed.includes(k))), 340);
    }
    pend.current = { ...pend.current, anim: true, fk: key };
    setExp(np.exp);
    setLift(nlift);
    setMore(np.more);
    if (closing) setPick(same(pick, p) ? null : pick);
    else setPick(p);
  };

  // the view: fit the graph to the room the side list and panel leave
  const room = () => {
    const st = stageRef.current;
    const W = st?.clientWidth ?? 0;
    const H = st?.clientHeight ?? 0;
    const { pick: p, wide: w } = live.current;
    const l = w ? SIDEW + 34 : 12;
    const t = w ? 18 : (sideRef.current?.scrollHeight ?? 0) + 8;
    const r = W - 18 - (w && p ? PW : 0);
    const b = H - 18 - (w || !p ? 0 : (panelRef.current?.offsetHeight ?? 0));
    return { l, t, r, b, w: r - l, h: b - t };
  };
  const go = (t: ZoomTransform, ms: number) => {
    const st = stageRef.current;
    const z = zoomRef.current;
    if (!st || !z) return;
    const sel = select(st);
    if (ms && !reduced()) sel.transition().duration(ms).call(z.transform, t);
    else sel.call(z.transform, t);
  };
  const fitView = (ms = 0) => {
    let B = live.current.lay === "web" ? wg.fitB : null;
    if (!B) {
      B = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
      for (const b of boxes.values()) {
        B.x0 = Math.min(B.x0, b.x);
        B.y0 = Math.min(B.y0, b.y);
        B.x1 = Math.max(B.x1, b.x + b.w);
        B.y1 = Math.max(B.y1, b.y + b.h);
      }
    }
    if (!(B.x1 > B.x0)) return;
    const R = room();
    const bw = B.x1 - B.x0;
    const bh = B.y1 - B.y0;
    let k = Math.min(1, R.w / bw, R.h / bh);
    let ty: number;
    // too tall to read whole: fit the width and start at the top
    const floor = live.current.wide ? 0.55 : 0.4;
    if (k < floor) {
      k = Math.min(1, Math.max(floor, R.w / bw));
      ty = R.t - B.y0 * k;
    } else ty = R.t + (R.h - bh * k) / 2 - B.y0 * k;
    const tx = k * bw <= R.w ? R.l + (R.w - bw * k) / 2 - B.x0 * k : R.l - B.x0 * k;
    go(zoomIdentity.translate(tx, ty).scale(k), ms);
  };
  const centerOn = (b: Box | undefined) => {
    if (!b) return;
    const R = room();
    const k = Math.max(T.current.k, 0.8);
    go(
      zoomIdentity
        .translate(R.l + R.w / 2 - (b.x + b.w / 2) * k, R.t + R.h / 2 - (b.y + b.h / 2) * k)
        .scale(k),
      450,
    );
  };
  /** After a node opens: bring it and what it holds into view, zooming out only as far as needed. */
  const showOpen = (key: string) => {
    const os = [key, ...kids(L, key)].map((k) => wg.nodes.get(k)).filter((o): o is WNode => !!o);
    if (!os.length) return;
    const B = webBox(os);
    const R = room();
    const pad = 30;
    const t = T.current;
    if (
      t.applyX(B.x0) >= R.l + pad &&
      t.applyX(B.x1) <= R.r - pad &&
      t.applyY(B.y0) >= R.t + pad &&
      t.applyY(B.y1) <= R.b - pad
    )
      return;
    const k = Math.max(
      0.3,
      Math.min(t.k, (R.w - pad * 2) / (B.x1 - B.x0), (R.h - pad * 2) / (B.y1 - B.y0)),
    );
    const cx = (B.x0 + B.x1) / 2;
    const cy = (B.y0 + B.y1) / 2;
    go(zoomIdentity.translate(R.l + R.w / 2 - cx * k, R.t + R.h / 2 - cy * k).scale(k), 450);
  };
  const fitRef = useRef(fitView);
  fitRef.current = fitView;

  // zoom, before the first layout needs it
  useLayoutEffect(() => {
    const st = stageRef.current;
    if (!st) return;
    const z = zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.2, 3])
      .clickDistance(5)
      .filter(
        (e: Event & { button?: number; ctrlKey?: boolean; metaKey?: boolean }) =>
          !(e.target as Element | null)?.closest?.(".rg-panel,.rg-side,.rg-tip") &&
          (e.type === "wheel" ? !!(e.ctrlKey || e.metaKey) : !e.button),
      )
      .on("zoom", (e: { transform: ZoomTransform }) => {
        T.current = e.transform;
        const w = worldRef.current;
        if (w)
          w.style.transform = `translate(${f1(e.transform.x)}px,${f1(e.transform.y)}px) scale(${e.transform.k})`;
        setTip(null);
      });
    zoomRef.current = z;
    const sel = select(st);
    sel.call(z).on("dblclick.zoom", null);
    setWide(st.clientWidth >= 820);
    return () => {
      sel.on(".zoom", null);
    };
  }, []);

  // the layout: measure the marks, place them, draw the edges
  const sig = [lay, wide, fonts, [...exp], [...lift], [...more], [...open]].join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: sig and L name every input of the layout
  useLayoutEffect(() => {
    const p = pend.current;
    pend.current = { ...p, anim: false, fk: null };
    const size: Size = (k) => {
      const el = els.get(k);
      return el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 0, h: 0 };
    };
    const move = (k: string, b: Box) => {
      const el = els.get(k);
      if (el) el.style.transform = `translate(${f1(b.x)}px,${f1(b.y)}px)`;
    };
    const put = (k: string, b: Box) => {
      boxes.set(k, b);
      move(k, b);
    };
    wg.tw?.stop();
    if (lay !== "web" || !pres || !shelf) {
      wg.nodes.clear();
      wg.fitB = null;
      boxes.clear();
      const at = lay === "tree" ? layTree(rows, size) : layLanes(L, lanes, size, wide);
      for (const [k, b] of at) put(k, b);
      for (const e of flatE) {
        const A = at.get(e.a);
        const B = at.get(e.b);
        const path = paths.get(e.id);
        if (A && B && path) path.setAttribute("d", flatPath(e, A, B));
      }
      return;
    }
    const N = wg.nodes;
    const anim = p.anim && N.size > 0;
    const shelfAt = new Map<string, [number, number]>();
    for (const [k, b] of boxes)
      if (/^sh\d/.test(k)) shelfAt.set(`s${k.slice(2)}`, [b.x + b.w / 2, b.y + b.h / 2]);
    if (!anim) N.clear();
    boxes.clear();
    const { order, par } = pres;
    const keep = new Set(order);
    // closing: what it held folds back into it, then goes
    const into = anim && !reduced() && p.fk ? N.get(p.fk) : undefined;
    for (const [k, o] of [...N]) {
      if (keep.has(k)) continue;
      N.delete(k);
      if (into) move(k, { x: into.x - o.w / 2, y: into.y - o.h / 2, w: o.w, h: o.h });
    }
    const fresh = new Set<WNode>();
    const now = performance.now();
    for (const k of order) {
      const s = size(k);
      const o = N.get(k);
      if (o) {
        o.w = s.w;
        o.h = s.h;
        continue;
      }
      const n: WNode = { key: k, ...s, x: 0, y: 0, ax: null, ay: null, hold: false, free: false };
      N.set(k, n);
      fresh.add(n);
      if (anim) wg.born.set(k, now);
    }
    const { all, from, to } = solveWeb({
      L,
      N,
      order,
      par,
      E: wE,
      fresh,
      anim,
      fk: p.fk,
      wide,
      shelfAt,
    });
    wg.shelf = layShelf(shelf, size, wide);
    wg.at = "";
    const draw = () => {
      for (const o of all) put(o.key, { x: o.x - o.w / 2, y: o.y - o.h / 2, w: o.w, h: o.h });
      for (const e of wE) {
        const A = N.get(e.a);
        const B = N.get(e.b);
        const path = paths.get(e.id);
        if (!A || !B || !path) continue;
        if (e.kind !== "claim")
          path.setAttribute("d", `M${f1(A.x)},${f1(A.y)}L${f1(B.x)},${f1(B.y)}`);
        else {
          // claim edges bow a little, so two that share a line still read apart
          const mx = (A.x + B.x) / 2 - (B.y - A.y) * 0.08;
          const my = (A.y + B.y) / 2 + (B.x - A.x) * 0.08;
          path.setAttribute(
            "d",
            `M${f1(A.x)},${f1(A.y)}Q${f1(mx)},${f1(my)} ${f1(B.x)},${f1(B.y)}`,
          );
        }
      }
      // the shelf rides below the web as the web grows
      if (!wg.shelf.size) return;
      const B = all.length ? webBox(all) : { x0: 0, y0: 0, x1: 0, y1: 0 };
      const x0 = Math.round(B.x0);
      const y0 = Math.round(B.y1 + (wide ? 64 : 48));
      const at = `${x0},${y0}`;
      if (at === wg.at) {
        for (const [k, b] of wg.shelf) boxes.set(k, { ...b, x: x0 + b.x, y: y0 + b.y });
        return;
      }
      wg.at = at;
      for (const [k, b] of wg.shelf) put(k, { ...b, x: x0 + b.x, y: y0 + b.y });
    };
    const opened = p.fk && exp.has(p.fk) ? p.fk : null;
    if (!anim || reduced()) {
      draw();
      if (!anim) wg.fitB = all.length ? webBox(all) : null;
      else if (opened) showOpen(opened);
      return;
    }
    if (opened) showOpen(opened);
    const step = (e: number) => {
      for (const o of all) {
        const a = from.get(o) ?? [o.x, o.y];
        const b = to.get(o) ?? [o.x, o.y];
        o.x = a[0] + (b[0] - a[0]) * e;
        o.y = a[1] + (b[1] - a[1]) * e;
      }
      draw();
    };
    step(0);
    const tw = timer((ms) => {
      const t = Math.min(1, ms / 460);
      step(easeCubicOut(t));
      if (t === 1) tw.stop();
    });
    wg.tw = tw;
  }, [sig, L]);
  useEffect(() => () => wg.tw?.stop(), [wg]);

  // fit after the layout, once the panel and side list are drawn
  // biome-ignore lint/correctness/useExhaustiveDependencies: fitN asks for it
  useLayoutEffect(() => {
    const ms = pend.current.fit;
    if (ms == null) return;
    pend.current.fit = null;
    fitView(ms);
  }, [fitN, wide, fonts]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a pick asks for it
  useEffect(() => {
    const c = pend.current.center;
    pend.current.center = null;
    if (!c) return;
    const k = pkey(c);
    centerOn(boxes.get(k) ?? (c.t === "s" ? boxes.get(`sh${c.id}`) : undefined));
  }, [pick]);

  // read-ok: font load and stage size, no portal data
  useEffect(() => {
    const st = stageRef.current;
    if (!st) return;
    const ro = new ResizeObserver(() => {
      const w = st.clientWidth >= 820;
      if (w !== live.current.wide) {
        pend.current.fit = 0;
        setWide(w);
      } else fitRef.current(0);
    });
    ro.observe(st);
    let alive = true;
    document.fonts?.ready.then(() => {
      if (!alive) return;
      pend.current.fit = 0;
      setFonts((n) => n + 1);
    });
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: setPick only sets state
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && live.current.pick) setPick(null);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);

  // hover card for chips and dots
  useLayoutEffect(() => {
    const el = tip?.el;
    const t = tipRef.current;
    const st = stageRef.current;
    if (!el || !t || !st) return;
    const r = el.getBoundingClientRect();
    const g = st.getBoundingClientRect();
    const tw = t.offsetWidth;
    const th = t.offsetHeight;
    const x = Math.max(
      8,
      Math.min(st.clientWidth - tw - 8, r.left - g.left + r.width / 2 - tw / 2),
    );
    let y = r.top - g.top - th - 8;
    if (y < 8) y = r.bottom - g.top + 8;
    t.style.transform = `translate(${f1(x)}px,${f1(y)}px)`;
  }, [tip]);

  // delegated events on the marks
  const hitOf = (t: EventTarget | null) => {
    const el = (t as Element | null)?.closest?.("[data-n]") as HTMLElement | null;
    const h = el?.dataset.n ? hits.get(el.dataset.n) : undefined;
    return el && h ? { el, h } : null;
  };
  const onNodesOver = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const x = hitOf(e.target);
    const h = x ? x.h.pick : null;
    if (x && x.h.pick.t === "s" && !x.el.classList.contains("cd") && x.el.classList.contains("nd"))
      setTip({ id: x.h.pick.id, el: x.el });
    else setTip(null);
    if (!same(h, hover)) setHover(h);
  };
  const onNodesOut = (e: React.PointerEvent) => {
    const r = e.relatedTarget as Element | null;
    if (r?.closest?.(".rg-nodes [data-n]")) return;
    setTip(null);
    if (hover) setHover(null);
  };
  const act = (x: { el: HTMLElement; h: Hit }, toggle: boolean) => {
    if (lay === "web" && x.h.web) return toggleNode(x.h.web, !!x.h.shelf);
    setPick(toggle && same(pick, x.h.pick) ? null : x.h.pick);
  };
  const onStageClick = (e: React.MouseEvent) => {
    const t = e.target as Element;
    if (t.closest(".rg-panel,.rg-side")) return;
    const o = t.closest("[data-open]") as HTMLElement | null;
    if (o?.dataset.open) return setOpen(toggled(open, o.dataset.open));
    if (t.closest(".rg-nodes a")) return;
    const x = hitOf(t);
    if (!x) {
      if (pick) setPick(null);
      return;
    }
    act(x, true);
  };
  const onStageKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target as Element;
    if (t.closest("a,.rg-panel,.rg-side")) return;
    const o = t.closest("[data-open]") as HTMLElement | null;
    if (o?.dataset.open) {
      e.preventDefault();
      return setOpen(toggled(open, o.dataset.open));
    }
    const x = hitOf(t);
    if (!x) return;
    e.preventDefault();
    act(x, false);
  };

  // marks for each layout
  const born = (k: string) =>
    (pend.current.anim && !wg.nodes.has(k)) || performance.now() - (wg.born.get(k) ?? -1e9) < 400;
  const srcHit = (n: GNode, web?: string, shelfIt?: boolean): Hit => ({
    pick: { t: "s", id: n.id },
    id: { n: `s${n.id}`, s: n.id },
    ...(web ? { web } : {}),
    ...(shelfIt ? { shelf: true } : {}),
  });
  const marks: ReactNode[] = [];
  const edges: ReactNode[] = [];
  if (lay === "web" && pres && shelf) {
    const on = new Set(pres.order);
    const goneNow = gone.filter((k) => !on.has(k));
    for (const k of [...pres.order, ...goneNow]) {
      const isGone = !on.has(k);
      const nk = kids(L, k).length;
      const t = k[0];
      const n = t === "s" ? L.byId.get(+k.slice(1)) : undefined;
      const isOpen = exp.has(k);
      marks.push(
        <WebMark
          key={k}
          L={L}
          k={k}
          wide={wide}
          left={t === "m" ? leftOf(L, ws, k.slice(1)) : 0}
          m={mp(
            k,
            { pick: webPick(k), id: webIdent(k), web: k },
            {
              cls: cls(isOpen && "open", isGone ? "gone" : born(k) && "new", late(n) && "late"),
              expanded: nk ? isOpen : undefined,
              badge: <Badge open={isOpen} n={nk} />,
            },
          )}
        />,
      );
    }
    for (const e of wE)
      edges.push(
        <path
          key={e.id}
          ref={preg(e.id)}
          className={cls(
            "e",
            `w-${e.kind}`,
            e.k && `k-${e.k}`,
            onOf(webIdent(e.a)) && onOf(webIdent(e.b)) && "on",
          )}
          style={
            e.kind === "claim" ? { strokeWidth: Math.min(5, 1.1 + 0.9 * (e.w - 1)) } : undefined
          }
        />,
      );
    // the shelf: sources whose findings back no claim, and those with none
    const chip = (n: GNode, tier: "chip" | "dot") => (
      <SourceMark
        key={`sh${n.id}`}
        n={n}
        tier={tier}
        m={mp(`sh${n.id}`, srcHit(n, `s${n.id}`, true), {
          cls: cls("sh", late(n) && "late"),
          badge: tier === "chip" ? <Badge open={false} n={kids(L, `s${n.id}`).length} /> : null,
        })}
      />
    );
    if (shelf.restN) {
      marks.push(
        <div key="shb" ref={reg("shb")} className="lh big">
          <b>Findings in no claim</b>
          <span>
            {pl(shelf.restN, "source")}, {pl(shelf.restF, "finding")}. Click one to open it.
          </span>
        </div>,
      );
      for (const g of shelf.rest) {
        marks.push(
          <div key={`shk${g.k}`} ref={reg(`shk${g.k}`)} className="lh">
            <i className={`k-${g.k}`} />
            {SPEAKERS[g.k].many} <span>{g.ns.length}</span>
          </div>,
        );
        for (const n of g.ns) marks.push(chip(n, "chip"));
      }
    }
    for (const g of shelf.quiet) {
      marks.push(
        <div key={`shq${g.id}`} ref={reg(`shq${g.id}`)} className="lh">
          {g.t} <span>{g.ns.length}</span>
        </div>,
      );
      for (const n of g.ns) marks.push(chip(n, "dot"));
    }
  } else if (lay === "tree") {
    const qs = L.run.searches;
    marks.push(
      <div key="rt" ref={reg("rt")} className="nd rt">
        <b>{L.run.t}</b>
        <small>
          {pl(qs.length, "search")} · {pl(L.rounds.length, "round")}
        </small>
      </div>,
    );
    for (const row of rows) {
      marks.push(
        <div key={`rd${row.r}`} ref={reg(`rd${row.r}`)} className="nd rd">
          <b>Round {row.r}</b>
          <small>{pl(row.qs.length, "search")}</small>
        </div>,
      );
      for (const o of row.qs) {
        const q = L.byQ.get(o.i);
        if (!q) continue;
        const sub = `${q.hits} hits · ${q.kept} kept · ${q.fnd ? pl(q.fnd, "finding") : "no finding"}`;
        const m = mp(`q${q.i}`, { pick: { t: "q", i: q.i }, id: { q: q.i } });
        marks.push(
          // biome-ignore lint/a11y/useSemanticElements: positioned card, same as the marks
          <div
            key={`q${q.i}`}
            ref={m.reg}
            data-n={m.n}
            className={cls("nd sq", m.on && "on", m.pk && "pk")}
            role="button"
            tabIndex={0}
            aria-label={`Search ${q.i + 1}: ${q.t}. ${sub}`}
          >
            <span className="no">{q.i + 1}</span>
            <b>{q.t}</b>
            <small>{sub}</small>
          </div>,
        );
        marks.push(
          <div key={`cl${q.i}`} ref={reg(`cl${q.i}`)} className="cl2">
            {o.mine.slice(0, o.cut).map((n) => (
              <SourceMark
                key={n.id}
                n={n}
                tier={n.s.kept ? "chip" : "dot"}
                m={{
                  ...mp(`s${n.id}`, srcHit(n), { cls: cls("in", late(n) && "late") }),
                  reg: undefined,
                }}
              />
            ))}
            {o.mine.length > 3 ? (
              <button type="button" className="more" data-open={`q${q.i}`}>
                {o.open ? "Show fewer" : `+${o.mine.length - 3} more`}
              </button>
            ) : null}
            {o.again ? <span className="ag">{o.again} found before</span> : null}
            {!q.ss.length ? <span className="ag">Kept no hit</span> : null}
          </div>,
        );
      }
    }
    for (const e of flatE)
      edges.push(
        <path
          key={e.id}
          ref={preg(e.id)}
          className={cls(
            "e",
            e.t,
            F && (e.qs ? e.qs.some((q) => F.Q.has(q)) : F.Q.has(e.q ?? -2)) && "on",
          )}
        />,
      );
  } else {
    for (const ln of lanes) {
      marks.push(
        <div key={`lb${ln.k}`} ref={reg(`lb${ln.k}`)} className="lh">
          <i className={`k-${ln.k}`} />
          {SPEAKERS[ln.k].many}{" "}
          <span>
            {pl(ln.ns.length, "source")}
            {ln.linked.length ? ` · ${ln.linked.length} back a claim` : ""}
          </span>
        </div>,
      );
      const src = (n: GNode, tier: "chip" | "dot") => (
        <SourceMark
          key={`s${n.id}`}
          n={n}
          tier={tier}
          m={mp(`s${n.id}`, srcHit(n), { cls: cls(late(n) && "late") })}
        />
      );
      for (const n of ln.linked) marks.push(src(n, "chip"));
      if (ln.rest.length) {
        if (ln.open) for (const n of ln.rest) marks.push(src(n, "chip"));
        marks.push(
          <button
            key={`mo${ln.k}`}
            ref={reg(`mo${ln.k}`)}
            type="button"
            className="more"
            data-open={`k${ln.k}`}
          >
            {ln.open ? "Show fewer" : `+${ln.rest.length} with findings, in no claim`}
          </button>,
        );
      }
      for (const n of ln.quiet) marks.push(src(n, "dot"));
    }
    for (const c of L.claims)
      marks.push(
        <ClaimMark
          key={`c${c.i}`}
          L={L}
          i={c.i}
          m={mp(`c${c.i}`, { pick: { t: "c", i: c.i }, id: { n: `c${c.i}`, c: c.i } })}
        />,
      );
    for (const e of flatE)
      edges.push(
        <path
          key={e.id}
          ref={preg(e.id)}
          className={cls(
            "e",
            e.t,
            e.k && `k-${e.k}`,
            late(L.byId.get(e.s ?? -1)) && "late",
            F?.S.has(e.s ?? -1) && F.C.has(e.c ?? -1) && "on",
          )}
          style={e.w ? { strokeWidth: Math.min(7, 1.2 + 1.3 * (e.w - 1)) } : undefined}
        />,
      );
  }

  const panelCtx: PanelCtx = {
    L,
    pick: (p, center) => setPick(p, center),
    close: () => setPick(null),
    queue,
    toggleQ,
    dq,
    setDq,
  };
  const f = L.run.funnel;
  const tipN = tip ? L.byId.get(tip.id) : undefined;
  const empty = !L.nodes.length && !L.run.searches.length;

  return (
    <div className="rg">
      <div className="bar lk">
        <span className="grp">
          <span className="lb">Layout</span>
          <div className="seg">
            {LAYS.map((l, i) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={l.id === lay}
                onClick={() => {
                  if (layP == null) setLayS(l.id);
                  onLay?.(l.id);
                  setHover(null);
                  setOpen(new Set());
                  askFit(300);
                }}
              >
                <i>{i + 1}</i>
                {l.name}
              </button>
            ))}
          </div>
        </span>
      </div>
      <p className="lookcap">{LAYS.find((l) => l.id === lay)?.key}</p>
      <div className="bar">
        <span className="sp" />
        {L.rounds.length > 1 ? (
          <span className="grp">
            <span className="lb">Round</span>
            <div className="seg">
              {[0, ...L.rounds].map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={r === round}
                  onClick={() => {
                    setRound(r);
                    if (pick?.t === "s" && r && (L.byId.get(pick.id)?.s.r ?? 0) > r) setPick(null);
                  }}
                >
                  {r || "All"}
                </button>
              ))}
            </div>
          </span>
        ) : null}
        <span className="grp">
          <button
            type="button"
            className="btn"
            aria-label="Zoom out"
            onClick={() =>
              stageRef.current &&
              zoomRef.current &&
              select(stageRef.current)
                .transition()
                .duration(250)
                .call(zoomRef.current.scaleBy, 1 / 1.4)
            }
          >
            −
          </button>
          <button
            type="button"
            className="btn"
            aria-label="Zoom in"
            onClick={() =>
              stageRef.current &&
              zoomRef.current &&
              select(stageRef.current).transition().duration(250).call(zoomRef.current.scaleBy, 1.4)
            }
          >
            +
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setHole(null);
              setExp(new Set());
              setLift(new Set());
              setMore(new Map());
              setPick(null);
              askFit(400);
            }}
          >
            Reset
          </button>
        </span>
      </div>
      <div className="runhead">
        <h3>{L.run.t}</h3>
        {L.run.note ? <p>{L.run.note}</p> : null}
        <p className="mt">
          {L.run.meta ? `${L.run.meta} · ` : ""}
          {pl(L.rounds.length, "round")} · {pl(L.run.searches.length, "search")} · {f.hits} hits,{" "}
          {f.kept} kept, {f.read} read, {pl(f.findings, "finding")}, {pl(f.claims, "claim")}
        </p>
      </div>
      <Summary
        L={L}
        hole={hole}
        setHole={(h) => {
          if (pick) setPick(null);
          setHole(h === hole ? null : h);
        }}
      />
      {/* biome-ignore lint/a11y/useSemanticElements: a positioned stage, not a form group; it delegates the marks' clicks and keys */}
      <div
        ref={stageRef}
        className={cls("rg-stage", F && "fx", pick && "open")}
        data-lay={lay}
        role="group"
        aria-label="The run as a graph: claims as tinted cards, sources as cards, chips and dots, lines from each source to the claims it backs."
        onClick={onStageClick}
        onKeyDown={onStageKey}
      >
        <div ref={worldRef} className="rg-world">
          <svg className="rg-edges" aria-hidden="true">
            {edges}
          </svg>
          <div className="rg-nodes" onPointerOver={onNodesOver} onPointerOut={onNodesOut}>
            {marks}
          </div>
        </div>
        {empty ? <p className="rg-empty">This run has no searches yet.</p> : null}
        <Side
          r={sideRef}
          L={L}
          chips={!wide}
          tab={tab}
          setTab={setTab}
          pick={pick}
          F={F}
          queue={queue}
          cmd={cmd}
          copied={copied}
          onCopy={() => {
            void navigator.clipboard?.writeText(cmd);
            setCopied(true);
          }}
          onClear={clearQ}
          onPick={(p) => setPick(same(pick, p) ? null : p, true)}
          onHover={(p) => {
            if (pick || same(p, hover)) return;
            setHover(p);
          }}
        />
        {tipN ? (
          <div ref={tipRef} className={`rg-tip hc k-${tipN.k}`}>
            {pic(tipN.s) ? <img className="th" src={pic(tipN.s) ?? ""} alt="" /> : null}
            <b>
              <Ico s={tipN.s} />
              <span>{tipN.s.name}</span>
            </b>
            <small>
              {SPEAKERS[tipN.s.kind].one} · round {tipN.s.r} · {countOf(tipN)}
            </small>
            <EvBar c={evCounts(tipN.s.fs)} />
            {(() => {
              const fq = tipN.s.fs.find((x) => x.c >= 0 && x.q) || tipN.s.fs.find((x) => x.q);
              return fq ? <q>{fq.q}</q> : null;
            })()}
          </div>
        ) : null}
        <aside ref={panelRef} className="rg-panel" aria-label="Detail" aria-live="polite">
          {pick ? <PanelBody key={JSON.stringify(pick)} c={panelCtx} p={pick} /> : null}
        </aside>
      </div>
      <Key lay={lay} />
      <Table
        L={L}
        F={F}
        picked={!!pick}
        sort={sort}
        onSort={(k) =>
          setSort([
            k,
            sort[0] === k ? -sort[1] : k === "name" || k === "kind" || k === "r" ? 1 : -1,
          ])
        }
        onHover={(id) => {
          if (pick) return;
          const h: Pick | null = id == null ? null : { t: "s", id };
          if (!same(h, hover)) setHover(h);
        }}
        onPick={(n) => {
          if (late(n)) setRound(0);
          stageRef.current?.scrollIntoView({
            block: "nearest",
            behavior: reduced() ? "auto" : "smooth",
          });
          // a source tucked behind "+N more" opens its group first
          if (lay === "lanes" && !n.nc && n.s.kept) setOpen((o) => new Set(o).add(`k${n.k}`));
          if (lay === "tree") {
            const q = L.run.searches
              .slice()
              .sort((a, b) => a.r - b.r || a.i - b.i)
              .find((x) => x.ss.includes(n.id));
            if (q) setOpen((o) => new Set(o).add(`q${q.i}`));
          }
          setPick({ t: "s", id: n.id }, true);
        }}
      />
    </div>
  );
}
