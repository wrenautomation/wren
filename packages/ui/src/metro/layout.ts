/**
 * `layoutMetro(view)`: places a `MetroView` as a `MetroScene`. Pure and sync.
 *
 * Columns are zones, left to right. Each line is a row. The hub is one marker across the rows it
 * joins; the stations that lead into it sit left of it and the offer lines start right of it, so no
 * track passes under it. An exit sits under its source. A track between two lines becomes a 45
 * degree transfer. Rows are ordered to cut crossings.
 *
 * The layout owns every place. A name goes above or below its station, whichever is free. A task
 * chip sits in the middle of the free part of its track, or folds to a count dot. When something
 * does not fit, the whole map takes a wider step, and then a taller row. Drawing only follows.
 *
 * It draws any list of stations and tracks it gets: an unknown column or line makes a new one, and
 * a track to nothing is dropped.
 */

import {
  along,
  type Box,
  CHIP_ROOM,
  chipBox,
  crossingsOf,
  dotBox,
  labelBoxes,
  lengthOf,
  markBoxes,
  overlaps,
  pillBox,
  routeHits,
  routeOf,
  sceneBoxes,
  textWidth,
  trackEnds,
  xferBox,
  xferGeometry,
} from "./geometry.js";
import {
  isMark,
  type MarkStation,
  type MetroScene,
  type MetroTrack,
  type Point,
  type Side,
  type StationKind,
  type Weight,
  type Zone,
} from "./types.js";
import {
  DEFAULT_COLUMNS,
  type MetroView,
  type ViewKind,
  type ViewLine,
  type ViewStation,
  type ViewTrack,
} from "./view.js";

/** Space the layout starts with, in px. It widens these when a name or a chip needs room. */
export const SPACE = {
  /** Between stations in a column. The same for the whole map. */
  step: 120,
  /** A row without exits; one with exits adds `exit`. */
  row: 96,
  exit: 70,
  /** Above the first row (room for the hub's name). */
  top: 68,
  /** Zone names at the foot. */
  foot: 34,
};

/**
 * How much wider a retry makes the step and the row, and how many times it may. The layout widens
 * the step first (a chip needs width); a row grows only when names above and below meet.
 */
const GROW = { step: 12, row: 10, maxStep: 5, maxRow: 2 };

/** The widenings to try, in order: none first, then the cheapest. The last one folds chips to dots. */
const TRIES: [number, number][] = [];
for (let t = 0; t <= GROW.maxStep + GROW.maxRow; t++)
  for (let ky = 0; ky <= Math.min(t, GROW.maxRow); ky++)
    if (t - ky <= GROW.maxStep) TRIES.push([t - ky, ky]);
/** Air between two names, or a name and a mark. */
const CLEAR = 6;
/** Air between a chip and a name, a transfer's label or another chip. Marks get `CHIP_ROOM`. */
const CHIP_CLEAR = 3;
/** The least room between the drawing and the scene's edge. */
const EDGE = 8;

const KIND: Record<ViewKind, StationKind> = {
  att: "att",
  time: "time",
  cash: "cash",
  exit: "exit",
  hub: "hub",
  plan: "plan",
  dec: "dec",
  race: "race",
  split: "par",
  join: "par",
  ab: "ab",
  ok: "ok",
  link: "link",
};

const WEIGHT_OF: Record<ViewLine["tier"], Weight> = { out: "out", front: "front", core: "core" };

/** The key a scene uses for a line: "out" for any outreach line, the id for an offer. */
const keyOf = (l: ViewLine) => (l.tier === "out" ? "out" : l.id);

/**
 * The key `lit` and a mark's `data-l` take for a line: "out" for any outreach line, the id for an
 * offer's line. An id the view does not list is its own key.
 */
export function lineKeyOf(view: Pick<MetroView, "lines">, lineId: string): string {
  const l = view.lines.find((x) => x.id === lineId);
  return l ? keyOf(l) : lineId;
}

/** What the view says, read once: the same for every try. */
interface Prep {
  view: MetroView;
  columns: string[];
  line: Map<string, ViewLine>;
  byId: Map<string, ViewStation>;
  hub: ViewStation | undefined;
  /** The source of each exit, and the line an exit hangs under. */
  exitOf: Map<string, string>;
  exitsOn: Set<string>;
  /** Lines that have a track into or out of the hub. */
  joined: Set<string>;
  /** The lines in the order the view gives them: joined first, outreach before offers. */
  base: ViewLine[];
}

const rankOf = (p: Pick<Prep, "joined">, l: ViewLine) =>
  (p.joined.has(l.id) ? 0 : 2) + (l.tier === "out" ? 0 : 1);

function prepare(view: MetroView): Prep {
  const columns = [...(view.columns ?? DEFAULT_COLUMNS)];
  for (const s of view.stations) if (!columns.includes(s.column)) columns.push(s.column);

  // Lines: those given, then any a station names.
  const lines = [...view.lines];
  for (const s of view.stations) {
    if (s.kind !== "hub" && !lines.some((l) => l.id === s.line))
      lines.push({ id: s.line, tier: "front" });
  }
  const byId = new Map(view.stations.map((s) => [s.id, s]));
  const hub = view.stations.find((s) => s.kind === "hub");

  // An exit hangs under its source: the station a track leads from into it.
  const exitOf = new Map<string, string>();
  for (const t of view.tracks) {
    const to = byId.get(t.to);
    if (to?.kind === "exit" && byId.has(t.from) && !exitOf.has(to.id)) exitOf.set(to.id, t.from);
  }
  const homeOf = (s: ViewStation): ViewStation => {
    const src = exitOf.get(s.id);
    const from = src ? byId.get(src) : undefined;
    return s.kind === "exit" && from ? homeOf(from) : s;
  };
  const exitsOn = new Set(
    view.stations.filter((s) => s.kind === "exit" && exitOf.has(s.id)).map((s) => homeOf(s).line),
  );

  // The hub spans the rows it joins, so those rows go together at the top.
  const joined = new Set<string>();
  for (const t of view.tracks) {
    const a = byId.get(t.from);
    const b = byId.get(t.to);
    if (!a || !b) continue;
    if (b.kind === "hub" && a.kind !== "hub") joined.add(a.line);
    if (a.kind === "hub" && b.kind !== "hub") joined.add(b.line);
  }
  const p = { joined };
  const base = [...lines].sort((a, b) => rankOf(p, a) - rankOf(p, b));
  return {
    view,
    columns,
    line: new Map(lines.map((l) => [l.id, l])),
    byId,
    hub,
    exitOf,
    exitsOn,
    joined,
    base,
  };
}

// ---------------------------------------------------------------------------------------------
// Rows: the order of the lines.

/** Swap two neighbours that sit in the same class (outreach or offer, joined or not). */
const swapAt = <T>(a: readonly T[], i: number): T[] => {
  const b = [...a];
  [b[i], b[i + 1]] = [b[i + 1] as T, b[i] as T];
  return b;
};

/**
 * The order of the rows. Start from the view's order and from the mean row of each line's
 * neighbours (the lines a transfer joins it to), then swap neighbours while a swap cuts a crossing.
 * Ties keep the view's order, so the same view always gives the same map.
 */
function orderRows(p: Prep): ViewLine[] {
  const score = (o: readonly ViewLine[]) => crossingsOf(build(p, o, 0, 0).scene);
  const start = score(p.base);
  if (start === 0) return p.base;

  const links = new Map<string, string[]>();
  for (const t of p.view.tracks) {
    const a = p.byId.get(t.from);
    const b = p.byId.get(t.to);
    if (!a || !b || a.kind === "hub" || b.kind === "hub" || a.line === b.line) continue;
    links.set(a.line, [...(links.get(a.line) ?? []), b.line]);
    links.set(b.line, [...(links.get(b.line) ?? []), a.line]);
  }
  const barycentre = (order: ViewLine[]): ViewLine[] => {
    let cur = order;
    for (let sweep = 0; sweep < 3; sweep++) {
      const row = new Map(cur.map((l, i) => [l.id, i]));
      const key = (l: ViewLine) => {
        const near = links.get(l.id);
        return near?.length
          ? near.reduce((n, id) => n + (row.get(id) ?? 0), 0) / near.length
          : (row.get(l.id) ?? 0);
      };
      // Sort inside each class only; the classes keep their place.
      cur = [...cur].sort((a, b) => rankOf(p, a) - rankOf(p, b) || key(a) - key(b));
    }
    return cur;
  };
  const climb = (from: ViewLine[]): [ViewLine[], number] => {
    let order = from;
    let best = score(order);
    for (let sweep = 0; sweep < 4 && best > 0; sweep++) {
      let moved = false;
      for (let i = 0; i + 1 < order.length; i++) {
        const a = order[i] as ViewLine;
        const b = order[i + 1] as ViewLine;
        if (rankOf(p, a) !== rankOf(p, b)) continue;
        const next = swapAt(order, i);
        const n = score(next);
        if (n < best) {
          order = next;
          best = n;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return [order, best];
  };
  const [a, na] = climb(p.base);
  const [b, nb] = climb(barycentre(p.base));
  return nb < na ? b : a;
}

// ---------------------------------------------------------------------------------------------
// The frame: stations and tracks at their places, with no names or chips yet.

/** The width of a column with no station: its name, set at 9.5px with wide letter spacing. */
const emptyWidth = (name: string) =>
  Math.max(48, Math.ceil(textWidth(name, 9.5, true) + name.length * 0.95 + 16));

function build(
  p: Prep,
  order: readonly ViewLine[],
  kx: number,
  ky: number,
): { scene: MetroScene; bottom: number } {
  const { view, columns, line, byId, hub, exitOf } = p;
  const step = SPACE.step + kx * GROW.step;
  const rowH = SPACE.row + ky * GROW.row;
  const inset = step / 2;

  // Rows.
  const rowY = new Map<string, number>();
  let y = SPACE.top;
  for (const l of order) {
    rowY.set(l.id, y);
    y += rowH + (p.exitsOn.has(l.id) ? SPACE.exit : 0);
  }
  const firstY = SPACE.top;
  const bottom = Math.max(y - rowH + 56, firstY + 56);
  // The hub spans the rows it joins; with no track it is a plain marker on the first row.
  const joinedY = order.filter((l) => p.joined.has(l.id)).map((l) => rowY.get(l.id) ?? firstY);
  const hubSpan: [number, number] = joinedY.length
    ? [Math.min(...joinedY), Math.max(...joinedY)]
    : [firstY, firstY];

  // Columns. One step for the whole map: a column is as wide as the most stations one line holds
  // in it. In the hub's column the outreach stations come first, then the hub, then the offers.
  const offerSide = (s: ViewStation) => line.get(s.line)?.tier !== "out";
  const hubCol = hub ? columns.indexOf(hub.column) : -1;
  const most = columns.map((c, ci) => {
    const per = new Map<string, number>();
    for (const s of view.stations) {
      if (s.column !== c || s.kind === "exit" || s.kind === "hub") continue;
      const key = ci === hubCol && offerSide(s) ? `+${s.line}` : s.line;
      per.set(key, (per.get(key) ?? 0) + 1);
    }
    let left = 0;
    let right = 0;
    for (const [key, n] of per) {
      if (key.startsWith("+")) right = Math.max(right, n);
      else left = Math.max(left, n);
    }
    return { left, right };
  });
  const slots = columns.map((_, ci) => {
    const m = most[ci] ?? { left: 0, right: 0 };
    return ci === hubCol ? m.left + 1 + m.right : m.left;
  });
  const widths = columns.map((c, ci) =>
    (slots[ci] ?? 0) ? (slots[ci] ?? 0) * step : emptyWidth(c),
  );
  const x0 = columns.map((_, i) => widths.slice(0, i).reduce((a, b) => a + b, 0));
  const zones = columns.map((c, i): Zone => [x0[i] ?? 0, (x0[i] ?? 0) + (widths[i] ?? 0), c]);
  const taken = new Map<string, number>();
  const xOf = (s: ViewStation) => {
    const ci = columns.indexOf(s.column);
    const m = most[ci] ?? { left: 0, right: 0 };
    if (s.kind === "hub") return (x0[ci] ?? 0) + inset + m.left * step;
    const right = ci === hubCol && offerSide(s);
    const key = `${ci}:${right ? "+" : ""}${s.line}`;
    const n = taken.get(key) ?? 0;
    taken.set(key, n + 1);
    return (x0[ci] ?? 0) + inset + (right ? m.left + 1 + n : n) * step;
  };

  // Stations.
  const pos = new Map<string, Point>();
  const st: MarkStation[] = [];
  for (const s of view.stations) {
    if (s.kind === "exit" && exitOf.has(s.id)) continue;
    const isHub = s.kind === "hub";
    const x = xOf(s);
    const sy = isHub ? hubSpan[0] : (rowY.get(s.line) ?? firstY);
    pos.set(s.id, [x, sy]);
    st.push(mark(s, x, sy, isHub ? { span: hubSpan } : {}, line));
  }
  // Exits: under the source, one step to the right for each further exit of the same source.
  const exits = new Map<string, number>();
  for (const s of view.stations) {
    const src = exitOf.get(s.id);
    if (s.kind !== "exit" || !src) continue;
    const from = pos.get(src);
    if (!from) continue;
    const n = exits.get(src) ?? 0;
    exits.set(src, n + 1);
    const q: Point = [from[0] + n * 64, from[1] + SPACE.exit];
    pos.set(s.id, q);
    st.push(mark(s, q[0], q[1], { p: "right" }, line));
  }

  // Tracks.
  const lineOf = (s: ViewStation) => (s.kind === "hub" ? undefined : line.get(s.line));
  const tr: MetroTrack[] = [];
  view.tracks.forEach((t, i) => {
    const a = byId.get(t.from);
    const b = byId.get(t.to);
    const pa = pos.get(t.from);
    const pb = pos.get(t.to);
    if (!a || !b || !pa || !pb) return;
    // The store's track id when given; else from-to. A repeat id gets its index.
    const own = t.id ?? `${t.from}-${t.to}`;
    const id = tr.some((r) => r.id === own) ? `${own}-${i}` : own;
    const la = lineOf(a);
    const lb = lineOf(b);
    // The track's own mark, else the mark of the line it sits on (the line it joins, for a transfer).
    const markOf = t.mark ?? (b.kind === "hub" ? la : (lb ?? la))?.mark;
    if (b.kind === "exit") {
      tr.push({
        id,
        k: "exit",
        a: a.id,
        b: b.id,
        ...(markOf ? { mark: markOf } : {}),
        ...(t.label ? { cond: t.label } : {}),
      });
      return;
    }
    const owner = t.by === "person" ? who(t) : undefined;
    const common = {
      id,
      ...(markOf ? { mark: markOf } : {}),
      ...(owner ? { who: owner } : {}),
      ...(t.late ? { late: true } : {}),
      ...(t.task ? { task: t.task } : {}),
      ...(t.moving ? { mv: true } : {}),
    };
    if (a.kind === "hub") {
      // A line starts at the hub, on its own row.
      const l = lb ?? la;
      tr.push({
        ...common,
        a: a.id,
        b: b.id,
        l: l ? keyOf(l) : "out",
        w: l ? WEIGHT_OF[l.tier] : "front",
        oa: pb[1] - pa[1],
        ...(l?.plan || t.plan ? { k: "plan" as const } : {}),
        ...(t.label ? { cond: t.label } : {}),
      });
    } else if (b.kind === "hub") {
      // Outreach ends at the hub, on the row it came from.
      tr.push({ ...common, a: a.id, b: b.id, l: "out", w: "out", ob: pa[1] - pb[1] });
    } else if (la && lb && la.id !== lb.id) {
      // The person moves to another line: a transfer in the colour of the line they join.
      tr.push({ ...common, a: a.id, b: b.id, k: "xfer", l: keyOf(lb), lab: t.label ?? "transfer" });
    } else {
      const l = la ?? lb;
      tr.push({
        ...common,
        a: a.id,
        b: b.id,
        l: l ? keyOf(l) : "out",
        w: l ? WEIGHT_OF[l.tier] : "front",
        ...(l?.plan || t.plan ? { k: "plan" as const } : {}),
        ...(t.label ? { cond: t.label } : {}),
      });
    }
  });

  const colours: Record<string, number> = {};
  for (const l of order) if (l.tier !== "out") colours[l.id] = l.colour ?? 0;
  const lineMap = Object.fromEntries(
    view.stations
      .filter((s) => s.kind !== "hub")
      .map((s) => [
        s.line,
        {
          n: line.get(s.line)?.offer ?? s.line,
          l: keyOf(line.get(s.line) ?? { id: s.line, tier: "front" }),
        },
      ]),
  );
  const last = zones[zones.length - 1];
  return {
    bottom,
    scene: {
      ...(view.title ? { title: view.title } : {}),
      w: last?.[1] ?? 0,
      h: bottom + SPACE.foot,
      zones,
      st,
      tr,
      colours,
      // A map from a view is for people: its stations and tracks take focus and clicks.
      click: true,
      lines: lineMap,
      ...(view.groups
        ? { groups: Object.fromEntries(view.groups.map((g) => [g.id, g.label])) }
        : {}),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Names and chips.

/** Boxes to keep a gap from. */
type Clear = readonly [obstacles: readonly Box[], gap: number];

const blocked = (box: Box, clears: readonly Clear[]) =>
  clears.some(([obstacles, gap]) => obstacles.some((o) => overlaps(box, o, gap)));

/**
 * The middle of the longest free run of a route: the point where a box set there clears every
 * obstacle by its own gap. Null when no point on the route is free.
 */
function freeSpot(
  pts: readonly Point[],
  boxAt: (at: Point) => Box,
  ...clears: Clear[]
): Point | null {
  const n = Math.max(2, Math.ceil(lengthOf(pts)));
  let best: [number, number] | null = null;
  let from = -1;
  for (let i = 0; i <= n + 1; i++) {
    const free = i <= n && !blocked(boxAt(along(pts, i / n)), clears);
    if (free && from < 0) from = i;
    if (!free && from >= 0) {
      if (!best || i - from > best[1]) best = [from, i - from];
      from = -1;
    }
  }
  return best ? along(pts, (best[0] + (best[1] - 1) / 2) / n) : null;
}

/**
 * Choose a side for every name and a place for every chip. Names go above, else below, else beside
 * their station. A chip goes in the middle of the free part of its track; when none is free the
 * chip folds to a dot if `fold` allows it, else the try fails and the map widens.
 */
function dress(sc: MetroScene, fold: boolean): boolean {
  const marks = sc.st.filter(isMark);
  const ends = trackEnds(sc);
  const routes: { r: MetroTrack; pts: Point[] }[] = [];
  for (const r of sc.tr) {
    const e = ends(r);
    if (e && !r.stub) routes.push({ r, pts: routeOf(r, e[0], e[1]) });
  }
  const own = new Map(marks.map((s) => [s.id, markBoxes(s)]));
  const xfers: Box[] = [];
  for (const { r, pts } of routes) {
    if (r.k !== "xfer") continue;
    const [a, c] = [pts[0] as Point, pts[pts.length - 1] as Point];
    xfers.push(xferBox(xferGeometry(a, c, r.f).m, r.lab ?? ""));
  }

  let ok = true;
  const names: Box[] = [];
  for (const s of marks) {
    if (!s.n) continue;
    const sides: Side[] =
      s.t === "exit" ? ["right", "down", "up", "left"] : ["up", "down", "right", "left"];
    let best: { p: Side; boxes: Box[]; hard: number; soft: number } | undefined;
    for (const p of sides) {
      const boxes = labelBoxes({ ...s, p });
      // A hard clash: a name on another name, a mark or a transfer's label. A soft one: a track.
      let hard = 0;
      let soft = 0;
      for (const b of boxes) {
        for (const [id, mine] of own)
          for (const o of mine) if (overlaps(b, o, id === s.id ? 0 : CLEAR)) hard++;
        for (const o of [...xfers, ...names]) if (overlaps(b, o, CLEAR)) hard++;
        for (const { pts } of routes) if (routeHits(pts, b)) soft++;
      }
      if (!best || hard < best.hard || (hard === best.hard && soft < best.soft))
        best = { p, boxes, hard, soft };
    }
    if (!best) continue;
    if (best.hard) ok = false;
    if (best.p !== "up") s.p = best.p;
    names.push(...best.boxes);
  }

  // Chips go where nothing else is: `CHIP_ROOM` from a mark, `CHIP_CLEAR` from names, transfer
  // labels and the chips placed before.
  const solid: Box[] = [...own.values()].flat();
  const taken: Box[] = [...xfers, ...names];
  for (const { r, pts } of routes) {
    if (r.cond) {
      const glyph = r.condGlyph ?? null;
      const at = freeSpot(
        pts,
        (q) => chipBox(q[0], q[1], r.cond as string, glyph),
        [solid, CHIP_ROOM],
        [taken, CHIP_CLEAR],
      );
      if (at) {
        r.cat = at;
        taken.push(chipBox(at[0], at[1], r.cond, glyph));
      } else ok = false;
    }
    if (!r.who || r.who === "auto" || r.k === "exit" || r.k === "xfer") continue;
    const who = r.who;
    const at = freeSpot(pts, (q) => pillBox(q, who), [solid, CHIP_ROOM], [taken, CHIP_CLEAR]);
    if (at) {
      r.at = at;
      taken.push(pillBox(at, who));
      continue;
    }
    if (!fold) {
      ok = false;
      continue;
    }
    // No room for the pill: a dot, in the middle of the longest free run, else at the middle.
    const dot = freeSpot(pts, dotBox, [solid, CHIP_CLEAR], [taken, CHIP_CLEAR]) ?? along(pts, 0.5);
    r.at = dot;
    r.dot = 1;
    taken.push(dotBox(dot));
  }
  return ok;
}

/** Move the scene right and down by `dx` and `dy`. */
function shift(sc: MetroScene, dx: number, dy: number) {
  if (!dx && !dy) return;
  for (const s of sc.st) {
    if (isMark(s)) {
      s.x += dx;
      s.y += dy;
      if (s.span) s.span = [s.span[0] + dy, s.span[1] + dy];
    }
  }
  for (const r of sc.tr) {
    if (r.at) r.at = [r.at[0] + dx, r.at[1] + dy];
    if (r.cat) r.cat = [r.cat[0] + dx, r.cat[1] + dy];
  }
  sc.zones = (sc.zones ?? []).map(([a, b, n], i): Zone => [i ? a + dx : 0, b + dx, n]);
}

/** Fit the scene to what is drawn: shift in what hangs over the edge, then size it to the boxes. */
function sizeTo(sc: MetroScene, bottom: number): MetroScene {
  const b = sceneBoxes(sc);
  const all = [...b.labels, ...b.marks, ...b.hub, ...b.chips, ...b.tracks].map((x) => x.box);
  const ends = trackEnds(sc);
  for (const r of sc.tr) {
    const e = ends(r);
    if (!e) continue;
    for (const [x, y] of routeOf(r, e[0], e[1])) all.push({ x0: x, y0: y, x1: x, y1: y });
  }
  const minX = Math.min(...all.map((x) => x.x0));
  const minY = Math.min(...all.map((x) => x.y0));
  const dx = minX < EDGE ? EDGE - minX : 0;
  const dy = minY < EDGE ? EDGE - minY : 0;
  shift(sc, dx, dy);
  const maxX = Math.max(...all.map((x) => x.x1)) + dx;
  const maxY = Math.max(...all.map((x) => x.y1)) + dy;
  sc.h = Math.ceil(Math.max(bottom + dy, maxY + 12)) + SPACE.foot;
  // The drawing sets the width. A last zone with no station keeps its own width, for its name.
  const zs = sc.zones ?? [];
  const lastZone = zs[zs.length - 1];
  if (!lastZone) {
    sc.w = Math.ceil(maxX + EDGE);
    return sc;
  }
  const empty = !sc.st.some((s) => (s.x ?? 0) >= lastZone[0]);
  sc.w = Math.ceil(Math.max(maxX + EDGE, empty ? lastZone[1] : 0));
  // The last zone reaches the edge: no dead space at the right.
  zs[zs.length - 1] = [lastZone[0], sc.w, lastZone[2]];
  return sc;
}

export function layoutMetro(view: MetroView): MetroScene {
  const p = prepare(view);
  const order = orderRows(p);
  let out: MetroScene | undefined;
  for (const [i, [kx, ky]] of TRIES.entries()) {
    const { scene, bottom } = build(p, order, kx, ky);
    const ok = dress(scene, i === TRIES.length - 1);
    out = sizeTo(scene, bottom);
    if (ok) break;
  }
  return out as MetroScene;
}

/** "WJ · 4h": the owner and the promise. */
function who(t: ViewTrack): string {
  return `${t.owner ?? "?"} · ${t.promise ?? "?"}`;
}

function mark(
  s: ViewStation,
  x: number,
  y: number,
  extra: Partial<MarkStation>,
  lines: Map<string, ViewLine>,
): MarkStation {
  // Its own mark, else its line's. The hub joins every line, so it has no line mark.
  const m = s.mark ?? (s.kind === "hub" ? undefined : lines.get(s.line)?.mark);
  return {
    id: s.id,
    t: KIND[s.kind],
    x,
    y,
    ...(s.label ? { n: s.label } : {}),
    ...(s.sub ? { s: s.sub } : {}),
    ...(s.bad ? { bad: true } : {}),
    ...(s.bundle ? { bundle: true } : {}),
    ...(s.rule ? { rule: s.rule } : {}),
    ...(s.repeat ? { rep: s.repeat } : {}),
    ...(s.repeatIcon !== undefined ? { repGlyph: s.repeatIcon } : {}),
    ...(s.plans ? { plans: s.plans } : {}),
    ...(s.kind === "hub" ? {} : { ln: s.line }),
    ...(s.group ? { g: s.group } : {}),
    ...(s.flow ? { flow: s.flow } : {}),
    ...(s.now !== undefined ? { now: s.now } : {}),
    ...(m ? { mark: m } : {}),
    ...extra,
  };
}
