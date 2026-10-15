/** Loading a portal call into a component. */
import { onWrite, type Patch, patchedSince, tick, useLoad, writeThrough } from "@wren/ui";
import { useEffect, useState } from "react";
import { ApiError, device, deviceOwner, viewing } from "./api.js";
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
  viewing
    ? []
    : (() => {
        const d = device();
        return d ? readSnapshot(d, deviceOwner(), Date.now()) : [];
      })(),
);
/** When the read behind each kept answer left: an older read that lands late never replaces it. */
const keptLeft = new Map<string, number>();
/**
 * Keep a read of `key` that left at tick `left`, with the saves made since applied, unless a
 * newer read is kept already.
 */
export function keep(key: string, data: unknown, left: number) {
  if ((keptLeft.get(key) ?? -1) > left) return;
  keptLeft.set(key, left);
  kept.delete(key);
  kept.set(key, patchedSince(PORTAL, key, data, left));
  if (kept.size > KEPT_MAX) {
    const old = kept.keys().next().value as string;
    kept.delete(old);
    keptLeft.delete(old);
  }
}
/** What the device keeps for `key` (tests). */
export const keptOf = (key: string) => kept.get(key);
function save() {
  const d = device();
  const who = deviceOwner();
  if (!d || !who || viewing) return;
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
    () => {
      const left = tick();
      return fn().then(
        (data) => {
          keep(key, data, left);
          return data;
        },
        (err: unknown) => {
          const e = err instanceof ApiError ? err : new ApiError(String(err), 0);
          if (e.status === 401 || e.status === 403 || e.status === 404) kept.delete(key);
          throw e;
        },
      );
    },
    PORTAL,
  ) as Load<T>;
  if (load.data !== null || !kept.has(key)) return load;
  return { ...load, data: kept.get(key) as T };
}

/**
 * `value` once it has held still for `ms`: a search box's words, so a read goes per pause, not
 * per key. The first value counts at once.
 */
export function useSettled<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
