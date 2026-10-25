/** Fakes for the save engine's tests: storage, locks, page events, a server that answers by hand. */
import type { Locks, PageEvent, SaveEnv, Store } from "./env.js";
import type { WriteEnv } from "./writes.js";

export function memoryStore(): Store & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** One holder per name; `most` is the most holders of one name at once. */
export function fakeLocks(): Locks & { most: number } {
  const tails = new Map<string, Promise<unknown>>();
  const holding = new Map<string, number>();
  const out = {
    most: 0,
    request<R>(name: string, run: () => Promise<R>): Promise<R> {
      const before = tails.get(name) ?? Promise.resolve();
      const p = before.then(async () => {
        const n = (holding.get(name) ?? 0) + 1;
        holding.set(name, n);
        out.most = Math.max(out.most, n);
        try {
          return await run();
        } finally {
          holding.set(name, (holding.get(name) ?? 1) - 1);
        }
      });
      tails.set(
        name,
        p.catch(() => undefined),
      );
      return p;
    },
  };
  return out;
}

function fakePage() {
  const seen = new Set<(e: PageEvent) => void>();
  return {
    listen(fn: (e: PageEvent) => void) {
      seen.add(fn);
      return () => void seen.delete(fn);
    },
    fire(e: PageEvent) {
      for (const f of [...seen]) f(e);
    },
    get listening() {
      return seen.size;
    },
  };
}

export function fakeEnv(o: { storage?: Store; locks?: Locks | null } = {}) {
  const page = fakePage();
  let n = 0;
  const env: SaveEnv = {
    storage: o.storage ?? memoryStore(),
    locks: o.locks === undefined ? fakeLocks() : o.locks,
    listen: page.listen,
    id: () => {
      n += 1;
      return `req-${n}`;
    },
    now: () => Date.now(),
  };
  return { env, page };
}

export interface Pending<V, C> {
  value: V;
  ctx: C;
  ok: (answer?: unknown) => void;
  fail: (err: unknown) => void;
}

/** A save function whose calls wait until the test answers each one. */
export function handServer<V, C>() {
  const calls: Pending<V, C>[] = [];
  const save = (value: V, ctx: C) =>
    new Promise<never>((ok, fail) => {
      calls.push({ value, ctx, ok: ok as (a?: unknown) => void, fail });
    });
  return { calls, save };
}

/** An error as the portal's `call` throws it. */
export function refusal(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

/** A tab for `Writes`: always showing, never leaving, ids req-1, req-2... */
export function fakeWriteEnv(storage: Store | null = memoryStore()): WriteEnv {
  let n = 0;
  return {
    storage,
    now: () => Date.now(),
    id: () => {
      n += 1;
      return `req-${n}`;
    },
    visible: () => true,
    listen: () => () => undefined,
    remind: () => undefined,
  };
}
