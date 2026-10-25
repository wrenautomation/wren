/**
 * `finishMetro(view, placement)`: a placer's points made into a `MetroScene`. Pure and sync. The
 * placer is `placeMetro` (place.ts, ELK).
 *
 * An exit with no point sits under its source. A track between two lines becomes a 45 degree
 * transfer. The scene owns every place. A name goes above or below its station, whichever is free.
 * A task chip sits in the middle of the free part of its track, or folds to a count dot. A track
 * back along its row runs on a rail, deep enough for its label. Drawing only follows.
 *
 * It draws any list of stations and tracks it gets: an unknown column or line makes a new one, and
 * a track to nothing is dropped.
 */
import {
  along,
  type Box,
  CHIP_H,
  CHIP_ROOM,
  chipBox,
  dotBox,
  labelBoxes,
  lengthOf,
  markBoxes,
  overlaps,
  pillBox,
  RADIUS,
  routeHits,
  routeOf,
  sceneBoxes,
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

/** Room the scene adds, in px. */
export const SPACE = {
  /** From a station down to its exit. */
  exit: 70,
  /** Zone names at the foot. */
  foot: 34,
} as const;

/** Air between two names, or a name and a mark. */
const CLEAR = 6;
/** Air between a chip and a name, a transfer's label or another chip. Marks get `CHIP_ROOM`. */
const CHIP_CLEAR = 3;
/** The least room between the drawing and the scene's edge. */
export const EDGE = 8;

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
  /** The source of each exit: an exit with no point hangs under it. */
  exitOf: Map<string, string>;
  /** The lines: those given, then any a station names. */
  base: ViewLine[];
}

function prepare(view: MetroView): Prep {
  const columns = [...(view.columns ?? DEFAULT_COLUMNS)];
  for (const s of view.stations) if (!columns.includes(s.column)) columns.push(s.column);
  const lines = [...view.lines];
  for (const s of view.stations) {
    if (s.kind !== "hub" && !lines.some((l) => l.id === s.line))
      lines.push({ id: s.line, tier: "front" });
  }
  const byId = new Map(view.stations.map((s) => [s.id, s]));
  const exitOf = new Map<string, string>();
  for (const t of view.tracks) {
    const to = byId.get(t.to);
    if (to?.kind === "exit" && byId.has(t.from) && !exitOf.has(to.id)) exitOf.set(to.id, t.from);
  }
  return {
    view,
    columns,
    line: new Map(lines.map((l) => [l.id, l])),
    byId,
    hub: view.stations.find((s) => s.kind === "hub"),
    exitOf,
    base: lines,
  };
}

// ---------------------------------------------------------------------------------------------
// The frame: stations and tracks at their places, with no names or chips yet.

/**
 * Where a placer puts the map: a point for each station, the zones, the foot of the last row. An
 * exit with no point hangs under its source. The hub's size and where each row meets it are the
 * row placer's; another placer leaves them out.
 */
export interface Placement {
  pos: ReadonlyMap<string, Point>;
  zones: Zone[];
  bottom: number;
  hubR?: number;
  meet?: ReadonlyMap<string, number>;
}

/** The scene from a placement: marks, exits under their source, and the tracks. */
function connect(p: Prep, order: readonly ViewLine[], at: Placement): MetroScene {
  const { view, line, byId, exitOf } = p;
  const { zones, meet = new Map<string, number>() } = at;
  const hubR = at.hubR ?? RADIUS.hub;

  // Stations.
  const pos = new Map<string, Point>();
  const st: MarkStation[] = [];
  for (const s of view.stations) {
    if (s.kind === "exit" && exitOf.has(s.id) && !at.pos.has(s.id)) continue;
    const q = at.pos.get(s.id);
    if (!q) continue;
    const isHub = s.kind === "hub";
    pos.set(s.id, q);
    st.push(
      mark(
        s,
        q[0],
        q[1],
        isHub && hubR > RADIUS.hub ? { r: hubR } : s.kind === "exit" ? { p: "right" } : {},
        line,
      ),
    );
  }
  // Exits: under the source, one step to the right for each further exit of the same source.
  const exits = new Map<string, number>();
  for (const s of view.stations) {
    const src = exitOf.get(s.id);
    if (s.kind !== "exit" || !src || pos.has(s.id)) continue;
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
  // Weight ranks offer lines against each other. One offer line has nothing to stand over, so
  // core draws as front: a lone 12-unit line reads as a ribbon, not as the main road.
  const ranked = [...line.values()].filter((l) => l.tier !== "out").length > 1;
  const weightOf = (l: ViewLine): Weight =>
    l.tier === "core" && !ranked ? "front" : WEIGHT_OF[l.tier];
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
        ...(t.no ? { no: true } : {}),
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
      ...(t.no ? { no: true } : {}),
    };
    if (a.kind === "hub") {
      // A line starts at the hub and bends to its own row.
      const l = lb ?? la;
      tr.push({
        ...common,
        a: a.id,
        b: b.id,
        l: l ? keyOf(l) : "out",
        w: l ? weightOf(l) : "front",
        oa: meet.get(b.line) ?? 0,
        bend: "a",
        ...(l?.plan || t.plan ? { k: "plan" as const } : {}),
        ...(t.label ? { cond: t.label } : {}),
      });
    } else if (b.kind === "hub") {
      // Outreach bends from its row into the hub.
      tr.push({
        ...common,
        a: a.id,
        b: b.id,
        l: "out",
        w: "out",
        ob: meet.get(a.line) ?? 0,
        bend: "b",
      });
    } else if (la && lb && la.id !== lb.id) {
      // The person moves to another line: a transfer in the colour of the line they join.
      tr.push({
        ...common,
        a: a.id,
        b: b.id,
        k: "xfer",
        l: keyOf(lb),
        ...(t.label ? { lab: t.label } : {}),
      });
    } else {
      const l = la ?? lb;
      tr.push({
        ...common,
        a: a.id,
        b: b.id,
        l: l ? keyOf(l) : "out",
        w: t.back ? "out" : l ? weightOf(l) : "front",
        ...(t.back ? { k: "back" as const } : l?.plan || t.plan ? { k: "plan" as const } : {}),
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
          n: line.get(s.line)?.label ?? line.get(s.line)?.offer ?? s.line,
          l: keyOf(line.get(s.line) ?? { id: s.line, tier: "front" }),
        },
      ]),
  );
  const last = zones[zones.length - 1];
  return {
    ...(view.title ? { title: view.title } : {}),
    w: last?.[1] ?? 0,
    h: at.bottom + SPACE.foot,
    zones,
    st,
    tr,
    colours,
    // A map from a view is for people: its stations and tracks take focus and clicks.
    click: true,
    lines: lineMap,
    ...(view.groups ? { groups: Object.fromEntries(view.groups.map((g) => [g.id, g.label])) } : {}),
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
 * How far under its row the first rail runs, and the step to the next one. A rail that shows a
 * branch label runs deep enough for the label to keep `CHIP_ROOM` from every mark on the row, so
 * the label fits under any station and no column widens for it.
 */
const RAIL = { first: 30, step: 14 };

/**
 * A hub line bends to its row by the next column, the way the placer drew its edge: a row that
 * starts further on then never takes a line across the rows between.
 */
function reach(sc: MetroScene) {
  const byId = new Map(sc.st.filter(isMark).map((s) => [s.id, s]));
  const xs = [...new Set(sc.st.filter(isMark).map((s) => s.x))].sort((p, q) => p - q);
  for (const r of sc.tr) {
    const hub = byId.get((r.bend === "a" ? r.a : r.bend === "b" ? r.b : undefined) ?? "");
    if (!hub) continue;
    const i = xs.indexOf(hub.x);
    const next = r.bend === "a" ? xs[i + 1] : xs[i - 1];
    if (next !== undefined) r.reach = Math.abs(next - hub.x);
  }
}

/**
 * A track back to an earlier station on its own row would draw under the line itself, and its
 * chip would sit on the stations between. It runs on a rail under the row instead; a loop between
 * two rows runs under the lower one. Tracks back to one station with one branch label share a rail
 * and show the label once.
 */
function rails(sc: MetroScene) {
  const byId = new Map(sc.st.filter(isMark).map((s) => [s.id, s]));
  const rows = new Map<number, Map<string, MetroTrack[]>>();
  const railed = sc.tr.flatMap((r) => {
    if ((r.k && r.k !== "back") || r.pts || !r.a || !r.b) return [];
    const [a, b] = [byId.get(r.a), byId.get(r.b)];
    if (!a || !b || b.x >= a.x || (a.y !== b.y && r.k !== "back")) return [];
    return [{ r, key: `${r.b}|${r.cond ?? ""}`, y: Math.max(a.y, b.y) }];
  });
  // Loops between rows share a rail under the lowest row any of them leaves.
  const low = new Map<string, number>();
  for (const { key, y } of railed) low.set(key, Math.max(low.get(key) ?? y, y));
  // `back` is measured from the track's own lower end, so a shared rail stays one line.
  const own = new Map(railed.map(({ r, y }) => [r, y]));
  for (const { r, key } of railed) {
    const y = low.get(key) ?? 0;
    const row = rows.get(y) ?? new Map<string, MetroTrack[]>();
    row.set(key, [...(row.get(key) ?? []), r]);
    rows.set(y, row);
  }
  const startX = (r: MetroTrack) => byId.get(r.a ?? "")?.x ?? 0;
  for (const [y, row] of rows) {
    const under = Math.max(
      0,
      ...[...byId.values()].filter((s) => s.y === y).map((s) => (markBoxes(s)[0]?.y1 ?? y) - y),
    );
    const labelled = Math.ceil(under + CHIP_ROOM + CHIP_H / 2);
    let depth = 0;
    // The shortest rail runs nearest the row, so no rail crosses another's riser.
    const groups = [...row.values()].sort(
      (p, q) => Math.max(...p.map(startX)) - Math.max(...q.map(startX)),
    );
    groups.forEach((g, i) => {
      g.sort((p, q) => startX(q) - startX(p));
      depth = Math.max(i ? depth + RAIL.step : RAIL.first, g[0]?.cond ? labelled : 0);
      g.forEach((r, j) => {
        r.back = depth + y - (own.get(r) ?? y);
        if (j && r.cond) r.condShared = true;
      });
    });
  }
}

/** A route that leaves or enters the station at `s` straight up or down. */
const dropsFrom = (s: { x: number; y: number }, pts: readonly Point[]) =>
  [pts.slice(0, 2), pts.slice(-2).reverse()].some(
    ([p, q]) => p?.[0] === s.x && p[1] === s.y && q?.[0] === s.x && q[1] !== s.y,
  );

/** Whether a flat part of the route runs through `b` for half its width or more. */
const runsAlong = (pts: readonly Point[], b: Box) =>
  pts.some((q, i) => {
    const o = pts[i - 1];
    if (!o || o[1] !== q[1] || q[1] <= b.y0 || q[1] >= b.y1) return false;
    const run = Math.min(Math.max(o[0], q[0]), b.x1) - Math.max(Math.min(o[0], q[0]), b.x0);
    return run >= (b.x1 - b.x0) / 2;
  });

/**
 * Choose a side for every name and a place for every chip. Names go above, else below, else beside
 * their station. A chip goes in the middle of the free part of its track; when none is free the
 * chip folds to a dot if `fold` allows it, else the try fails and the map widens.
 * Returns the x span of each name and chip that did not fit; none when all fit.
 */
function dress(sc: MetroScene, fold: boolean): [number, number][] {
  const marks = sc.st.filter(isMark);
  const ends = trackEnds(sc);
  const routes: { r: MetroTrack; pts: Point[] }[] = [];
  for (const r of sc.tr) {
    const e = ends(r);
    if (e && !r.stub) routes.push({ r, pts: routeOf(r, e[0], e[1]) });
  }
  const own = new Map(marks.map((s) => [s.id, markBoxes(s)]));
  const bad: [number, number][] = [];
  const routeSpan = (pts: readonly Point[]): [number, number] => [
    Math.min(...pts.map((q) => q[0])),
    Math.max(...pts.map((q) => q[0])),
  ];
  // A transfer's label sits on its bend. One that meets a mark there moves to the free part of
  // its route; with no free part, it asks for room.
  const solid: Box[] = [...own.values()].flat();
  const xfers: Box[] = [];
  for (const { r, pts } of routes) {
    if (r.k !== "xfer" || !r.lab) continue;
    const lab = r.lab;
    const [a, c] = [pts[0] as Point, pts[pts.length - 1] as Point];
    const m = xferGeometry(a, c, r.f).m;
    if (!solid.some((b) => overlaps(xferBox(m, lab), b, CHIP_ROOM))) {
      xfers.push(xferBox(m, lab));
      continue;
    }
    const at = freeSpot(pts, (q) => xferBox(q, lab), [solid, CHIP_ROOM], [xfers, CHIP_CLEAR]);
    if (at) r.lat = at;
    else bad.push(routeSpan(pts));
    xfers.push(xferBox(at ?? m, lab));
  }
  const names: Box[] = [];
  // A line's first station is its terminus: its name sits before it, as on a transit map.
  const entered = new Set(sc.tr.map((r) => r.b));
  for (const s of marks) {
    if (!s.n) continue;
    const sides: Side[] =
      s.t === "exit"
        ? ["right", "down", "up", "left"]
        : entered.has(s.id) || s.t === "hub"
          ? ["up", "down", "right", "left"]
          : ["left", "up", "down", "right"];
    let best: { p: Side; boxes: Box[]; hard: number; soft: number; far: number } | undefined;
    for (const p of sides) {
      const boxes = labelBoxes({ ...s, p });
      // A hard clash: a name on another name, a mark, a transfer's label, or along a track, which
      // hides the line. A soft one: across a track.
      let hard = 0;
      let soft = 0;
      // Soft clashes with a track other than the station's own drop: room fixes these.
      let far = 0;
      for (const b of boxes) {
        for (const [id, mine] of own)
          for (const o of mine) if (overlaps(b, o, id === s.id ? 0 : CLEAR)) hard++;
        for (const o of [...xfers, ...names]) if (overlaps(b, o, CLEAR)) hard++;
        for (const { pts } of routes)
          if (runsAlong(pts, b)) hard++;
          else if (routeHits(pts, b)) {
            soft++;
            if (!dropsFrom(s, pts)) far++;
          }
      }
      if (!best || hard < best.hard || (hard === best.hard && soft < best.soft))
        best = { p, boxes, hard, soft, far };
    }
    if (!best) continue;
    // A name that meets something, or sits off its first side across a track, widens its own
    // column: room there puts it back. A name across its own station's drop stays: no room helps.
    if (best.hard || (best.far && best.p !== sides[0])) bad.push([s.x, s.x]);
    if (best.p !== "up") s.p = best.p;
    names.push(...best.boxes);
  }

  // Chips go where nothing else is: `CHIP_ROOM` from a mark, `CHIP_CLEAR` from names, transfer
  // labels and the chips placed before.
  const taken: Box[] = [...xfers, ...names];
  for (const { r, pts } of routes) {
    if (r.cond && !r.condShared) {
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
      } else bad.push(routeSpan(pts));
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
      bad.push(routeSpan(pts));
      continue;
    }
    // No room for the pill: a dot, in the middle of the longest free run, else at the middle.
    const dot = freeSpot(pts, dotBox, [solid, CHIP_CLEAR], [taken, CHIP_CLEAR]) ?? along(pts, 0.5);
    r.at = dot;
    r.dot = 1;
    taken.push(dotBox(dot));
  }
  return bad;
}

/** Move the scene right and down by `dx` and `dy`. */
export function shift(sc: MetroScene, dx: number, dy: number) {
  if (!dx && !dy) return;
  for (const s of sc.st) {
    if (isMark(s)) {
      s.x += dx;
      s.y += dy;
    }
  }
  for (const r of sc.tr) {
    if (r.at) r.at = [r.at[0] + dx, r.at[1] + dy];
    if (r.cat) r.cat = [r.cat[0] + dx, r.cat[1] + dy];
    if (r.lat) r.lat = [r.lat[0] + dx, r.lat[1] + dy];
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

/**
 * Any placer's points made into a scene: tracks, names and chips, rails, size. Chips that find no
 * room fold to dots.
 */
export function finishMetro(view: MetroView, at: Placement): MetroScene {
  const tried = tryMetro(view, at);
  if (!tried.bad.length) return tried.scene;
  const p = prepare(view);
  const again = connect(p, p.base, at);
  reach(again);
  rails(again);
  dress(again, true);
  return sizeTo(again, at.bottom);
}

/**
 * One try with no chip folded: the scene, and the x spans (in `at`'s px) where a name or a chip
 * found no room. The placer widens them and tries again.
 */
export function tryMetro(
  view: MetroView,
  at: Placement,
): { scene: MetroScene; bad: [number, number][] } {
  const p = prepare(view);
  const scene = connect(p, p.base, at);
  reach(scene);
  rails(scene);
  const bad = dress(scene, false);
  return { scene: sizeTo(scene, at.bottom), bad };
}

/** "WJ · 4h": the owner and the promise. A track with neither has no pill. */
function who(t: ViewTrack): string | undefined {
  if (!t.owner && !t.promise) return undefined;
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
    ...(s.sub && s.was ? { was: s.was } : {}),
    ...(s.icon ? { icon: s.icon } : {}),
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
    ...(s.arrived !== undefined ? { arrived: s.arrived } : {}),
    ...(m ? { mark: m } : {}),
    ...extra,
  };
}
