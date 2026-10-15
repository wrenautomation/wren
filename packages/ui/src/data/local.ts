/**
 * The local copy (designs/2026-10-15-one-write-path.md, "The data layer"): the read cache
 * (`./query.ts`) kept in this browser's IndexedDB, so the next load paints at once and reads
 * again behind it, and shared live with the portal's other tabs (BroadcastChannel).
 *
 * Unsaved edits (`./edits.ts`) are kept in the same database under the same person.
 *
 * Safety: one copy per signed-in person (the key names them), holding only answers the server
 * gave them, from named scopes, and their own unsaved words. None under View as. `dropLocalCopy` wipes it: sign-out, a
 * refused sign-in, another person signing in, forgetting the device. Never tokens.
 */
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { broadcastQueryClient } from "@tanstack/query-broadcast-client-experimental";
import {
  type PersistedClient,
  persistQueryClient,
  removeOldestQuery,
} from "@tanstack/query-persist-client-core";
import { EDITS } from "./edits.js";
import { KEEP_MS, QUERIES } from "./query.js";

const DB = "wren-local";
const STORE = "copies";
/** Bump when what's kept changes shape: an older copy is dropped on load. */
const SHAPE = "1";
/** The most the copy keeps; the oldest answers go first past it. */
export const LOCAL_MAX_CHARS = 4_000_000;

/** What the persister writes through. */
export interface AsyncStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface KeyValue extends AsyncStore {
  clear(): Promise<void>;
  /** Every entry whose key starts with `prefix`. */
  entries(prefix: string): Promise<[string, string][]>;
}

/** A key-value store in IndexedDB, or null where there is none (a test, a locked-down browser). */
export function indexedStore(
  idb: IDBFactory | undefined = globalThis.indexedDB,
  name = DB,
): KeyValue | null {
  if (!idb) return null;
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    db ??= new Promise<IDBDatabase>((ok, fail) => {
      const r = idb.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
    return db;
  };
  const run = async <T>(
    mode: IDBTransactionMode,
    fn: (s: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const d = await open();
    return new Promise<T>((ok, fail) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => ok(req.result);
      t.onerror = () => fail(t.error);
      t.onabort = () => fail(t.error);
    });
  };
  return {
    getItem: async (k) => ((await run("readonly", (s) => s.get(k))) as string | undefined) ?? null,
    setItem: async (k, v) => void (await run("readwrite", (s) => s.put(v, k))),
    removeItem: async (k) => void (await run("readwrite", (s) => s.delete(k))),
    clear: async () => void (await run("readwrite", (s) => s.clear())),
    entries: async (prefix) => {
      const d = await open();
      return new Promise<[string, string][]>((ok, fail) => {
        const out: [string, string][] = [];
        const t = d.transaction(STORE, "readonly");
        const req = t.objectStore(STORE).openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return;
          out.push([String(c.key), String(c.value)]);
          c.continue();
        };
        t.oncomplete = () => ok(out);
        t.onerror = () => fail(t.error);
      });
    },
  };
}

/** The copy as written: the newest answers that fit under `max` characters. */
export function fitted(client: PersistedClient, max = LOCAL_MAX_CHARS): string {
  const queries = [...client.clientState.queries].sort(
    (a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt,
  );
  const kept: typeof queries = [];
  let size = 0;
  for (const q of queries) {
    let n: number;
    try {
      n = JSON.stringify(q).length;
    } catch {
      continue; // Not plain data: never kept.
    }
    if (size + n > max) continue;
    size += n;
    kept.push(q);
  }
  return JSON.stringify({ ...client, clientState: { ...client.clientState, queries: kept } });
}

let stop: (() => void) | null = null;
let store: KeyValue | null = null;
let landedChannel: BroadcastChannel | null = null;

export interface LocalCopy {
  /** Who is signed in here; null keeps nothing (View as, signed out). */
  owner: string | null;
  storage?: KeyValue | null;
  /** Share answers with the other tabs of this person (default on). */
  tabs?: boolean;
}

/**
 * Keep the cache on the device for `owner` and share it with their other tabs. Resolves once
 * the copy from the last load is back in the cache (or there was none).
 */
export function startLocalCopy({
  owner,
  storage = indexedStore(),
  tabs = true,
}: LocalCopy): Promise<void> {
  stopLocalCopy();
  if (!owner) return Promise.resolve();
  store = storage;
  const offs: (() => void)[] = [];
  let ready = Promise.resolve();
  if (storage) {
    // A save the persister still has queued never lands after a wipe.
    let on = true;
    offs.push(() => {
      on = false;
    });
    const gated: AsyncStore = {
      getItem: (k) => storage.getItem(k),
      setItem: (k, v) => (on ? storage.setItem(k, v) : Promise.resolve()),
      removeItem: (k) => storage.removeItem(k),
    };
    const [off, restored] = persistQueryClient({
      queryClient: QUERIES,
      persister: createAsyncStoragePersister({
        storage: gated,
        key: `copy:${owner}`,
        throttleTime: 2000,
        serialize: (c) => fitted(c),
        retry: removeOldestQuery,
      }),
      maxAge: KEEP_MS,
      buster: SHAPE,
      dehydrateOptions: {
        shouldDehydrateQuery: (q) => q.state.status === "success" && q.meta?.keep === true,
        shouldDehydrateMutation: () => false,
      },
    });
    offs.push(off);
    ready = restored.catch(() => undefined);
  }
  // Unsaved edits live in the same database, under the same person.
  const legacy = (() => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  })();
  ready = Promise.all([ready, EDITS.start(owner, storage, legacy)]).then(() => undefined);
  if (tabs && typeof BroadcastChannel !== "undefined") {
    const channel = `wren-data:${owner}`;
    const off = broadcastQueryClient({ queryClient: QUERIES, broadcastChannel: channel });
    if (typeof off === "function") offs.push(off);
    landedChannel = new BroadcastChannel(`${channel}:landed`);
    // A write landed in another tab: what this one shows may be old.
    landedChannel.onmessage = () => void QUERIES.invalidateQueries();
    const ch = landedChannel;
    offs.push(() => ch.close());
  }
  stop = () => {
    for (const off of offs) off();
    landedChannel = null;
  };
  return ready;
}

/** Tell the other tabs a write landed: they read again what they show. */
export function tellTabsLanded() {
  try {
    landedChannel?.postMessage({ landed: true });
  } catch {
    // No other tabs.
  }
}

function stopLocalCopy() {
  stop?.();
  stop = null;
}

/** Wipe the copy and the cache: nothing of this login stays on the device. */
export async function dropLocalCopy(storage: KeyValue | null = store ?? indexedStore()) {
  stopLocalCopy();
  QUERIES.clear();
  EDITS.wipe();
  try {
    await storage?.clear();
  } catch {
    // Blocked storage kept nothing.
  }
}
