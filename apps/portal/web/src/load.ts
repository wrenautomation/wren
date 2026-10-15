/** Loading a portal call into a component. */
import { onWrite, type Patch, useLoad, writeThrough } from "@wren/ui";
import { ApiError, device, deviceOwner, viewingAs } from "./api.js";
import { readSnapshot, writeSnapshot } from "./snapshot.js";

export type Load<T> = {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  retry: () => void;
  /** The tick when the read now shown left: hand it to `useSaved` as `at`. */
  at: number;
};

/** Every portal call's last answers; each key names its client. */
const PORTAL = {};

/**
 * A save landed: patch every portal call's answer (`patch(key, data)` returns `data` itself when
 * it isn't touched), on screen, kept, and any read still out, instead of reading them again.
 */
export function patchCalls(patch: Patch) {
  writeThrough(PORTAL, patch);
}

/** Answers kept on the device: the last load's, then this one's (never under View as). */
const KEPT_MAX = 200;
const kept = new Map<string, unknown>(
  viewingAs
    ? []
    : (() => {
        const d = device();
        return d ? readSnapshot(d, deviceOwner(), Date.now()) : [];
      })(),
);
function keep(key: string, data: unknown) {
  kept.delete(key);
  kept.set(key, data);
  if (kept.size > KEPT_MAX) kept.delete(kept.keys().next().value as string);
}
function save() {
  const d = device();
  const who = deviceOwner();
  if (!d || !who || viewingAs) return;
  writeSnapshot(d, who, Date.now(), [...kept]);
}
onWrite(PORTAL, (patch) => {
  for (const [k, v] of kept) {
    const next = patch(k, v);
    if (next !== v) kept.set(k, next);
  }
});
if (typeof addEventListener === "function") {
  addEventListener("pagehide", save);
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
  });
}

/**
 * Run `fn` whenever `key` changes, or on `retry`; the last answer stays on screen while the
 * next loads, and one seen before (in this tab, or on this device's last load) shows at once
 * while it refreshes. A refused answer drops what the device kept for it.
 */
export function useCall<T>(key: string, fn: () => Promise<T>): Load<T> {
  const load = useLoad(
    key,
    () =>
      fn().then(
        (data) => {
          keep(key, data);
          return data;
        },
        (err: unknown) => {
          const e = err instanceof ApiError ? err : new ApiError(String(err), 0);
          if (e.status === 401 || e.status === 403 || e.status === 404) kept.delete(key);
          throw e;
        },
      ),
    PORTAL,
  ) as Load<T>;
  if (load.data !== null || !kept.has(key)) return load;
  return { ...load, data: kept.get(key) as T };
}
