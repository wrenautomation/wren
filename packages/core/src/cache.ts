/**
 * The shared cache (designs/2026-10-11-cache.md). Postgres is the truth; the cache only saves
 * a read. Read-through with a TTL, and a write that changes the truth deletes its key
 * (invalidate on write). Never write-back: a value lives nowhere but the database first.
 * Never a secret: the cache is a plain store on the box, outside the key store's encryption.
 *
 * `WREN_CACHE_URL` set: Redis on the box, shared by every Lambda and the box worker. Unset:
 * memory, per process. A cache that fails is a miss, never an error: the read goes to the
 * truth.
 */
import { type RespClient, respClient } from "./resp.js";

export interface Cache {
  readonly name: "memory" | "redis";
  get(key: string): Promise<string | null>;
  /** Kept for `ttlMs`, then gone. */
  set(key: string, value: string, ttlMs: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
}

/** Every key is under this: a change in what a key holds bumps it, and old values age out. */
const PREFIX = "wren:v1:";
const MEMORY_MAX = 2000;

/** Per process, least recently used out first past `max`. */
export function memoryCache(now: () => number = Date.now, max = MEMORY_MAX): Cache {
  const m = new Map<string, { value: string; until: number }>();
  return {
    name: "memory",
    async get(key) {
      const hit = m.get(key);
      if (!hit) return null;
      m.delete(key);
      if (hit.until <= now()) return null;
      m.set(key, hit);
      return hit.value;
    },
    async set(key, value, ttlMs) {
      m.delete(key);
      m.set(key, { value, until: now() + ttlMs });
      while (m.size > max) {
        const oldest = m.keys().next().value;
        if (oldest === undefined) break;
        m.delete(oldest);
      }
    },
    async del(...keys) {
      for (const k of keys) m.delete(k);
    },
  };
}

export function redisCache(url: string, client: RespClient = respClient(url)): Cache {
  return {
    name: "redis",
    async get(key) {
      const r = await client.send("GET", PREFIX + key);
      return typeof r === "string" ? r : null;
    },
    async set(key, value, ttlMs) {
      await client.send("SET", PREFIX + key, value, "PX", String(Math.max(1, Math.round(ttlMs))));
    },
    async del(...keys) {
      if (keys.length) await client.send("DEL", ...keys.map((k) => PREFIX + k));
    },
  };
}

/** Redis when a URL is set, else memory. */
export function cacheFrom(url: string | undefined): Cache {
  return url ? redisCache(url) : memoryCache();
}

let warnedAt = 0;
/** A failed cache call, said at most once a minute per process: a down cache is quiet. */
function warn(err: unknown) {
  const at = Date.now();
  if (at - warnedAt < 60_000) return;
  warnedAt = at;
  console.warn(`cache: ${err instanceof Error ? err.message : String(err)}; reading through`);
}

const loading = new Map<string, Promise<unknown>>();

/**
 * The value under `key`, else `load()`'s, kept `ttlMs`. One load per key per process at a
 * time. JSON in and out: a Date comes back a string. A load that throws is not kept.
 */
export async function readThrough<T>(
  cache: Cache,
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  try {
    const hit = await cache.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch (err) {
    warn(err);
  }
  const running = loading.get(key);
  if (running) return running as Promise<T>;
  const p = (async () => {
    try {
      const value = await load();
      try {
        await cache.set(key, JSON.stringify(value), ttlMs);
      } catch (err) {
        warn(err);
      }
      return value;
    } finally {
      loading.delete(key);
    }
  })();
  loading.set(key, p);
  return p;
}

/** Drops keys after a write to their truth. A cache that fails here is waited out by the TTL. */
export async function invalidate(cache: Cache, ...keys: string[]): Promise<void> {
  try {
    await cache.del(...keys);
  } catch (err) {
    warn(err);
  }
}
