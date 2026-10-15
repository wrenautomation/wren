/**
 * The app's one pulse. What the shell keeps fresh (the sidebar's counts, Learn's bell) joins here
 * instead of running its own timer. Once a minute, only while the tab shows and the window has
 * focus, every beat runs and their reads go out as one request (`batched`). Coming back to the
 * tab runs them once more (the data layer's `focusManager`). A hidden tab sends nothing.
 */
import { focusManager } from "@wren/ui";
import { batched } from "./api.js";

const EVERY_MS = 60_000;
/** Visibility and focus fire together on a return: one beat for both. */
const SETTLE_MS = 1_000;

const beats = new Set<() => unknown>();
let timer: ReturnType<typeof setInterval> | undefined;
let offBack: (() => void) | undefined;
let last = 0;

/** A poll that isn't on the pulse asks only while the tab shows. */
export const shown = () => document.visibilityState === "visible";

const here = () => document.visibilityState === "visible" && document.hasFocus();

function run(list: Iterable<() => unknown>) {
  last = Date.now();
  batched(() => {
    for (const beat of list) void beat();
  });
}

const tick = () => {
  if (here()) run([...beats]);
};
const back = () => {
  if (here() && Date.now() - last > SETTLE_MS) run([...beats]);
};

/** Beats that join within 50 ms of each other run together, so their reads go out as one. */
let fresh: (() => unknown)[] = [];
let queued = false;

/** Join the pulse: `beat` runs now, then each minute while the tab shows. Returns how to leave. */
export function onPulse(beat: () => unknown): () => void {
  beats.add(beat);
  fresh.push(beat);
  if (!queued) {
    queued = true;
    setTimeout(() => {
      queued = false;
      const now = fresh.filter((b) => beats.has(b));
      fresh = [];
      if (now.length) run(now);
    }, 50);
  }
  if (beats.size === 1) {
    timer = setInterval(tick, EVERY_MS);
    // The data layer's own return to the tab (one listener for the whole app).
    offBack = focusManager.subscribe((focused) => focused && back());
  }
  return () => {
    beats.delete(beat);
    if (beats.size === 0) {
      clearInterval(timer);
      offBack?.();
    }
  };
}
