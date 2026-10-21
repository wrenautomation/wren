/**
 * Zoom as data. A level is a preset of folds; a group the viewer opens or folds by hand is an
 * override on top of it. Port of `zoom(sc, level, open)` and `mountZoom` in the artifact: the
 * scene for a level is pure, so a parent can keep `level` and `open` per viewer.
 *
 * Zoom hides stations, never lines. A run of stations folds into one capsule. The hub and the
 * exits never fold. Tracks reattach to the capsule edge. A late track inside rings it amber.
 */
import {
  type CapsuleStation,
  isMark,
  type MarkStation,
  type MetroScene,
  type MetroTrack,
  type Point,
  type SceneStation,
} from "./types.js";

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

/** Zoom for a scene that names its lines and groups: levels fold it by rule (`foldScene`). */
export function autoZoom(
  scene: MetroScene,
  names: readonly string[] = ["Parts", "Groups", "Stations"],
): MetroZoom {
  const last = names.length - 1;
  return {
    names,
    preset: (level) => (level >= last ? { "*": true } : {}),
    scene: (level, open) => foldScene(scene, level, open),
    total: scene.st.length,
  };
}

const zoneOf = (scene: MetroScene, x: number) =>
  (scene.zones ?? []).findIndex(([a, b]) => x >= a && x < b);

/**
 * The scene at a level. Level 2 and up: every station. Level 1: the named groups (`station.g`).
 * Level 0: one run per line per column. A group in `open` stays open.
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
  for (const s of scene.st) {
    if (!isMark(s)) continue;
    const k = key(s);
    if (k && !open[k]) groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const into = new Map<string, string>();
  const caps: CapsuleStation[] = [];
  for (const [k, m] of groups) {
    const first = m[0];
    if (m.length < 2 || !first?.ln) continue;
    const line = scene.lines?.[first.ln] ?? { n: first.ln, l: first.ln };
    const xs = m.map((s) => s.x);
    const ids = new Set(m.map((s) => s.id));
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const zone = scene.zones?.[zoneOf(scene, first.x)]?.[2];
    const name =
      level === 1
        ? (scene.groups?.[k] ?? k)
        : line.l === "out" || !zone
          ? line.n
          : `${line.n} · ${zone.toLowerCase().replace(/^./, (c) => c.toUpperCase())}`;
    caps.push({
      id: k,
      grp: k,
      cap: [lo, hi],
      x: (lo + hi) / 2,
      y: first.y,
      l: line.l,
      late: scene.tr.some((r) => r.late && r.a && r.b && ids.has(r.a) && ids.has(r.b)),
      now: m.reduce((a, s) => a + (s.now ?? 0), 0),
      n: name,
    });
    for (const s of m) into.set(s.id, k);
  }
  const byId = new Map(scene.st.map((s) => [s.id, s]));
  const cap = new Map(caps.map((c) => [c.id, c]));
  /** The end of a track: the station, or the capsule's edge nearest the far end. */
  const end = (id: string | undefined, o: number, other: string | undefined): Point | undefined => {
    if (!id) return undefined;
    const k = into.get(id);
    const s = byId.get(id);
    if (!k) return s ? [s.x ?? 0, s.y + o] : undefined;
    const c = cap.get(k);
    if (!c) return undefined;
    const ox = other ? (byId.get(other)?.x ?? c.x ?? c.cap[0]) : (c.x ?? c.cap[0]);
    return [Math.min(Math.max(ox, c.cap[0]), c.cap[1]), c.y];
  };
  const tr = scene.tr.flatMap((r): MetroTrack[] => {
    const ka = r.a ? into.get(r.a) : undefined;
    const kb = r.b ? into.get(r.b) : undefined;
    if (ka && ka === kb) return [];
    if (!ka && !kb) return [r];
    const { pts: _pts, at: _at, ...rest } = r;
    const pa = end(r.a, r.oa ?? r.o ?? 0, r.b) ?? r.pts?.[0];
    const pc = end(r.b, r.ob ?? r.o ?? 0, r.a) ?? r.pts?.[r.pts.length - 1];
    return [{ ...rest, ...(pa ? { pa } : {}), ...(pc ? { pc } : {}) }];
  });
  const st: SceneStation[] = scene.st.filter((s) => !into.has(s.id)).concat(caps);
  return { ...scene, st, tr };
}
