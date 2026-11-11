/**
 * The app's one pulse. What the shell keeps fresh (the sidebar's counts) joins here
 * instead of running its own timer. Once a minute, only while the tab shows and the window has
 * focus, every beat runs and their reads go out as one request (`batched`). Coming back to the
 * tab runs them once more (the data layer's `focusManager`). A live push on any topic runs them
 * too, at most once per `HEARD_GAP_MS` (./topic-socket.ts). A hidden tab sends nothing.
 */
import { focusManager } from "@wren/ui";
import { batched } from "./api.js";
import { ANY_TOPIC, onTopic } from "./topic-socket.js";

const EVERY_MS = 60_000;
/** Visibility and focus fire together on a return: one beat for both. */
const SETTLE_MS = 1_000;
/** Pushes inside this gap after a beat fold into one beat at its end. */
const HEARD_GAP_MS = 5_000;

const beats = new Set<() => unknown>();
let timer: ReturnType<typeof setInterval> | undefined;
let offBack: (() => void) | undefined;
let offHeard: (() => void) | undefined;
let heardDue: ReturnType<typeof setTimeout> | undefined;
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
/** A push: beat now, or once at the gap's end. A hidden tab beats on its return instead. */
const heard = () => {
  if (heardDue || !shown()) return;
  heardDue = setTimeout(
    () => {
      heardDue = undefined;
      if (shown()) run([...beats]);
    },
    Math.max(0, last + HEARD_GAP_MS - Date.now()),
  );
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
    offHeard = onTopic(ANY_TOPIC, heard);
  }
  return () => {
    beats.delete(beat);
    if (beats.size === 0) {
      clearInterval(timer);
      clearTimeout(heardDue);
      heardDue = undefined;
      offBack?.();
      offHeard?.();
    }
  };
}
