/** Loading a portal call into a component: a TanStack Query read (`@wren/ui` data layer). */
import { nameScope, type Patch, readCached, useLoad, writeThrough } from "@wren/ui";
import { useEffect, useState } from "react";
import { ApiError } from "./api.js";

export type Load<T> = {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  retry: () => void;
  /** The tick when the read now shown left: hand it to `useSaved` as `at`. */
  at: number;
};

/** Every portal call's answers; each key names its client. Kept on the device. */
export const PORTAL = nameScope({}, "portal");

/**
 * A save landed: patch every portal call's answer (`patch(key, data)` returns `data` itself when
 * it isn't touched), on screen, kept, in other tabs and any read still out, instead of reading
 * them again.
 */
export function patchCalls(patch: Patch) {
  writeThrough(PORTAL, patch);
}

const asApiError = (err: unknown): never => {
  throw err instanceof ApiError ? err : new ApiError(String(err), 0);
};

/**
 * Run `fn` whenever `key` changes, or on `retry`; the last answer stays on screen while the
 * next loads, and one seen before (this tab, another tab, this device's last load) shows at
 * once while it reads again. A refused read is never kept on the device. A null `key` reads
 * nothing (a closed dialog). `kept: false` keeps the answers in this component only: a preview
 * of words still being typed. `fn` gets the answer it reads over, so a list can ask only for
 * what changed.
 */
export function useCall<T>(
  key: string | null,
  fn: (before: T | undefined) => Promise<T>,
  o: { kept?: boolean } = {},
): Load<T> {
  return useLoad<T>(
    key,
    (before) => fn(before).catch(asApiError),
    o.kept === false ? undefined : PORTAL,
  ) as Load<T>;
}

/**
 * A portal call's answer for code outside a component (a picker's people): the cached one while
 * it is younger than `freshMs`, else read, cached and kept on the device.
 */
export const readCall = <T>(key: string, fn: () => Promise<T>, freshMs?: number): Promise<T> =>
  readCached(PORTAL, key, () => fn().catch(asApiError), freshMs);

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
