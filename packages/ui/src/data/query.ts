/**
 * The portal's one read cache (designs/2026-10-15-one-write-path.md, "The data layer"): TanStack
 * Query. Every read a page shows (`useLoad`, the portal's `useCall`) is a query in `QUERIES`.
 * It shows what was read before at once and reads again behind it: on mount, on a return to the
 * tab after a minute, on reconnect, and when a write lands. `./local.ts` keeps the cache on the
 * device and shares it with the portal's other tabs.
 *
 * A query's key is its scope's name and the page's key. A scope is whatever its reads share (a
 * workspace's records api, the portal's calls); a named scope (`nameScope`) is kept on the
 * device, an unnamed one lives in this tab only.
 */
import {
  focusManager,
  keepPreviousData,
  onlineManager,
  QueryClient,
  type QueryKey,
  useQuery,
} from "@tanstack/react-query";
import { useRef, useState } from "react";
import { tick } from "../save/clock.js";

/** A return to the tab reads again what is older than this. */
export const FOCUS_STALE_MS = 60_000;
/** Answers stay this long unused; the device copy as long. */
export const KEEP_MS = 7 * 24 * 3600_000;

/** A read that failed for want of a network or a server (not a refusal): worth one more try. */
const transient = (err: unknown) => {
  const status = (err as { status?: unknown } | null)?.status;
  return (
    err instanceof TypeError || (typeof status === "number" && (status === 0 || status >= 500))
  );
};

export const QUERIES = new QueryClient({
  defaultOptions: {
    queries: {
      // Every mount reads again (as the portal always has); the answer before shows meanwhile.
      staleTime: 0,
      gcTime: KEEP_MS,
      retry: (n, err) => n < 1 && transient(err),
      // A tab switch is constant: only what has sat a minute reads again.
      refetchOnWindowFocus: (q) => Date.now() - q.state.dataUpdatedAt > FOCUS_STALE_MS,
      refetchOnReconnect: true,
      // Each answer is new, as a page's own read always was: its stamp (`at`) is its own.
      structuralSharing: false,
    },
  },
});

/** The reads one moment starts go out as one request (the portal's `batched`). */
let together: <T>(fn: () => T) => T = (fn) => fn();
export function readTogether(fn: <T>(run: () => T) => T) {
  together = fn;
}

// A return to the tab, or the network back: what's stale reads again, as one request.
focusManager.setEventListener((focused) => {
  if (typeof document === "undefined" || typeof addEventListener !== "function") return;
  const on = () => together(() => focused(document.visibilityState !== "hidden"));
  document.addEventListener("visibilitychange", on);
  return () => document.removeEventListener("visibilitychange", on);
});
onlineManager.setEventListener((online) => {
  if (typeof addEventListener !== "function") return;
  const up = () => together(() => online(true));
  const down = () => online(false);
  addEventListener("online", up);
  addEventListener("offline", down);
  return () => {
    removeEventListener("online", up);
    removeEventListener("offline", down);
  };
});
// The client listens for those only once mounted (a `QueryClientProvider` does it; the portal
// passes `QUERIES` to each hook instead). Unmounted, a return to the tab read nothing again.
if (typeof document !== "undefined") QUERIES.mount();

// --- scopes ---------------------------------------------------------------------------------

interface ScopeName {
  name: string;
  /** Kept on the device (`./local.ts`). */
  keep: boolean;
}
const NAMES = new WeakMap<object, ScopeName>();
let unnamed = 0;

/** Give `scope` a name that lasts across loads: its reads are kept on the device. */
export function nameScope<S extends object>(scope: S, name: string): S {
  NAMES.set(scope, { name, keep: true });
  return scope;
}

function nameOf(scope: object): ScopeName {
  let n = NAMES.get(scope);
  if (!n) {
    unnamed += 1;
    n = { name: `tab:${unnamed}`, keep: false };
    NAMES.set(scope, n);
  }
  return n;
}

/** The query key of `key` read under `scope`. */
export const keyOf = (scope: object, key: string): QueryKey => [nameOf(scope).name, key];

// --- stamps ---------------------------------------------------------------------------------

/** When the read behind each answer left (`tick()`): only this tab's own reads have one. */
const STAMPS = new WeakMap<object, number>();
const stamp = (data: unknown, left: number) => {
  if (data && typeof data === "object") STAMPS.set(data, left);
};
/** The tick the read behind `data` left; 0 for one kept from before or read in another tab. */
export const stampOf = (data: unknown): number =>
  data && typeof data === "object" ? (STAMPS.get(data) ?? 0) : 0;

// --- write-through --------------------------------------------------------------------------

/** A pure change to one cached answer: the new answer, or `data` itself when it isn't touched. */
export type Patch = (key: string, data: unknown) => unknown;

/** Patches kept this long, for reads still out when they were made. */
const PATCH_MS = 2 * 60_000;
const PATCH_MAX = 50;
const LOGS = new WeakMap<object, { at: number; when: number; patch: Patch }[]>();

/**
 * A save landed: patch every answer read under `scope` (on screen, cached, kept on the device,
 * in other tabs) instead of reading them all again. A read still out gets it when it lands.
 */
export function writeThrough(scope: object, patch: Patch, now = Date.now()) {
  const log = LOGS.get(scope) ?? [];
  LOGS.set(scope, log);
  log.push({ at: tick(), when: now, patch });
  while (log.length > PATCH_MAX || (log[0] && now - log[0].when > PATCH_MS)) log.shift();
  const name = nameOf(scope).name;
  for (const q of QUERIES.getQueryCache().findAll({ queryKey: [name] })) {
    const old = q.state.data;
    if (old === undefined) continue;
    const next = patch(String(q.queryKey[1]), old);
    if (next === old) continue;
    // The patched answer stands for the same read.
    stamp(next, stampOf(old));
    QUERIES.setQueryData(q.queryKey, next, { updatedAt: q.state.dataUpdatedAt });
  }
}

/** `data` from a read of `key` that left at tick `left`, with every patch made since applied. */
export function patchedSince(scope: object, key: string, data: unknown, left: number): unknown {
  let out = data;
  for (const p of LOGS.get(scope) ?? []) if (p.at > left) out = p.patch(key, out);
  return out;
}

// --- reading --------------------------------------------------------------------------------

export type Load<T> = {
  data: T | null;
  error: Error | null;
  /**
   * A read is out, for any reason: the first, one behind the rows on screen, the next key's.
   * For a refresh button or a "wash once read again", not for a skeleton: use `pending`.
   */
  loading: boolean;
  /** There is nothing to show yet and the read is out: the one state that draws a skeleton. */
  pending: boolean;
  /** The answer shown is the last key's, held while the next key's reads: dim it, don't blank it. */
  placeholder: boolean;
  retry: () => void;
  /** The tick (`tick()`) when the read now shown left; 0 for an answer kept from before. */
  at: number;
};

/** The answer cached for `key` under `scope`, if any. */
export const cachedOf = <T>(scope: object, key: string): T | undefined =>
  QUERIES.getQueryData<T>(keyOf(scope, key));

/**
 * `fn` whenever `key` changes; the last answer stays on screen while the next loads. A read
 * behind an answer already shown (a return to the tab, a write that landed, `retry`) changes
 * only `loading`: `data` stays, so a page draws its skeleton on `pending` (no answer yet) and
 * dims on `placeholder` (another key's answer), never on `loading`. With a
 * `scope`, an answer seen before (this tab, another tab, this device's last load) shows at once
 * while it reads again, and `writeThrough(scope, patch)` patches what's shown. `fn` gets the
 * answer it reads over, so a list can ask only for what changed (`./delta.ts`). A null `key`
 * reads nothing (a closed panel): no data, not loading. `freshMs` lets an answer that rarely
 * moves (a workspace's record types) skip the read on mount while it is younger than that.
 */
export function useLoad<T>(
  key: string | null,
  fn: (before: T | undefined) => Promise<T>,
  scope?: object,
  o: { freshMs?: number } = {},
): Load<T> {
  // No scope: this component's own reads, shared with nobody.
  const own = useRef<object | null>(null);
  own.current ??= {};
  const where = scope ?? own.current;
  const queryKey = keyOf(where, key ?? "");
  const q = useQuery<T, Error>(
    {
      queryKey,
      enabled: key !== null,
      queryFn: async () => {
        const left = tick();
        const got = await fn(QUERIES.getQueryData<T>(queryKey));
        const data = patchedSince(where, key ?? "", got, left) as T;
        stamp(data, left);
        return data;
      },
      placeholderData: keepPreviousData,
      ...(o.freshMs ? { staleTime: o.freshMs } : {}),
      // A component's own reads go with it; a scope's stay for the next page that asks.
      ...(scope ? {} : { gcTime: 60_000 }),
      meta: { keep: nameOf(where).keep },
    },
    QUERIES,
  );
  // `retry` shows loading from this render on, so what reads it never paints the old data as new.
  const [asked, setAsked] = useState(0);
  const [answered, setAnswered] = useState(0);
  const refetch = useRef(q.refetch);
  refetch.current = q.refetch;
  return {
    data: key === null ? null : (q.data ?? null),
    error: key === null ? null : (q.error ?? null),
    loading: key !== null && (q.isFetching || q.isPending || asked !== answered),
    pending: key !== null && q.isPending,
    placeholder: key !== null && q.isPlaceholderData,
    retry: () => {
      const n = asked + 1;
      setAsked(n);
      void refetch.current().finally(() => setAnswered(n));
    },
    at: stampOf(q.data),
  };
}

/**
 * The answer of `key` under `scope` for code outside a component (a picker's people, the types a
 * workspace serves): the cached one while it is younger than `freshMs`, else read and cached.
 * Two asks at once share one read. A named scope keeps it on the device.
 */
export function readCached<T>(
  scope: object,
  key: string,
  fn: () => Promise<T>,
  freshMs = FOCUS_STALE_MS,
): Promise<T> {
  return QUERIES.fetchQuery<T, Error>({
    queryKey: keyOf(scope, key),
    queryFn: async () => {
      const left = tick();
      const data = patchedSince(scope, key, await fn(), left) as T;
      stamp(data, left);
      return data;
    },
    staleTime: freshMs,
    meta: { keep: nameOf(scope).keep },
  });
}

/** Forget the answer of `key` under `scope`: the next ask reads it from the server. */
export function dropCached(scope: object, key: string) {
  QUERIES.removeQueries({ queryKey: keyOf(scope, key), exact: true });
}

/**
 * Read everything on screen again (a pull to refresh, a write that landed); done when every read
 * has answered. What isn't on screen is marked old and reads on its next mount.
 */
export async function refreshAll(): Promise<void> {
  await together(() => QUERIES.invalidateQueries(undefined, { throwOnError: false }));
}
