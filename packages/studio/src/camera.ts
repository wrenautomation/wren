/**
 * The auto camera on a filmed take (designs/2026-10-24-filmed-takes.md, Camera rules): it pushes
 * in on each run of acts, follows them, holds, and pulls back to the whole page. Out come camera
 * keys that `cameraAt` plays (eased from key to key), with `at` in seconds of the shot.
 */
import { cameraAt } from "./promo-clock.js";
import type { PaneEvent } from "./take.js";

const CAMERA = {
  /** Acts closer than this are one run. */
  joinS: 2.5,
  zoom: 1.8,
  /** The push in, before the first act. */
  inS: 0.6,
  /** The hold after the last act, then the pull back. */
  holdS: 1,
  outS: 0.6,
};
export type CameraKnobs = typeof CAMERA;
export type CameraKey = { at: number; x: number; y: number; zoom: number };

/** Where each act is: a press at its point, a field at its box's middle, a key at the field typed in. */
function actsOf(events: readonly PaneEvent[], [w, h]: readonly [number, number]) {
  const acts: { t: number; x: number; y: number }[] = [];
  let field: { x: number; y: number } | null = null;
  for (const e of events) {
    if (e.kind === "focus") {
      field = { x: e.box.x + e.box.w / 2, y: e.box.y + e.box.h / 2 };
      acts.push({ t: e.t, ...field });
    } else if (e.kind === "down") acts.push({ t: e.t, x: e.x, y: e.y });
    else if (e.kind === "key" && field) acts.push({ t: e.t, ...field });
  }
  return acts.map((a) => ({ t: a.t, x: a.x / w, y: a.y / h }));
}

/**
 * Camera keys for a shot `seconds` long. `events`: the shot's log, `t` in seconds from its start
 * (some may be before 0: a run under way at the cut). `size`: the pane's CSS px.
 */
export function autoCamera(
  events: readonly PaneEvent[],
  size: readonly [number, number],
  seconds: number,
  knobs: Partial<CameraKnobs> = {},
): CameraKey[] {
  const k = { ...CAMERA, ...knobs };
  const loads = events.filter((e) => e.kind === "load").map((e) => e.t);
  const runs: { t: number; x: number; y: number }[][] = [];
  for (const a of actsOf(events, size)) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    // A page load between two acts ends the run: the page under the camera changed.
    const loaded = last && loads.some((l) => l > last.t && l <= a.t);
    if (run && last && a.t - last.t < k.joinS && !loaded) run.push(a);
    else runs.push([a]);
  }
  const keys: CameraKey[] = [];
  for (const run of runs) {
    const first = run[0] as (typeof run)[number];
    const last = run.at(-1) as (typeof run)[number];
    const prev = keys.at(-1);
    const inAt = Math.max(first.t - k.inS, prev ? prev.at : Number.NEGATIVE_INFINITY);
    keys.push({ at: inAt, x: first.x, y: first.y, zoom: 1 });
    for (const a of run)
      keys.push({ at: Math.max(a.t, inAt + 0.01), x: a.x, y: a.y, zoom: k.zoom });
    // A load in the hold pulls back at once.
    const load = loads.find((l) => l > last.t && l < last.t + k.holdS);
    const hold = load ?? last.t + k.holdS;
    keys.push({ at: hold, x: last.x, y: last.y, zoom: k.zoom });
    keys.push({ at: hold + k.outS, x: last.x, y: last.y, zoom: 1 });
  }
  return clip(keys, seconds);
}

/** Keys from 0 to `seconds`: the camera as it is at each end, and the keys between. */
export function clip(keys: readonly CameraKey[], seconds: number): CameraKey[] {
  if (!keys.length) return [];
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  // `cameraAt` starts on the whole page at 0 unless a key is at or before it: a run under way.
  const at = (t: number): CameraKey => ({ at: t, ...cameraAt(sorted, t) });
  const inside = sorted.filter((key) => key.at > 0 && key.at < seconds);
  return [at(0), ...inside, at(seconds)];
}
