/**
 * `sceneToView(scene)`: a hand-placed scene back to plain data, so the layout lab can lay it out
 * and score it against the hand. Station ids stay. A track drawn as points joins the stations that
 * sit on it, in order, and runs on through a point that is not a station (a fork or a merge).
 * Free chips and interrupt frames have no place in a view; they drop.
 */
import {
  DEFAULT_COLOURS,
  isMark,
  type MarkStation,
  type MetroScene,
  type Point,
} from "../types.js";
import {
  DEFAULT_COLUMNS,
  type LineTier,
  type MetroView,
  type ViewKind,
  type ViewLine,
  type ViewStation,
  type ViewTrack,
} from "../view.js";

/** A station is on a path when it is this close to it, in px. */
const NEAR = 4;

interface Leg {
  from: string;
  to: string;
  key?: string;
  tier?: LineTier;
  exit?: boolean;
  plan?: boolean;
  who?: string;
  label?: string;
}

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** How far along `pts` the point `q` sits, or -1 when it is off the path. */
function along(pts: readonly Point[], q: Point): number {
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    const len = dist(a, b);
    const t = len
      ? Math.max(
          0,
          Math.min(1, ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1])) / len ** 2),
        )
      : 0;
    const p: Point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    if (dist(p, q) <= NEAR) return run + t * len;
    run += len;
  }
  return -1;
}

const TIER: Record<string, LineTier> = { out: "out", front: "front", core: "core" };

export function sceneToView(scene: MetroScene, title = scene.title): MetroView {
  const marks = scene.st.filter(isMark);
  const byId = new Map(marks.map((s) => [s.id, s]));
  const at = (s: MarkStation): Point => [s.x, s.y];
  // A point that is not a station is a junction; it gets an id from its place.
  const nodeAt = (q: Point) =>
    marks.find((s) => dist(at(s), q) <= NEAR)?.id ?? `@${Math.round(q[0])},${Math.round(q[1])}`;

  const legs: Leg[] = [];
  const paths: { pts: Point[]; stops: { id: string; d: number }[] }[] = [];
  for (const r of scene.tr) {
    const base = {
      ...(r.l ? { key: r.l } : {}),
      ...(r.w ? { tier: TIER[r.w] } : {}),
      ...(r.k === "exit" ? { exit: true } : {}),
      ...(r.k === "plan" ? { plan: true } : {}),
    };
    const a = r.a ? byId.get(r.a) : undefined;
    const b = r.b ? byId.get(r.b) : undefined;
    const p0 = r.pa ?? (a ? at(a) : r.pts?.[0]);
    const p1 = r.pc ?? (b ? at(b) : r.pts?.[r.pts.length - 1]);
    const pts: Point[] | undefined = r.pts ?? (p0 && p1 ? [p0, p1] : undefined);
    if (!pts || pts.length < 2) continue;
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1] as Point, pts[i] as Point);
    // The stops along the path: its ends, and every station on it, in order.
    const stops = [
      { id: a?.id ?? nodeAt(pts[0] as Point), d: 0 },
      ...marks
        .map((s) => ({ id: s.id, d: along(pts, at(s)) }))
        .filter((x) => x.d > NEAR && x.d < total - NEAR),
      { id: b?.id ?? nodeAt(pts[pts.length - 1] as Point), d: total },
    ]
      .sort((x, y) => x.d - y.d)
      .filter((x, i, all) => i === 0 || x.id !== all[i - 1]?.id);
    paths.push({ pts, stops });
    // A label or a person pill belongs to the leg it is drawn over; with no place, the first leg.
    const legAt = (q?: Point) => {
      const d = q ? along(pts, q) : -1;
      if (d < 0) return 1;
      const i = stops.findIndex((x) => x.d > d);
      return i < 1 ? stops.length - 1 : i;
    };
    const label = r.cond ?? r.lab;
    const who = r.who && r.who !== "auto" ? r.who : undefined;
    const li = legAt(r.cat);
    const wi = legAt(r.at);
    for (let i = 1; i < stops.length; i++)
      legs.push({
        from: stops[i - 1]?.id as string,
        to: stops[i]?.id as string,
        ...base,
        ...(label && i === li ? { label } : {}),
        ...(who && i === wi ? { who } : {}),
      });
  }
  // A track that starts part way along another (an exit off a run) starts at the stop before.
  for (const l of legs) {
    if (!l.from.startsWith("@") || legs.some((m) => m.to === l.from)) continue;
    const [x, y] = l.from.slice(1).split(",").map(Number) as [number, number];
    for (const { pts, stops } of paths) {
      const d = along(pts, [x, y]);
      const before =
        d < 0 ? undefined : [...stops].reverse().find((s) => s.d <= d && !s.id.startsWith("@"));
      if (before) {
        l.from = before.id;
        break;
      }
    }
    // Off every track (an exit from an interrupt frame): the nearest station to its left.
    if (l.from.startsWith("@")) {
      const near = marks
        .filter((s) => s.t !== "exit" && s.x <= x)
        .sort((p, q) => dist(at(p), [x, y]) - dist(at(q), [x, y]))[0];
      if (near) l.from = near.id;
    }
  }

  // Run on through junctions: each leg into one joins each leg out of it.
  const isJunction = (id: string) => id.startsWith("@");
  for (let guard = 0; guard < 200; guard++) {
    const id = legs.map((l) => l.to).find(isJunction) ?? legs.map((l) => l.from).find(isJunction);
    if (!id) break;
    const ins = legs.filter((l) => l.to === id);
    const outs = legs.filter((l) => l.from === id);
    const rest = legs.filter((l) => l.to !== id && l.from !== id);
    for (const i of ins)
      for (const o of outs)
        rest.push({
          ...i,
          ...o,
          from: i.from,
          to: o.to,
          // The name rides on whichever part carried it.
          ...((o.label ?? i.label) ? { label: o.label ?? i.label } : {}),
          ...((o.who ?? i.who) ? { who: o.who ?? i.who } : {}),
          exit: !!(i.exit || o.exit),
        });
    legs.splice(0, legs.length, ...rest);
  }
  // Two arms between one pair (an A/B test) become one track with both names: a view has no
  // parallel arms yet.
  const one = new Map<string, Leg>();
  for (const l of legs) {
    if (l.from === l.to || !byId.has(l.from) || !byId.has(l.to)) continue;
    const k = `${l.from}>${l.to}`;
    const had = one.get(k);
    if (!had) one.set(k, { ...l });
    else if (l.label && had.label !== l.label)
      had.label = had.label ? `${had.label} / ${l.label}` : l.label;
  }
  const real = [...one.values()];

  // Lines: a station's own, else that of a leg into it, else out of it. Outreach runs one line
  // from each start.
  const keyOf = new Map<string, Leg>();
  for (const s of marks) {
    const leg =
      real.find((l) => l.to === s.id && !l.exit) ?? real.find((l) => l.from === s.id && !l.exit);
    if (leg) keyOf.set(s.id, leg);
  }
  const lineOf = new Map<string, string>();
  const outLine = (id: string, depth = 0): string => {
    const pred = real.find((l) => l.to === id && !l.exit && l.key === "out");
    const p = pred ? byId.get(pred.from) : undefined;
    return p && p.t !== "hub" && depth < 20 ? outLine(p.id, depth + 1) : `out-${id}`;
  };
  for (const s of marks) {
    const leg = keyOf.get(s.id);
    if (s.t === "hub") continue;
    const key = s.ln ?? leg?.key ?? "out";
    lineOf.set(s.id, key === "out" ? outLine(s.id) : key);
  }
  // An exit and the hub sit on the line of what leads in.
  for (const s of marks) {
    const into = real.find((l) => l.to === s.id);
    if (s.t === "hub" || (s.t === "exit" && into)) {
      lineOf.set(s.id, (into && lineOf.get(into.from)) ?? lineOf.get(s.id) ?? "out-hub");
    }
  }
  const lines = new Map<string, ViewLine>();
  for (const s of marks) {
    const id = lineOf.get(s.id) as string;
    if (lines.has(id)) continue;
    const leg = real.find((l) => lineOf.get(l.to) === id && l.tier && !l.exit);
    const out = id.startsWith("out-");
    const colour = scene.colours?.[id] ?? DEFAULT_COLOURS[id];
    lines.set(id, {
      id,
      tier: out ? "out" : (leg?.tier ?? "front"),
      ...(out ? {} : { label: scene.lines?.[id]?.n ?? id }),
      ...(colour !== undefined && !out ? { colour } : {}),
    });
  }

  const zones = scene.zones ?? [];
  const columns = zones.length ? zones.map((z) => z[2]) : DEFAULT_COLUMNS;
  const columnOf = (x: number) => {
    const i = zones.findIndex(([a, b]) => x >= a && x < b);
    if (i >= 0) return columns[i] as string;
    return (x < (zones[0]?.[0] ?? 0) ? columns[0] : columns[columns.length - 1]) as string;
  };
  const kindOf = (s: MarkStation): ViewKind => {
    if (s.t !== "par") return s.t as ViewKind;
    const ins = real.filter((l) => l.to === s.id).length;
    const outs = real.filter((l) => l.from === s.id).length;
    return outs > ins ? "split" : "join";
  };

  const stations: ViewStation[] = marks.map((s) => ({
    id: s.id,
    kind: kindOf(s),
    line: lineOf.get(s.id) as string,
    column: columnOf(s.x),
    ...(s.n ? { label: s.n } : {}),
    ...(s.s ? { sub: s.s } : {}),
    ...(s.bad ? { bad: true } : {}),
    ...(s.rule ? { rule: s.rule } : {}),
    ...(s.rep ? { repeat: s.rep } : {}),
    ...(s.repGlyph !== undefined ? { repeatIcon: s.repGlyph } : {}),
    ...(s.plans ? { plans: s.plans } : {}),
    ...(s.bundle ? { bundle: true } : {}),
    ...(s.g ? { group: s.g } : {}),
    ...(s.now !== undefined ? { now: s.now } : {}),
  }));
  const tracks: ViewTrack[] = real.map((l) => {
    const [owner, promise] = (l.who ?? "").split(" · ");
    return {
      from: l.from,
      to: l.to,
      by: l.who ? "person" : "system",
      ...(l.who ? { owner, promise } : {}),
      ...(l.label ? { label: l.label } : {}),
      ...(l.plan ? { plan: true } : {}),
    };
  });
  return { ...(title ? { title } : {}), lines: [...lines.values()], stations, tracks, columns };
}
