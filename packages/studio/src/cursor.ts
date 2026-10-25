/**
 * The drawn cursor of a filmed take (designs/2026-10-24-filmed-takes.md, Cursor). The film has
 * no cursor; the hands' log does. `cursorTrack` reads the log once (in the props), `cursorAt` says
 * where the arrow is and how it looks at any second. No imports, so Remotion's bundler takes it.
 */

/** Seconds still before the arrow fades, and how long the fades take. */
export const CURSOR = {
  idleS: 1.5,
  outS: 0.3,
  inS: 0.15,
  pressS: 0.06,
  releaseS: 0.18,
  ringS: 0.35,
};
/** How small the arrow gets while pressed. */
const PRESSED = 0.85;

/** What the composition needs from a shot's log: seconds from the shot's start, CSS px of the pane. */
export interface CursorTrack {
  /** Every point the pointer passed, in order: `[t, x, y]`. */
  path: [number, number, number][];
  /** Each press: `[down, up, x, y]`. */
  presses: [number, number, number, number][];
  /** Stretches the pointer was in use: `[from, to]`, apart by more than `CURSOR.idleS`. */
  runs: [number, number][];
}

type LogEvent = { kind: string; t: number; x?: number; y?: number };

/** The log as a track: moves and presses, the runs between still spells. */
export function cursorTrack(events: readonly LogEvent[]): CursorTrack | null {
  const path: CursorTrack["path"] = [];
  const presses: CursorTrack["presses"] = [];
  for (const e of events) {
    if (e.x === undefined || e.y === undefined) continue;
    if (e.kind === "move" || e.kind === "down") path.push([e.t, e.x, e.y]);
    if (e.kind === "down") presses.push([e.t, Number.POSITIVE_INFINITY, e.x, e.y]);
    const open = presses.at(-1);
    if (e.kind === "up" && open && open[1] === Number.POSITIVE_INFINITY) open[1] = e.t;
  }
  if (!path.length) return null;
  const runs: CursorTrack["runs"] = [];
  for (const [t] of path) {
    const last = runs.at(-1);
    if (last && t - last[1] <= CURSOR.idleS) last[1] = t;
    else runs.push([t, t]);
  }
  for (const p of presses) if (p[1] === Number.POSITIVE_INFINITY) p[1] = p[0] + CURSOR.pressS;
  return { path, presses, runs };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (p: number) => 1 - (1 - clamp01(p)) ** 3;

/** The last index whose time is at or before `t`; -1 when none is. */
function lastAt<T extends readonly number[]>(rows: readonly T[], t: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((rows[mid]?.[0] ?? Number.POSITIVE_INFINITY) <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export interface CursorState {
  x: number;
  y: number;
  /** The arrow's size, 1 at rest. */
  scale: number;
  opacity: number;
  /** A press's ring as it spreads: 0 to 1, where it was pressed. */
  ring: { p: number; x: number; y: number } | null;
}

/**
 * The arrow at second `t`: on the hands' own curve (each point to the next, in a straight line;
 * the log is at about 60 a second), smaller while pressed, faded out when still.
 */
export function cursorAt(track: CursorTrack, t: number): CursorState {
  const { path, presses, runs } = track;
  const i = lastAt(path, t);
  const a = path[Math.max(0, i)] as [number, number, number];
  const b = path[i + 1];
  const k = b && i >= 0 ? clamp01((t - a[0]) / (b[0] - a[0] || 1)) : 0;
  const x = b && i >= 0 ? a[1] + (b[1] - a[1]) * k : a[1];
  const y = b && i >= 0 ? a[2] + (b[2] - a[2]) * k : a[2];
  const run = runs[lastAt(runs, t)];
  const opacity = run
    ? Math.min(
        clamp01((t - run[0]) / CURSOR.inS),
        1 - clamp01((t - run[1] - CURSOR.idleS) / CURSOR.outS),
      )
    : 0;
  const press = presses[lastAt(presses, t)];
  let scale = 1;
  let ring: CursorState["ring"] = null;
  if (press) {
    const [down, up, px, py] = press;
    scale =
      t < up
        ? 1 - (1 - PRESSED) * easeOut((t - down) / CURSOR.pressS)
        : PRESSED + (1 - PRESSED) * easeOut((t - up) / CURSOR.releaseS);
    if (t - down < CURSOR.ringS) ring = { p: (t - down) / CURSOR.ringS, x: px, y: py };
  }
  return { x, y, scale, opacity, ring };
}
