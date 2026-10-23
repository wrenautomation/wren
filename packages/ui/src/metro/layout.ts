/**
 * `layoutMetro(view)`: places a `MetroView` as a `MetroScene`. Pure and sync.
 *
 * Columns are zones, left to right. Each line is a row. The hub is a circle on the middle row it
 * joins, and the other joined rows bend into it at 45 degrees; the stations that lead into it sit
 * left of it and the offer lines start right of it, so no track passes under it. The offer lines
 * sit in the middle of the outreach rows, and outreach rows sit close, so the bends stay short. An
 * exit sits under its source. A track between two lines becomes a 45
 * degree transfer. Rows are ordered to cut crossings.
 *
 * Outreach sits left of the hub and offers right of it, so an outreach line and an offer line share
 * a row: one of each runs straight through the hub. In a column a station takes the slot after every
 * station that leads into it there, so a transfer always runs forward. A column with no station
 * keeps one step, so the zones stay steady from map to map.
 *
 * The layout owns every place. A name goes above or below its station, whichever is free. A task
 * chip sits in the middle of the free part of its track, or folds to a count dot. A name that does
 * not fit widens its own column; a chip, the columns under its track. Then the rows grow. A track
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
  crossingsOf,
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

/** Space the layout starts with, in px. It widens these when a name or a chip needs room. */
export const SPACE = {
  /** Between stations in a column, and the width of a column with no station. */
  step: 120,
  /** A row without exits; one with exits adds `exit`. */
  row: 96,
  /** Between two outreach rows: their marks are small and their names one line. */
  out: 56,
  exit: 70,
  /** Above the first row (room for the hub's name). */
  top: 68,
  /** Zone names at the foot. */
  foot: 34,
};

/**
 * How much wider a retry makes a column's step and the row, and how many times it may. The layout
 * widens the columns under what clashed first (a chip needs width); the rows grow when no such
 * column may widen more. The try after the last folds chips to dots.
 */
const GROW = { step: 12, row: 10, maxStep: 5, maxRow: 2 };
/** The flat run between a bend out of the hub and the next station. */
const BEND_RUN = 24;
/** How far apart the rows meet the hub, in px. */
const MEET = 9;
/** The biggest a hub grows for the rows that meet it. */
const HUB_MAX = 30;
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
  /** The source of each exit, and the line an exit hangs under. */
  exitOf: Map<string, string>;
  exitsOn: Set<string>;
  /** Lines that have a track into or out of the hub. */
  joined: Set<string>;
  /** The lines in the order the view gives them, by class. */
  base: ViewLine[];
  /** Each line's class: the first half of the joined outreach, the joined offers, the second half, then the rest. */
  rank: Map<string, number>;
  /** The side of the hub a joined line sits on, when all its stations do: it shares a row. */
  side: Map<string, "left" | "right">;
  hubCol: number;
  /** Each station's slot in its column (in the hub's column, on its side of the hub). */
  slot: Map<string, number>;
  /** The slots each column takes left of the hub (all of them, away from the hub) and right of it. */
  left: number[];
  right: number[];
}

const rankOf = (p: Pick<Prep, "rank">, l: ViewLine) => p.rank.get(l.id) ?? 5;

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
  // The joined offers go in the middle of the joined outreach, so the core leaves the hub halfway.
  const rank = new Map<string, number>();
  const outIn = lines.filter((l) => joined.has(l.id) && l.tier === "out");
  const above = Math.ceil(outIn.length / 2);
  for (const l of lines) {
    const i = outIn.indexOf(l);
    rank.set(
      l.id,
      joined.has(l.id) ? (l.tier === "out" ? (i < above ? 0 : 2) : 1) : l.tier === "out" ? 3 : 4,
    );
  }
  const p = { rank };
  const base = [...lines].sort((a, b) => rankOf(p, a) - rankOf(p, b));
  const line = new Map(lines.map((l) => [l.id, l]));

  // Sides. Outreach ends at the hub and offers leave it, so a joined line whose stations all sit on
  // its own side of the hub shares a row with one from the other side.
  const hubCol = hub ? columns.indexOf(hub.column) : -1;
  const colOf = (s: ViewStation) => columns.indexOf(s.column);
  const side = new Map<string, "left" | "right">();
  for (const l of lines) {
    if (!joined.has(l.id)) continue;
    const on = view.stations.filter((s) => s.kind !== "hub" && s.line === l.id);
    if (l.tier === "out" && on.every((s) => colOf(s) <= hubCol)) side.set(l.id, "left");
    if (l.tier !== "out" && on.every((s) => colOf(s) >= hubCol)) side.set(l.id, "right");
  }

  // Slots. In a column, a station sits after the one before it on its line and after the source of
  // a track into it. A track back (a loop) does not count: the view's order wins.
  const rightOf = (s: ViewStation) => colOf(s) === hubCol && line.get(s.line)?.tier !== "out";
  const placed = view.stations.filter(
    (s) => s.kind !== "hub" && !(s.kind === "exit" && exitOf.has(s.id)),
  );
  const group = (s: ViewStation) => `${s.column}|${rightOf(s) ? "+" : ""}`;
  const next = new Map<string, string[]>(placed.map((s) => [s.id, []]));
  const edge = (a: ViewStation, b: ViewStation) => {
    if (a.id !== b.id && group(a) === group(b)) next.get(a.id)?.push(b.id);
  };
  const lastOn = new Map<string, ViewStation>();
  for (const s of placed) {
    const k = `${group(s)}|${s.line}`;
    const prev = lastOn.get(k);
    if (prev) edge(prev, s);
    lastOn.set(k, s);
  }
  for (const t of view.tracks) {
    const [a, b] = [byId.get(t.from), byId.get(t.to)];
    if (a && b && next.has(a.id) && next.has(b.id)) edge(a, b);
  }
  const seen = new Map<string, "open" | "done">();
  const post: string[] = [];
  const kept = new Map<string, string[]>();
  const visit = (id: string) => {
    seen.set(id, "open");
    const own: string[] = [];
    for (const n of next.get(id) ?? []) {
      if (seen.get(n) === "open") continue;
      own.push(n);
      if (!seen.has(n)) visit(n);
    }
    kept.set(id, own);
    seen.set(id, "done");
    post.push(id);
  };
  for (const s of placed) if (!seen.has(s.id)) visit(s.id);
  const slot = new Map<string, number>(placed.map((s) => [s.id, 0]));
  for (const id of post.reverse())
    for (const n of kept.get(id) ?? [])
      slot.set(n, Math.max(slot.get(n) ?? 0, (slot.get(id) ?? 0) + 1));
  const left = columns.map(() => 0);
  const right = columns.map(() => 0);
  for (const s of placed) {
    const ends = rightOf(s) ? right : left;
    const ci = colOf(s);
    ends[ci] = Math.max(ends[ci] ?? 0, (slot.get(s.id) ?? 0) + 1);
  }

  return {
    view,
    columns,
    line,
    byId,
    hub,
    exitOf,
    exitsOn,
    joined,
    base,
    rank,
    side,
    hubCol,
    slot,
    left,
    right,
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
  const flat = p.columns.map(() => 0);
  const score = (o: readonly ViewLine[]) => crossingsOf(build(p, o, flat, 0).scene);
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

/**
 * `kx` is how many times each column's step has grown, `ky` the rows'.
 */
function build(
  p: Prep,
  order: readonly ViewLine[],
  kx: readonly number[],
  ky: number,
): { scene: MetroScene; bottom: number } {
  const { view, columns, line, byId, exitOf, hubCol } = p;
  const steps = columns.map((_, ci) => SPACE.step + (kx[ci] ?? 0) * GROW.step);
  const rowH = SPACE.row + ky * GROW.row;
  const outH = SPACE.out + ky * GROW.row;

  // Rows. The hub's two sides pair up: outreach from the top row, offers in the middle of the
  // outreach. The other lines follow, one row each.
  const rows: ViewLine[][] = [];
  const lefts = order.filter((l) => p.side.get(l.id) === "left");
  const rights = order.filter((l) => p.side.get(l.id) === "right");
  const n = Math.max(lefts.length, rights.length);
  for (let i = 0; i < n; i++) rows.push([]);
  lefts.forEach((l, i) => {
    rows[i]?.push(l);
  });
  const from = Math.floor((n - rights.length) / 2);
  rights.forEach((l, i) => {
    rows[from + i]?.push(l);
  });
  for (const l of order) if (!p.side.has(l.id)) rows.push([l]);
  // Two outreach rows in a row sit close; any other pair takes a full row.
  const outOnly = (r?: ViewLine[]) => !!r?.length && r.every((l) => l.tier === "out");
  const rowY = new Map<string, number>();
  let y = SPACE.top;
  rows.forEach((r, i) => {
    for (const l of r) rowY.set(l.id, y);
    const exits = r.some((l) => p.exitsOn.has(l.id));
    const close = outOnly(r) && outOnly(rows[i + 1]) && !exits;
    y += (close ? outH : rowH) + (exits ? SPACE.exit : 0);
  });
  const firstY = SPACE.top;
  const bottom = Math.max(y - rowH + 56, firstY + 56);
  // The hub is a circle on the middle row it joins; with no track it sits on the first row. The
  // other joined rows bend into it at 45 degrees.
  const joinedY = [
    ...new Set(order.filter((l) => p.joined.has(l.id)).map((l) => rowY.get(l.id) ?? firstY)),
  ].sort((a, b) => a - b);
  const hubY = joinedY[Math.floor((joinedY.length - 1) / 2)] ?? firstY;
  // Each joined row meets the hub at its own height, the nearest rows nearest its middle, so the
  // diagonals out of one side run apart. The hub grows to hold them, up to HUB_MAX; past that the
  // rows meet closer together.
  const rank = new Map<string, number>();
  let most = 0;
  for (const out of [true, false]) {
    const side = order.filter((l) => p.joined.has(l.id) && (l.tier === "out") === out);
    const yOf = (l: ViewLine) => rowY.get(l.id) ?? firstY;
    for (const dir of [-1, 1]) {
      const ys = [...new Set(side.map(yOf).filter((y) => Math.sign(y - hubY) === dir))].sort(
        (a, b) => dir * (a - b),
      );
      ys.forEach((y, k) => {
        for (const l of side) if (yOf(l) === y) rank.set(l.id, dir * (k + 1));
      });
      most = Math.max(most, ys.length);
    }
  }
  const hubR = Math.min(HUB_MAX, Math.max(RADIUS.hub, most * MEET + 8));
  const gap = most ? Math.min(MEET, (hubR - 8) / most) : MEET;
  const meet = new Map([...rank].map(([id, k]) => [id, Math.round(k * gap)]));
  // A bend is as wide as it drops, with a flat run at its far end: the hub's column widens for it.
  const drop = Math.max(0, ...joinedY.map((y) => Math.abs(y - hubY)));
  const pad = Math.max(0, Math.ceil(drop + BEND_RUN - (steps[hubCol] ?? SPACE.step)));

  // Columns. A column is as many steps wide as it has slots, and never less than one. In the hub's
  // column the outreach comes first, then the hub, then the offers.
  const slots = columns.map((_, ci) =>
    ci === hubCol ? (p.left[ci] ?? 0) + 1 + (p.right[ci] ?? 0) : (p.left[ci] ?? 0),
  );
  const widths = columns.map(
    (_, ci) =>
      Math.max(1, slots[ci] ?? 0) * (steps[ci] ?? SPACE.step) + (ci === hubCol ? 2 * pad : 0),
  );
  const x0 = columns.map((_, i) => widths.slice(0, i).reduce((a, b) => a + b, 0));
  const zones = columns.map((c, i): Zone => [x0[i] ?? 0, (x0[i] ?? 0) + (widths[i] ?? 0), c]);
  const xOf = (s: ViewStation) => {
    const ci = columns.indexOf(s.column);
    const step = steps[ci] ?? SPACE.step;
    const at = (n: number) => (x0[ci] ?? 0) + step / 2 + n * step;
    const before = p.left[ci] ?? 0;
    if (s.kind === "hub") return at(before) + pad;
    const right = ci === hubCol && line.get(s.line)?.tier !== "out";
    const n = p.slot.get(s.id) ?? 0;
    return right ? at(before + 1 + n) + 2 * pad : at(n);
  };

  // Stations.
  const pos = new Map<string, Point>();
  const st: MarkStation[] = [];
  for (const s of view.stations) {
    if (s.kind === "exit" && exitOf.has(s.id)) continue;
    const isHub = s.kind === "hub";
    const x = xOf(s);
    const sy = isHub ? hubY : (rowY.get(s.line) ?? firstY);
    pos.set(s.id, [x, sy]);
    st.push(mark(s, x, sy, isHub && hubR > RADIUS.hub ? { r: hubR } : {}, line));
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
      // A line starts at the hub and bends to its own row.
      const l = lb ?? la;
      tr.push({
        ...common,
        a: a.id,
        b: b.id,
        l: l ? keyOf(l) : "out",
        w: l ? WEIGHT_OF[l.tier] : "front",
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
          n: line.get(s.line)?.label ?? line.get(s.line)?.offer ?? s.line,
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
 * How far under its row the first rail runs, and the step to the next one. A rail that shows a
 * branch label runs deep enough for the label to keep `CHIP_ROOM` from every mark on the row, so
 * the label fits under any station and no column widens for it.
 */
const RAIL = { first: 30, step: 14 };

/**
 * A track back to an earlier station on its own row would draw under the line itself, and its
 * chip would sit on the stations between. It runs on a rail under the row instead. Tracks back to
 * one station with one branch label share a rail and show the label once.
 */
function rails(sc: MetroScene) {
  const byId = new Map(sc.st.filter(isMark).map((s) => [s.id, s]));
  const rows = new Map<number, Map<string, MetroTrack[]>>();
  for (const r of sc.tr) {
    if (r.k || r.pts || !r.a || !r.b) continue;
    const [a, b] = [byId.get(r.a), byId.get(r.b)];
    if (!a || !b || a.y !== b.y || b.x >= a.x) continue;
    const row = rows.get(a.y) ?? new Map<string, MetroTrack[]>();
    const key = `${r.b}|${r.cond ?? ""}`;
    row.set(key, [...(row.get(key) ?? []), r]);
    rows.set(a.y, row);
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
        r.back = depth;
        if (j && r.cond) r.condShared = true;
      });
    });
  }
}

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
  const xfers: Box[] = [];
  for (const { r, pts } of routes) {
    if (r.k !== "xfer") continue;
    const [a, c] = [pts[0] as Point, pts[pts.length - 1] as Point];
    xfers.push(xferBox(xferGeometry(a, c, r.f).m, r.lab ?? ""));
  }

  const bad: [number, number][] = [];
  const routeSpan = (pts: readonly Point[]): [number, number] => [
    Math.min(...pts.map((q) => q[0])),
    Math.max(...pts.map((q) => q[0])),
  ];
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
    let best: { p: Side; boxes: Box[]; hard: number; soft: number } | undefined;
    for (const p of sides) {
      const boxes = labelBoxes({ ...s, p });
      // A hard clash: a name on another name, a mark, a transfer's label, or along a track, which
      // hides the line. A soft one: across a track.
      let hard = 0;
      let soft = 0;
      for (const b of boxes) {
        for (const [id, mine] of own)
          for (const o of mine) if (overlaps(b, o, id === s.id ? 0 : CLEAR)) hard++;
        for (const o of [...xfers, ...names]) if (overlaps(b, o, CLEAR)) hard++;
        for (const { pts } of routes)
          if (runsAlong(pts, b)) hard++;
          else if (routeHits(pts, b)) soft++;
      }
      if (!best || hard < best.hard || (hard === best.hard && soft < best.soft))
        best = { p, boxes, hard, soft };
    }
    if (!best) continue;
    // A name that meets something, or sits off its first side across a track, widens its own
    // column: room there puts it back.
    if (best.hard || (best.soft && best.p !== sides[0])) bad.push([s.x, s.x]);
    if (best.p !== "up") s.p = best.p;
    names.push(...best.boxes);
  }

  // Chips go where nothing else is: `CHIP_ROOM` from a mark, `CHIP_CLEAR` from names, transfer
  // labels and the chips placed before.
  const solid: Box[] = [...own.values()].flat();
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
  const kx = p.columns.map(() => 0);
  let ky = 0;
  let fold = false;
  for (;;) {
    const { scene, bottom } = build(p, order, kx, ky);
    rails(scene);
    const bad = dress(scene, fold);
    const zones = [...(scene.zones ?? [])];
    const out = sizeTo(scene, bottom);
    if (!bad.length || fold) return out;
    // Widen the columns under what did not fit; when none may, the rows; then fold.
    const wide = zones.flatMap(([z0, z1], i) =>
      (kx[i] ?? 0) < GROW.maxStep && bad.some(([a, b]) => a < z1 && b > z0) ? [i] : [],
    );
    if (wide.length) for (const i of wide) kx[i] = (kx[i] ?? 0) + 1;
    else if (ky < GROW.maxRow) ky++;
    else fold = true;
  }
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
