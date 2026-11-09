/**
 * `RunGraph`: one weaver run as a graph (designs/2026-11-05-research-web.md, round 13; the
 * artifact LdYvUurK). One layout: the query web, each search a hub with its answer, the sources
 * that hold findings around it (11-08). Props only: it fetches nothing.
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
import { Bars } from "./bars.js";
import { type Box, layShelf, type Size, shelfOf } from "./lays.js";
import { Badge, EvBar, Ico, type MarkProps, SourceMark, WebMark } from "./marks.js";
import {
  countOf,
  EV_ORDER,
  evCounts,
  f1,
  type GNode,
  headOf,
  indexRun,
  pic,
  pl,
  type RunGraphData,
  SPEAKERS,
  stepOf,
} from "./model.js";
import { PanelBody, type PanelCtx, type Pick } from "./panel.js";
import { type Hit, type Ident, pkey, same, toggled, webIdent, webPick } from "./picks.js";
import {
  capOf,
  keepPlaces,
  kids,
  leftOf,
  placesOf,
  presentSet,
  settle,
  solveWeb,
  type WNode,
  webBox,
  webEdges,
} from "./web.js";

export type { Pick } from "./panel.js";

import { cls, type Focus, Key, Side, Summary, Table } from "./side.js";

const SIDEW = 252;
const PW = 380;
const reduced = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface RunGraphProps {
  /** undefined while it loads */
  run?: RunGraphData | undefined;
  /** why it failed to load */
  failed?: ReactNode;
  /** in a chat card: no run head, summary, key or table; a shorter stage */
  card?: boolean | undefined;
}

// merged drop ids are "k.id": one open per run
function mergedOpen(runs: readonly { rid: string }[], queue: Iterable<string>) {
  const by = new Map<string, string[]>();
  for (const id of queue) {
    const dot = id.indexOf(".");
    const rid = runs[Number(id.slice(0, dot)) - 1]?.rid;
    if (rid) by.set(rid, [...(by.get(rid) ?? []), id.slice(dot + 1)]);
  }
  return [...by]
    .map(([rid, ids]) => `weaver open ${rid} ${ids.join(" ")} --why "asked to read it"`)
    .join(" && ");
}

export function RunGraph({ run, failed, card }: RunGraphProps) {
  if (failed)
    return (
      <Empty title="This run didn't load">
        <span>{failed}</span>
      </Empty>
    );
  if (!run) return <Loading shape="cards" lines={3} heading label="Loading the run" />;
  return <Graph key={run.rid} run={run} card={card} />;
}

function Graph({ run, card }: { run: RunGraphData; card?: boolean | undefined }) {
  const L = useMemo(() => indexRun(run), [run]);
  // a merged graph counts runs where one run counts rounds
  const step = stepOf(run);
  const [wide, setWide] = useState(true);
  const [round, setRound] = useState(0);
  const [tab, setTab] = useState<"c" | "q" | "d">("q");
  const [pick, setPickS] = useState<Pick | null>(null);
  const [hover, setHover] = useState<Pick | null>(null);
  const [hole, setHole] = useState<string | null>(null);
  const [sort, setSort] = useState<[string, number]>(["kept", -1]);
  const [dq, setDq] = useState("");
  const [exp, setExp] = useState<ReadonlySet<string>>(new Set());
  const [lift, setLift] = useState<ReadonlySet<number>>(new Set());
  const [more, setMore] = useState<ReadonlyMap<string, number>>(new Map());
  const [gone, setGone] = useState<string[]>([]);
  const [fonts, setFonts] = useState(0);
  const [fitN, setFitN] = useState(0);
  const [tip, setTip] = useState<{ id: number; el: HTMLElement } | null>(null);
  const [copied, setCopied] = useState(false);
  const qKey = `weaver-read:${L.run.rid}`;
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
  const shown = useRef<string[]>([]);
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
  const live = useRef({ pick, wide, merged: !!L.run.runs });
  live.current = { pick, wide, merged: !!L.run.runs };

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

  // the scene: what the web shows; positions come later, from the marks' sizes
  const ws = { exp, lift, more, wide };
  const pres = useMemo(() => presentSet(L, { exp, lift, more, wide }), [L, exp, lift, more, wide]);
  const wE = useMemo(() => webEdges(L, pres.order, pres.par), [L, pres]);
  const shelf = useMemo(() => shelfOf(L, (id) => pres.par.has(`s${id}`)), [L, pres]);
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
    if (p?.t === "n") return { S: new Set(), C: new Set(), Q: new Set(), K: nbrs(p.key) };
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
    if (f && p) f.K = nbrs(pkey(p));
    return f;
  }, [pick, hover, hole, L, wE]);
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
    // several runs: a search or source in a closed run opens that run first
    const r = !L.many
      ? undefined
      : p?.t === "q"
        ? L.byQ.get(p.i)?.r
        : p?.t === "s" && !pres.par.has(`s${p.id}`) && L.byId.get(p.id)?.s.kept
          ? L.many.of.get(p.id)?.[0]
          : undefined;
    if (r && !exp.has(`r${r}`)) {
      const np = presentSet(L, { exp: new Set(exp).add(`r${r}`), lift, more, wide });
      pend.current = { ...pend.current, anim: true, fk: `r${r}` };
      setExp(np.exp);
      setMore(np.more);
    }
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
  const cmd = L.run.runs
    ? mergedOpen(L.run.runs, queue)
    : `weaver open ${L.run.rid} ${[...queue].join(" ")} --why "asked to read it"`;

  const toRound = (r: number) => {
    setRound(r);
    if (pick?.t === "s" && r && (L.byId.get(pick.id)?.s.r ?? 0) > r) setPick(null);
  };

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
    if (closing && !reduced()) {
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
    let B = wg.fitB;
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
    // one run opens readable (round 13 at 1:1), the rims cropped; several runs fit whole. Past the
    // floor the cards stop reading: it centers there
    const fit = Math.min(1, R.w / bw, R.h / bh);
    const k = live.current.wide && !live.current.merged ? Math.max(fit, 0.9) : Math.max(fit, 0.4);
    const tx = R.l + (R.w - bw * k) / 2 - B.x0 * k;
    const ty = R.t + (R.h - bh * k) / 2 - B.y0 * k;
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
    // a run opens into its own web: zoom in to read it, as one run's page opens
    const run = key[0] === "r";
    if (
      !run &&
      t.applyX(B.x0) >= R.l + pad &&
      t.applyX(B.x1) <= R.r - pad &&
      t.applyY(B.y0) >= R.t + pad &&
      t.applyY(B.y1) <= R.b - pad
    )
      return;
    const k = Math.max(
      0.3,
      Math.min(run ? 1 : t.k, (R.w - pad * 2) / (B.x1 - B.x0), (R.h - pad * 2) / (B.y1 - B.y0)),
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
  const sig = [wide, fonts, [...exp], [...lift], [...more]].join("|");
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
    // seen before (this mount or another): its places come back; a live run's new nodes grow
    // from their parents while the rest hold
    const seen = anim ? null : placesOf(L.run.rid, wide, order);
    if (seen)
      for (const n of fresh) {
        const at = seen.at.get(n.key);
        if (!at) continue;
        [n.x, n.y] = at;
        fresh.delete(n);
      }
    const grow = !!seen && !seen.exact && fresh.size < N.size;
    const moving = anim || grow;
    let solved: ReturnType<typeof solveWeb>;
    if (seen?.exact) {
      const all = order.map((k) => N.get(k) as WNode);
      // sizes may have moved since (fonts): the places stand, overlaps part
      settle(all, wide);
      solved = { all, from: new Map(), to: new Map() };
    } else
      solved = solveWeb({ L, N, order, par, E: wE, fresh, anim: moving, fk: p.fk, wide, shelfAt });
    const { all, from, to } = solved;
    keepPlaces(L.run.rid, wide, order, N);
    if (!anim) wg.fitB = all.length ? webBox(all) : null;
    wg.shelf = layShelf(shelf, size, wide);
    wg.at = "";
    const draw = () => {
      for (const o of all) put(o.key, { x: o.x - o.w / 2, y: o.y - o.h / 2, w: o.w, h: o.h });
      for (const e of wE) {
        const A = N.get(e.a);
        const B = N.get(e.b);
        const path = paths.get(e.id);
        if (!A || !B || !path) continue;
        if (e.kind !== "hub")
          path.setAttribute("d", `M${f1(A.x)},${f1(A.y)}L${f1(B.x)},${f1(B.y)}`);
        else {
          // hub edges bow a little, so two that share a line still read apart
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
    if (!moving || reduced()) {
      draw();
      if (opened) showOpen(opened);
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
    if (x.h.web) return toggleNode(x.h.web, !!x.h.shelf);
    setPick(toggle && same(pick, x.h.pick) ? null : x.h.pick);
  };
  const onStageClick = (e: React.MouseEvent) => {
    const t = e.target as Element;
    if (t.closest(".rg-panel,.rg-side,.rg-nodes a")) return;
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
    const x = hitOf(t);
    if (!x) return;
    e.preventDefault();
    act(x, false);
  };

  // the marks
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
  {
    const on = new Set(pres.order);
    const goneNow = new Set(gone.filter((k) => !on.has(k)));
    // the last order kept: a DOM move would drop a closing mark's transition
    const was = shown.current.filter((k) => on.has(k) || goneNow.has(k));
    const had = new Set(was);
    shown.current = [...was, ...pres.order.filter((k) => !had.has(k))];
    for (const k of shown.current) {
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
          style={e.kind === "hub" ? { strokeWidth: Math.min(5, 1.1 + 0.9 * (e.w - 1)) } : undefined}
        />,
      );
    // the shelf: sources with no finding
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
    for (const g of shelf.quiet) {
      marks.push(
        <div key={`shq${g.id}`} ref={reg(`shq${g.id}`)} className="lh">
          {g.t} <span>{g.ns.length}</span>
        </div>,
      );
      for (const n of g.ns) marks.push(chip(n, "dot"));
    }
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
  const head = headOf(L.run.t);
  const tipN = tip ? L.byId.get(tip.id) : undefined;
  const empty = !L.nodes.length && !L.run.searches.length;

  return (
    <div className={cls("rg", card && "card")}>
      <Bars
        L={L}
        round={round}
        step={step}
        toRound={toRound}
        zoomBy={(k) =>
          stageRef.current &&
          zoomRef.current &&
          select(stageRef.current).transition().duration(250).call(zoomRef.current.scaleBy, k)
        }
        reset={() => {
          setHole(null);
          setExp(new Set());
          setLift(new Set());
          setMore(new Map());
          setPick(null);
          askFit(400);
        }}
      />
      {card ? null : (
        <div className="runhead">
          <h3>{head.t}</h3>
          {head.ask && wide ? <p className="ask">{head.ask}</p> : null}
          {head.ask && !wide ? (
            <details className="ask">
              <summary>Whole ask</summary>
              <p>{head.ask}</p>
            </details>
          ) : null}
          {L.run.note ? <p>{L.run.note}</p> : null}
          <p className="mt">
            {L.run.meta ? `${L.run.meta} · ` : ""}
            {L.run.runs ? "" : `${pl(L.rounds.length, "round")} · `}
            {pl(L.run.searches.length, "search")} · {f.hits} hits, {f.kept} kept, {f.read} read,{" "}
            {pl(f.findings, "finding")}, {pl(f.claims, "claim")}
          </p>
        </div>
      )}
      {card ? null : (
        <p className="lookcap">
          {L.run.runs
            ? "Each tinted card is a run: its ask and its note. Lines run to the sources it kept findings from; a source two runs read links them. Click a run to open its searches."
            : "Each tinted card is a search and its best answer. Lines run to the sources it found that hold findings; a thicker line carries more."}
        </p>
      )}
      {/* biome-ignore lint/a11y/useSemanticElements: a positioned stage, not a form group; it delegates the marks' clicks and keys */}
      <div
        ref={stageRef}
        className={cls("rg-stage", F && "fx", pick && "open")}
        role="group"
        aria-label="The run as a web: each search a card with its answer, lines from each search to the sources it found that hold findings."
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
            {pic(tipN.s) ? (
              <img className="th" referrerPolicy="no-referrer" src={pic(tipN.s) ?? ""} alt="" />
            ) : null}
            <b>
              <Ico s={tipN.s} />
              <span>{tipN.s.name}</span>
            </b>
            <small>
              {SPEAKERS[tipN.s.kind].one} · {step} {tipN.s.r} · {countOf(tipN)}
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
      {card ? null : (
        <Summary
          L={L}
          hole={hole}
          setHole={(h) => {
            if (pick) setPick(null);
            setHole(h === hole ? null : h);
          }}
        />
      )}
      {card ? null : <Key runs={!!L.run.runs} />}
      {card ? null : (
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
            setPick({ t: "s", id: n.id }, true);
          }}
        />
      )}
    </div>
  );
}
