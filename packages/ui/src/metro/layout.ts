/**
 * `layoutMetro(view)`: places a `MetroView` as a `MetroScene`. Pure.
 *
 * Columns are zones, left to right. Each line is a row. The hub is one tall marker across the
 * rows. An exit sits under its source. A track between two lines becomes a 45 degree transfer.
 * It draws any list of stations and tracks it gets: an unknown column or line makes a new one, and
 * a track to nothing is dropped.
 */

import type { MarkStation, MetroScene, MetroTrack, Point, StationKind, Weight } from "./types.js";
import {
  DEFAULT_COLUMNS,
  type MetroView,
  type ViewKind,
  type ViewLine,
  type ViewStation,
  type ViewTrack,
} from "./view.js";

/** Space the layout leaves, in px. */
export const SPACE = {
  /** From a column's edge to its first station. */
  inset: 60,
  /** Between stations in one column. */
  step: 120,
  /** A row without exits; one with exits adds `exit`. */
  row: 96,
  exit: 70,
  /** Above the first row (room for names). */
  top: 56,
  /** Zone names at the foot. */
  foot: 34,
  /** The hub's column. */
  hub: 110,
};

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

export function layoutMetro(view: MetroView): MetroScene {
  const columns = [...(view.columns ?? DEFAULT_COLUMNS)];
  for (const s of view.stations) if (!columns.includes(s.column)) columns.push(s.column);

  // Lines: those given, then any a station names. Outreach rows first, then offers in order.
  const lines = [...view.lines];
  for (const s of view.stations) {
    if (s.kind !== "hub" && !lines.some((l) => l.id === s.line))
      lines.push({ id: s.line, tier: "front" });
  }
  const ordered = [
    ...lines.filter((l) => l.tier === "out"),
    ...lines.filter((l) => l.tier !== "out"),
  ];
  const line = new Map(ordered.map((l) => [l.id, l]));
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

  // Rows.
  const rowY = new Map<string, number>();
  let y = SPACE.top;
  for (const l of ordered) {
    rowY.set(l.id, y);
    y += SPACE.row + (exitsOn.has(l.id) ? SPACE.exit : 0);
  }
  const firstY = rowY.get(ordered[0]?.id ?? "") ?? SPACE.top;
  const lastY = rowY.get(ordered[ordered.length - 1]?.id ?? "") ?? SPACE.top;
  const bottom = Math.max(y - SPACE.row + 56, firstY + 56);

  // Columns: width = the most stations one line holds in it. The hub sits after the stations
  // that lead into it, in its own slot.
  const slot = new Map<string, number>();
  const most = columns.map((c) => {
    const per = new Map<string, number>();
    for (const s of view.stations) {
      if (s.column !== c || s.kind === "exit" || s.kind === "hub") continue;
      per.set(s.line, (per.get(s.line) ?? 0) + 1);
    }
    return Math.max(0, ...per.values());
  });
  const widths = columns.map((c, i) => {
    const n = most[i] ?? 0;
    if (hub?.column === c) return SPACE.inset + n * SPACE.step + (SPACE.hub - SPACE.inset);
    return n === 0 ? SPACE.inset : SPACE.inset + (n - 1) * SPACE.step + SPACE.inset;
  });
  const x0 = columns.map((_, i) => widths.slice(0, i).reduce((a, b) => a + b, 0));
  const zones = columns.map((c, i): [number, number, string] => [
    x0[i] ?? 0,
    (x0[i] ?? 0) + (widths[i] ?? 0),
    c,
  ]);
  const xOf = (s: ViewStation) => {
    const ci = columns.indexOf(s.column);
    if (s.kind === "hub") return (x0[ci] ?? 0) + SPACE.inset + (most[ci] ?? 0) * SPACE.step;
    const k = `${ci}:${s.line}`;
    const n = slot.get(k) ?? 0;
    slot.set(k, n + 1);
    return (x0[ci] ?? 0) + SPACE.inset + n * SPACE.step;
  };

  // Stations.
  const pos = new Map<string, Point>();
  const st: MarkStation[] = [];
  for (const s of view.stations) {
    if (s.kind === "exit" && exitOf.has(s.id)) continue;
    const isHub = s.kind === "hub";
    const x = xOf(s);
    const sy = isHub ? firstY : (rowY.get(s.line) ?? firstY);
    pos.set(s.id, [x, sy]);
    st.push(mark(s, x, sy, isHub ? { span: [firstY, lastY] } : {}, line));
  }
  // Exits: under the source, one step lower for each further exit of the same source.
  const taken = new Map<string, number>();
  for (const s of view.stations) {
    const src = exitOf.get(s.id);
    if (s.kind !== "exit" || !src) continue;
    const from = pos.get(src) ?? pos.get(homeOf(s).id);
    if (!from) continue;
    const n = taken.get(src) ?? 0;
    taken.set(src, n + 1);
    const p: Point = [from[0] + n * 64, from[1] + SPACE.exit];
    pos.set(s.id, p);
    st.push(mark(s, p[0], p[1], { p: "right" }, line));
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

  const w = (x0[columns.length - 1] ?? 0) + (widths[columns.length - 1] ?? 0) + 30;
  const colours: Record<string, number> = {};
  for (const l of ordered) if (l.tier !== "out") colours[l.id] = l.colour ?? 0;
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
  return {
    ...(view.title ? { title: view.title } : {}),
    w,
    h: bottom + SPACE.foot,
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
