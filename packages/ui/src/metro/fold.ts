/**
 * Zoom as data. A level is a preset of folds; a group the viewer opens or folds by hand is an
 * override on top of it. Port of `zoom(sc, level, open)` and `mountZoom` in the artifact: the
 * scene for a level is pure, so a parent can keep `level` and `open` per viewer.
 *
 * Zoom hides stations, never lines. A run of stations folds into one capsule. The hub and the
 * exits never fold. Tracks reattach to the capsule edge. A late track inside rings it amber.
 */
import { foldAt, foldIo, foldSteps } from "./geometry.js";
import { layoutMetro } from "./layout.js";
import {
  type CapsuleStation,
  isMark,
  type Mark,
  type MarkStation,
  type MetroScene,
  type MetroTrack,
  type OpenedSpec,
  type Point,
  type SceneStation,
} from "./types.js";
import { DEFAULT_COLUMNS, type MetroView, type ViewStation, type ViewTrack } from "./view.js";

/** Groups the viewer opened (true) or folded (false) beyond what the level shows. "*": all open. */
export type OpenMap = Readonly<Record<string, boolean>>;

/** Every group open: what a focus shows. */
export const ALL_OPEN: OpenMap = { "*": true };

/** The folds a hand-composed scene reads: one flag per group. */
export type Flags = Readonly<Record<string, boolean | undefined>>;

export interface MetroZoom {
  /** Level names, in order: "Parts", "Groups", "Stations". */
  names: readonly string[];
  /** The scene at a level, with groups opened or folded by hand. */
  scene(level: number, open: OpenMap): MetroScene;
  /** The groups open at a level before any hand change. */
  preset(level: number): Flags;
  /** Opening a group may jump to a level (clearing hand changes) or open more groups with it. */
  opens?: Readonly<Record<string, { level?: number; also?: readonly string[] }>>;
  /** Two flag sets that draw the same scene (a folded offer hides what is inside it). */
  same?: (preset: Flags, flags: Flags) => boolean;
  /** After a fold tab closes a group, the folded mark to pick. */
  foldId?: Readonly<Record<string, string>>;
  /** Marks at the deepest level, for the count line. */
  total: number;
}

const clamp = (zoom: Pick<MetroZoom, "names">, n: number) =>
  Math.max(0, Math.min(zoom.names.length - 1, n));

/** The groups open at a level, with the hand changes on top. */
export function flagsAt(zoom: Pick<MetroZoom, "preset">, level: number, open: OpenMap): Flags {
  return { ...zoom.preset(level), ...open };
}

/** Drop the changes that equal the level's own folds: what is left is "mixed". */
export function normalise(zoom: Pick<MetroZoom, "preset">, level: number, open: OpenMap): OpenMap {
  const base = zoom.preset(level);
  return Object.fromEntries(Object.entries(open).filter(([k, v]) => v !== !!base[k]));
}

/** Open or fold one group. Returns the new level and hand changes. */
export function toggleGroup(
  zoom: MetroZoom,
  state: { level: number; open: OpenMap },
  key: string,
  on: boolean,
): { level: number; open: OpenMap } {
  const jump = on ? zoom.opens?.[key] : undefined;
  if (jump?.level !== undefined) return { level: clamp(zoom, jump.level), open: {} };
  const next: Record<string, boolean> = { ...state.open, [key]: on };
  if (on) for (const k of jump?.also ?? []) next[k] = true;
  const open = normalise(zoom, state.level, next);
  // Open by hand until the groups equal another level: then it is that level.
  if (Object.keys(open).length) {
    const flags = flagsAt(zoom, state.level, open);
    for (let i = 0; i < zoom.names.length; i++) {
      if (i !== state.level && sameFlags(zoom, zoom.preset(i), flags))
        return { level: i, open: {} };
    }
  }
  return { level: state.level, open };
}

const sameFlags = (zoom: Pick<MetroZoom, "same">, a: Flags, b: Flags) =>
  zoom.same ? zoom.same(a, b) : Object.keys({ ...a, ...b }).every((k) => !!a[k] === !!b[k]);

/** Step the level by `d` (pinch in: +1, out: -1). Hand changes clear. */
export function stepLevel(zoom: MetroZoom, level: number, d: number): number {
  return clamp(zoom, level + d);
}

/** Zoom for a hand-composed scene: presets of fold flags and a `compose` that reads them. */
export function flagZoom(o: {
  names: readonly string[];
  presets: readonly Flags[];
  compose: (g: Flags) => MetroScene;
  total: number;
  opens?: MetroZoom["opens"];
  foldId?: MetroZoom["foldId"];
  same?: MetroZoom["same"];
}): MetroZoom {
  const preset = (level: number): Flags => o.presets[clamp(o, level)] ?? {};
  return {
    names: o.names,
    preset,
    scene: (level, open) => o.compose(flagsAt({ preset }, level, open)),
    total: o.total,
    ...(o.opens ? { opens: o.opens } : {}),
    ...(o.foldId ? { foldId: o.foldId } : {}),
    ...(o.same ? { same: o.same } : {}),
  };
}

/** The level names of `autoZoom`, outermost first. */
export const LEVEL_NAMES: readonly string[] = ["Parts", "Groups", "Stations"];

/** Zoom for a scene that names its lines and groups: levels fold it by rule (`foldScene`). */
export function autoZoom(scene: MetroScene, names: readonly string[] = LEVEL_NAMES): MetroZoom {
  const last = names.length - 1;
  return {
    names,
    preset: (level) => (level >= last ? { "*": true } : {}),
    scene: (level, open) => foldScene(scene, level, open),
    total: scene.st.length,
  };
}

/**
 * The mark of a folded run: the mark all its stations share, else "changed" when anything inside
 * (a station or a track between them) carries one. A fold must not hide a diff.
 */
export function capsuleMark(
  stations: readonly { mark?: Mark | undefined }[],
  tracks: readonly { mark?: Mark | undefined }[],
): Mark | undefined {
  const first = stations[0]?.mark;
  if (first && stations.every((s) => s.mark === first)) return first;
  return [...stations, ...tracks].some((x) => x.mark) ? "changed" : undefined;
}

const zoneOf = (scene: MetroScene, x: number) =>
  (scene.zones ?? []).findIndex(([a, b]) => x >= a && x < b);

/**
 * The scene at a level. Level 2 and up: every station. Level 1: the named groups (`station.g`).
 * Level 0: one run per line per column. A group in `open` stays open and is named in `opened`, so the map can offer to fold it.
 */
export function foldScene(scene: MetroScene, level: number, open: OpenMap = {}): MetroScene {
  if (level >= 2) return scene;
  const key = (s: MarkStation): string | null =>
    s.t === "hub" || s.t === "exit" || !s.ln
      ? null
      : level === 1
        ? (s.g ?? null)
        : `${s.ln}@${zoneOf(scene, s.x)}`;
  const groups = new Map<string, MarkStation[]>();
  const opened = new Map<string, MarkStation[]>();
  for (const s of scene.st) {
    if (!isMark(s)) continue;
    const k = key(s);
    if (!k) continue;
    const to = open[k] ? opened : groups;
    to.set(k, [...(to.get(k) ?? []), s]);
  }
  const nameOf = (k: string, first: MarkStation) => {
    const line = scene.lines?.[first.ln ?? ""] ?? { n: first.ln ?? k, l: first.ln ?? k };
    const zone = scene.zones?.[zoneOf(scene, first.x)]?.[2];
    return level === 1
      ? (scene.groups?.[k] ?? k)
      : line.l === "out" || !zone
        ? line.n
        : `${line.n} · ${zone.toLowerCase().replace(/^./, (c) => c.toUpperCase())}`;
  };
  // The groups opened by hand that would fold here: the map lists them, each one folds back.
  const shut = [...opened]
    .filter(([, m]) => m.length > 1 && m[0]?.ln)
    .map(([k, m]): OpenedSpec => {
      const first = m[0] as MarkStation;
      const xs = m.map((s) => s.x);
      const l = scene.lines?.[first.ln ?? ""]?.l ?? first.ln ?? k;
      // The leaf goes where the capsule's was: under the circle nearest its centre whose name is
      // not below it.
      const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
      const near = [...m].sort((a, b) => Math.abs(a.x - mid) - Math.abs(b.x - mid));
      const under = near.find((s) => s.p !== "down") ?? first;
      return {
        grp: k,
        t: nameOf(k, first),
        cap: [Math.min(...xs), Math.max(...xs)],
        y: first.y,
        l,
        at: foldAt(under),
      };
    });
  const into = new Map<string, string>();
  const caps: CapsuleStation[] = [];
  for (const [k, m] of groups) {
    const first = m[0];
    if (m.length < 2 || !first?.ln) continue;
    const line = scene.lines?.[first.ln] ?? { n: first.ln, l: first.ln };
    const xs = m.map((s) => s.x);
    const ids = new Set(m.map((s) => s.id));
    const inside = scene.tr.filter((r) => r.a && r.b && ids.has(r.a) && ids.has(r.b));
    const mark = capsuleMark(m, inside);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const name = nameOf(k, first);
    const run = [...m].sort((a, b) => a.x - b.x);
    const last = run[run.length - 1] as MarkStation;
    caps.push({
      id: k,
      grp: k,
      cap: [lo, hi],
      x: (lo + hi) / 2,
      y: first.y,
      l: line.l,
      late: inside.some((r) => r.late),
      ...(mark ? { mark } : {}),
      t: last.t,
      steps: m.length,
      ...ioOf(run),
      n: name,
    });
    for (const s of m) into.set(s.id, k);
  }
  const byId = new Map(scene.st.map((s) => [s.id, s]));
  const cap = new Map(caps.map((c) => [c.id, c]));
  /** The end of a track: the station, or the centre of the circle its run folds into. */
  const end = (id: string | undefined, o: number): Point | undefined => {
    if (!id) return undefined;
    const k = into.get(id);
    const s = byId.get(id);
    if (!k) return s ? [s.x ?? 0, s.y + o] : undefined;
    const c = cap.get(k);
    return c ? [(c.cap[0] + c.cap[1]) / 2, c.y] : undefined;
  };
  const tr = scene.tr.flatMap((r): MetroTrack[] => {
    const ka = r.a ? into.get(r.a) : undefined;
    const kb = r.b ? into.get(r.b) : undefined;
    if (ka && ka === kb) return [];
    if (!ka && !kb) return [r];
    const { pts: _pts, at: _at, dot: _dot, cat: _cat, ...rest } = r;
    const pa = end(r.a, r.oa ?? r.o ?? 0) ?? r.pts?.[0];
    const pc = end(r.b, r.ob ?? r.o ?? 0) ?? r.pts?.[r.pts.length - 1];
    return [{ ...rest, ...(pa ? { pa } : {}), ...(pc ? { pc } : {}) }];
  });
  // A rail's label shows once: on the first track left on it.
  const lead = new Set<string>();
  for (const [i, r] of tr.entries()) {
    if (!r.back || !r.cond) continue;
    const k = `${r.b && into.has(r.b) ? into.get(r.b) : r.b}|${r.cond}|${r.back}`;
    const { condShared: _shared, ...rest } = r;
    tr[i] = lead.has(k) ? { ...rest, condShared: true } : rest;
    lead.add(k);
  }
  const st: SceneStation[] = scene.st.filter((s) => !into.has(s.id)).concat(caps);
  return { ...scene, st, tr, ...(shut.length ? { opened: shut } : {}) };
}

/** People who reached a run's first and last station (else who sit there now), when both say. */
function ioOf(run: readonly { now?: number | undefined; arrived?: number | undefined }[]): {
  io?: [number, number];
} {
  const at = (s: (typeof run)[number] | undefined) => s?.arrived ?? s?.now;
  const a = at(run[0]);
  const b = at(run[run.length - 1]);
  return a !== undefined && b !== undefined ? { io: [a, b] } : {};
}

/**
 * Zoom for a view: each level folds the view first, then lays it out, so a fold takes one place.
 * Side-by-side stations stay folded at every level, the last one too; a wheel step clears what the
 * viewer opened, so it folds them again.
 */
export function viewZoom(view: MetroView, names: readonly string[] = LEVEL_NAMES): MetroZoom {
  const last = names.length - 1;
  return {
    names,
    preset: (level) => (level >= last ? { "*": true } : {}),
    scene: (level, open) => viewScene(view, level >= last ? 2 : level, open),
    total: view.stations.length,
  };
}

/** Its fold's chip and look, kept until the layout has placed it. */
interface FoldMeta {
  late: boolean;
  mark?: Mark;
  steps: number;
  io?: [number, number];
  each?: string;
  s?: string;
}

/** A view with runs folded: what the layout needs, and what makes each fold a capsule after it. */
interface Folded {
  view: MetroView;
  meta: Map<string, FoldMeta>;
  /** The open runs: their stations, and the station whose circle holds the fold leaf. */
  shown: Map<string, string[]>;
  leafOn: Map<string, string>;
  names: Map<string, string>;
}

/** One run to fold: its name, and for side-by-side stations what the fold adds up. */
interface Run {
  m: ViewStation[];
  name: string;
  each?: { s: string; io?: [number, number]; now?: number; arrived?: number };
}

/**
 * Fold each run of two or more into one station in place of its first. An open run stays, with a
 * fold leaf on its first station. Tracks reattach to the fold; one inside it goes; two that now join
 * the same ends are one.
 */
function foldRuns(view: MetroView, runs: ReadonlyMap<string, Run>, open: OpenMap): Folded {
  const columns = [...(view.columns ?? DEFAULT_COLUMNS)];
  for (const s of view.stations) if (!columns.includes(s.column)) columns.push(s.column);
  const byColumn = (m: readonly ViewStation[]) =>
    [...m].sort((a, b) => columns.indexOf(a.column) - columns.indexOf(b.column));
  const into = new Map<string, string>();
  const shown = new Map<string, string[]>();
  const leafOn = new Map<string, string>();
  const names = new Map<string, string>();
  const folds = new Map<string, ViewStation>();
  const meta = new Map<string, FoldMeta>();
  for (const [k, { m, name, each }] of runs) {
    if (m.length < 2) continue;
    names.set(k, name);
    const run = byColumn(m);
    const first = run[0];
    const last = run[run.length - 1];
    if (!first || !last) continue;
    // All open ("*"): the run shows as stations, with no leaf to fold it.
    if (open[k] === undefined && open["*"]) continue;
    if (open[k]) {
      shown.set(
        k,
        m.map((s) => s.id),
      );
      leafOn.set(first.id, k);
      continue;
    }
    // The fold sits in the run's first column and wears its last station's kind.
    const ids = new Set(m.map((s) => s.id));
    const inside = view.tracks.filter((t) => ids.has(t.from) && ids.has(t.to));
    const line = view.lines.find((l) => l.id === first.line);
    const mark = capsuleMark(
      m.map((s) => ({ mark: s.mark ?? line?.mark })),
      inside,
    );
    const fold = {
      steps: m.length,
      ...(each ? { each: "platforms", ...(each.io ? { io: each.io } : {}) } : ioOf(run)),
    };
    meta.set(k, {
      late: inside.some((t) => t.late),
      ...(mark ? { mark } : {}),
      ...fold,
      ...(each ? { s: each.s } : {}),
    });
    // The chip takes the room of its longer words, so the hover never runs into a neighbour.
    const chip = [foldSteps(fold), foldIo(fold)].sort((a, b) => b.length - a.length)[0];
    folds.set(k, {
      id: k,
      kind: last.kind,
      line: first.line,
      column: first.column,
      ...(first.group ? { group: first.group } : {}),
      ...(first.flow ? { flow: first.flow } : {}),
      label: name,
      ...(each
        ? {
            sub: each.s,
            bundle: true,
            ...(each.now !== undefined ? { now: each.now } : {}),
            ...(each.arrived !== undefined ? { arrived: each.arrived } : {}),
          }
        : {}),
      ...(chip ? { repeat: chip, repeatIcon: "expand" as const } : {}),
    });
    for (const s of m) into.set(s.id, k);
  }
  const at = (id: string) => into.get(id) ?? id;
  const seen = new Set<string>();
  const tracks = view.tracks.flatMap((t): ViewTrack[] => {
    const from = at(t.from);
    const to = at(t.to);
    if (from === to && from !== t.from) return [];
    if (from === t.from && to === t.to) return [t];
    const pair = `${from}>${to}`;
    if (seen.has(pair)) return [];
    seen.add(pair);
    return [{ ...t, id: t.id ?? `${t.from}-${t.to}`, from, to }];
  });
  // The fold takes the place of the run's first station, so the stations keep their order.
  const first = new Map([...runs].map(([k, r]) => [k, r.m[0]?.id]));
  const stations = view.stations.flatMap((s): ViewStation[] => {
    const k = into.get(s.id);
    if (!k) return [s];
    const f = folds.get(k);
    return f && first.get(k) === s.id ? [f] : [];
  });
  return { view: { ...view, stations, tracks }, meta, shown, leafOn, names };
}

/** A twin departs from the rest: stuck share (now over arrived) and how far, with how few people it says nothing. */
export const TWIN_OUTLIER = { margin: 0.25, people: 5 } as const;

/**
 * Stations side by side: one template on one line in one column, a station per platform. A twin
 * with a diff mark (or a track with one) stays out, so a fold never hides a diff; so does a twin
 * whose stuck share departs from the others' by more than the margin.
 */
export function twinRuns(view: MetroView): Map<string, Run> {
  const marked = new Set(view.tracks.filter((t) => t.mark).flatMap((t) => [t.from, t.to]));
  const sets = new Map<string, ViewStation[]>();
  for (const s of view.stations) {
    if (!s.template || s.kind === "hub" || s.kind === "exit") continue;
    const k = `tpl:${s.template}@${s.line}@${s.column}`;
    sets.set(k, [...(sets.get(k) ?? []), s]);
  }
  const share = (m: readonly ViewStation[]) => {
    const a = m.reduce((t, s) => t + (s.arrived ?? 0), 0);
    return a ? m.reduce((t, s) => t + (s.now ?? 0), 0) / a : undefined;
  };
  const runs = new Map<string, Run>();
  for (const [k, all] of sets) {
    const m = all.filter((s) => {
      if (s.mark || marked.has(s.id)) return false;
      const rest = share(all.filter((o) => o !== s));
      const own = share([s]);
      return (
        (s.arrived ?? 0) < TWIN_OUTLIER.people ||
        own === undefined ||
        rest === undefined ||
        Math.abs(own - rest) <= TWIN_OUTLIER.margin
      );
    });
    if (m.length < 2) continue;
    const words = m.map((s) => s.label?.split(" \u00b7 ") ?? []);
    const head = words[0]?.[0];
    const name =
      head && words.every((w) => w.length > 1 && w[0] === head) ? head : (m[0]?.template ?? k);
    const platforms = m.map((s, i) =>
      (words[i]?.length ?? 0) > 1 ? words[i]?.at(-1) : s.platform,
    );
    const sum = (f: (s: ViewStation) => number | undefined) =>
      m.some((s) => f(s) !== undefined) ? m.reduce((t, s) => t + (f(s) ?? 0), 0) : undefined;
    const now = sum((s) => s.now);
    const arrived = sum((s) => s.arrived);
    runs.set(k, {
      m,
      name,
      each: {
        s: platforms.filter(Boolean).join(", "),
        ...(now !== undefined && arrived !== undefined ? { io: [arrived, now] } : {}),
        ...(now !== undefined ? { now } : {}),
        ...(arrived !== undefined ? { arrived } : {}),
      },
    });
  }
  return runs;
}

/** A view with its side-by-side stations folded, each a stacked station: for a layout of its own. */
export const foldTwins = (view: MetroView): MetroView => foldRuns(view, twinRuns(view), {}).view;

/**
 * The scene of a view at a level. Every level first folds side-by-side stations (`twinRuns`). Level
 * 1 then folds the named groups (`station.group`), level 0 one run per line per column. A folded run
 * is one station when the layout places it, so it takes one step, not the room of its stations. It
 * draws as a round capsule; side by side, a stacked one. The hub and exits never fold.
 */
export function viewScene(view: MetroView, level: number, open: OpenMap = {}): MetroScene {
  const twins = foldRuns(view, twinRuns(view), open);
  const groups = level >= 2 ? undefined : foldRuns(twins.view, groupRuns(twins.view, level), open);
  const done = groups?.view ?? twins.view;
  const meta = new Map([...twins.meta, ...(groups?.meta ?? [])]);
  const shown = new Map([...twins.shown, ...(groups?.shown ?? [])]);
  const leafOn = new Map([...twins.leafOn, ...(groups?.leafOn ?? [])]);
  const names = new Map([...twins.names, ...(groups?.names ?? [])]);
  // The layout keeps the leaf's room under the circle, as a repeat chip's.
  const stations = done.stations.map((s): ViewStation => {
    const k = leafOn.get(s.id);
    return k && !s.repeat ? { ...s, repeat: names.get(k) ?? k, repeatIcon: "shrink" as const } : s;
  });
  const scene = layoutMetro({ ...done, stations });
  // The leaf draws on its own: the station drops the stand-in chip that kept its room.
  scene.st = scene.st.map((s) => {
    if (!isMark(s) || !leafOn.has(s.id) || s.repGlyph !== "shrink") return s;
    const { rep: _rep, repGlyph: _glyph, ...rest } = s;
    return rest;
  });
  const opened = openedOf(scene, shown, leafOn, (k) => names.get(k) ?? k);
  const lineKey = (ln: string | undefined) => scene.lines?.[ln ?? ""]?.l ?? ln ?? "";
  const st = scene.st.map((s): SceneStation => {
    const m = meta.get(s.id);
    if (!m || !isMark(s)) return s;
    return {
      id: s.id,
      grp: s.id,
      cap: [s.x, s.x],
      x: s.x,
      y: s.y,
      l: lineKey(s.ln),
      late: m.late,
      ...(m.mark ? { mark: m.mark } : {}),
      t: s.t,
      steps: m.steps,
      ...(m.io ? { io: m.io } : {}),
      ...(m.each ? { each: m.each } : {}),
      ...(m.s ? { s: m.s } : {}),
      n: s.n ?? s.id,
      ...(s.p ? { p: s.p } : {}),
    };
  });
  return { ...scene, st, ...(opened.length ? { opened } : {}) };
}

/** Level 1: the named groups (`station.group`). Level 0: one run per line per column. */
function groupRuns(view: MetroView, level: number): Map<string, Run> {
  const key = (s: ViewStation): string | null =>
    s.kind === "hub" || s.kind === "exit"
      ? null
      : level === 1
        ? (s.group ?? null)
        : `${s.line}@${s.column}`;
  const nameOf = (k: string, first: ViewStation) => {
    const line = view.lines.find((l) => l.id === first.line);
    const n = line?.label ?? first.line;
    return level === 1
      ? (view.groups?.find((g) => g.id === k)?.label ?? k)
      : line?.tier === "out"
        ? n
        : `${n} · ${first.column}`;
  };
  const runs = new Map<string, Run>();
  for (const s of view.stations) {
    const k = key(s);
    if (!k) continue;
    const r = runs.get(k);
    if (r) r.m.push(s);
    else runs.set(k, { m: [s], name: nameOf(k, s) });
  }
  return runs;
}

/** The groups opened by hand, from where the layout put their stations. */
function openedOf(
  scene: MetroScene,
  shown: ReadonlyMap<string, readonly string[]>,
  leafOn: ReadonlyMap<string, string>,
  name: (k: string) => string,
): OpenedSpec[] {
  const byId = new Map(scene.st.map((s) => [s.id, s]));
  return [...shown].flatMap(([k, ids]): OpenedSpec[] => {
    const m = ids.map((id) => byId.get(id)).filter((s): s is MarkStation => !!s && isMark(s));
    const first = m[0];
    if (!first) return [];
    // The outline runs along the first station's row.
    const xs = m.filter((s) => s.y === first.y).map((s) => s.x);
    return [
      {
        grp: k,
        t: name(k),
        cap: [Math.min(...xs), Math.max(...xs)],
        y: first.y,
        l: scene.lines?.[first.ln ?? ""]?.l ?? first.ln ?? k,
        at: foldAt(m.find((s) => leafOn.get(s.id) === k) ?? first),
      },
    ];
  });
}
