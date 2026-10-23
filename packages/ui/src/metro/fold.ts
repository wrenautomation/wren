/**
 * Zoom as data. A level is a preset of folds; a group the viewer opens or folds by hand is an
 * override on top of it. Port of `zoom(sc, level, open)` and `mountZoom` in the artifact: the
 * scene for a level is pure, so a parent can keep `level` and `open` per viewer.
 *
 * Zoom hides stations, never lines. A run of stations folds into one capsule. The hub and the
 * exits never fold. Tracks reattach to the capsule edge. A late track inside rings it amber.
 */
import { labelBoxes, markBoxes, TAB_ROOM } from "./geometry.js";
import { EDGE, layoutMetro, shift } from "./layout.js";
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

/** Groups the viewer opened (true) or folded (false) beyond what the level shows. */
export type OpenMap = Readonly<Record<string, boolean>>;

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
      return {
        grp: k,
        t: nameOf(k, first),
        cap: [Math.min(...xs), Math.max(...xs)],
        y: first.y,
        l,
        top: topOf(m),
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
    caps.push({
      id: k,
      grp: k,
      cap: [lo, hi],
      x: (lo + hi) / 2,
      y: first.y,
      l: line.l,
      late: inside.some((r) => r.late),
      ...(mark ? { mark } : {}),
      now: m.reduce((a, s) => a + (s.now ?? 0), 0),
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

/** The top of a run's marks and names: where its fold tab sits above. */
function topOf(m: readonly MarkStation[]): number {
  return Math.min(...m.flatMap((s) => [...markBoxes(s), ...labelBoxes(s)].map((b) => b.y0)));
}

/** Zoom for a view: each level folds the view first, then lays it out, so a fold takes one place. */
export function viewZoom(view: MetroView, names: readonly string[] = LEVEL_NAMES): MetroZoom {
  const last = names.length - 1;
  const full = layoutMetro(view);
  return {
    names,
    preset: (level) => (level >= last ? { "*": true } : {}),
    scene: (level, open) => (level >= last ? full : viewScene(view, level, open)),
    total: view.stations.length,
  };
}

/**
 * The scene of a view at a level. Level 1 folds the named groups (`station.group`), level 0 one run
 * per line per column. A folded run is one station when the layout places it, so it takes one
 * step, not the room of its stations. It draws as a round capsule. The hub and exits never fold.
 */
export function viewScene(view: MetroView, level: number, open: OpenMap = {}): MetroScene {
  if (level >= 2) return layoutMetro(view);
  const columns = [...(view.columns ?? DEFAULT_COLUMNS)];
  for (const s of view.stations) if (!columns.includes(s.column)) columns.push(s.column);
  const key = (s: ViewStation): string | null =>
    s.kind === "hub" || s.kind === "exit"
      ? null
      : level === 1
        ? (s.group ?? null)
        : `${s.line}@${s.column}`;
  const runs = new Map<string, ViewStation[]>();
  for (const s of view.stations) {
    const k = key(s);
    if (k) runs.set(k, [...(runs.get(k) ?? []), s]);
  }
  const nameOf = (k: string, first: ViewStation) => {
    const line = view.lines.find((l) => l.id === first.line);
    const n = line?.label ?? first.line;
    return level === 1
      ? (view.groups?.find((g) => g.id === k)?.label ?? k)
      : line?.tier === "out"
        ? n
        : `${n} · ${first.column}`;
  };
  const into = new Map<string, string>();
  const shown = new Map<string, string[]>();
  const folds: ViewStation[] = [];
  const meta = new Map<string, { late: boolean; mark?: Mark }>();
  for (const [k, m] of runs) {
    if (m.length < 2) continue;
    if (open[k]) {
      shown.set(
        k,
        m.map((s) => s.id),
      );
      continue;
    }
    // The fold sits in the run's first column.
    const first = [...m].sort((a, b) => columns.indexOf(a.column) - columns.indexOf(b.column))[0];
    if (!first) continue;
    const ids = new Set(m.map((s) => s.id));
    const inside = view.tracks.filter((t) => ids.has(t.from) && ids.has(t.to));
    const line = view.lines.find((l) => l.id === first.line);
    const mark = capsuleMark(
      m.map((s) => ({ mark: s.mark ?? line?.mark })),
      inside,
    );
    meta.set(k, { late: inside.some((t) => t.late), ...(mark ? { mark } : {}) });
    folds.push({
      id: k,
      kind: "att",
      line: first.line,
      column: first.column,
      label: nameOf(k, first),
      now: m.reduce((a, s) => a + (s.now ?? 0), 0),
    });
    for (const s of m) into.set(s.id, k);
  }
  const at = (id: string) => into.get(id) ?? id;
  // Tracks reattach to the fold. One inside it goes; two that now join the same ends are one.
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
  const stations = view.stations.flatMap((s) => {
    const k = into.get(s.id);
    if (!k) return [s];
    const f = folds.find((x) => x.id === k);
    return f && runs.get(k)?.[0]?.id === s.id ? [f] : [];
  });
  const scene = layoutMetro({ ...view, stations, tracks });
  const opened = openedOf(scene, shown, (k) => nameOf(k, runs.get(k)?.[0] as ViewStation));
  // A fold tab above the top row needs room: the map moves down for it.
  const dy = EDGE - Math.min(EDGE, ...opened.map((o) => (o.top ?? o.y) - TAB_ROOM));
  if (dy > 0) {
    shift(scene, 0, dy);
    scene.h += dy;
    for (const o of opened) {
      o.y += dy;
      if (o.top !== undefined) o.top += dy;
    }
  }
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
      now: s.now ?? 0,
      n: s.n ?? s.id,
      ...(s.p ? { p: s.p } : {}),
    };
  });
  return { ...scene, st, ...(opened.length ? { opened } : {}) };
}

/** The groups opened by hand, from where the layout put their stations. */
function openedOf(
  scene: MetroScene,
  shown: ReadonlyMap<string, readonly string[]>,
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
        top: topOf(m),
      },
    ];
  });
}
