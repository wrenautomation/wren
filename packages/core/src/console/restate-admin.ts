/**
 * Restate's admin API from the console: SQL over its own tables, a cached GET (`/services`, a
 * service's OpenAPI), each with a deadline so a hung call never holds a pass, and which loop
 * objects are running.
 */
import { type Cache, memoryCache, readThrough } from "../cache.js";
import { LOOPS_SQL, loopsOf } from "./loops.js";

export type RestateAdmin = (query: string) => Promise<Record<string, unknown>[]>;

/** A GET on Restate's admin API: `/services`, `/services/<name>/openapi`. */
export type RestateAdminGet = (path: string) => Promise<unknown>;

const ADMIN_CACHE_MS = 5 * 60_000;

/**
 * GETs on the admin API, each path kept 5 minutes: the list changes only on a deploy. With the
 * shared cache, one Lambda's read serves the rest.
 */
export const restateAdminGet = (
  url: string,
  token?: string,
  cache: Cache = memoryCache(),
): RestateAdminGet => {
  const base = url.replace(/\/$/, "");
  return (path) =>
    readThrough(cache, `restate-admin:${base}${path}`, ADMIN_CACHE_MS, async () => {
      const res = await fetch(`${base}${path}`, {
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          accept: "application/json",
        },
        signal: AbortSignal.timeout(ADMIN_LIMIT_MS),
      });
      if (!res.ok) throw new Error(`restate admin GET ${path}: ${res.status} ${await res.text()}`);
      return (await res.json()) as unknown;
    });
};

/** One admin API call (LoopWatch, DeadLetters, Console): a hung one never holds a pass. */
const ADMIN_LIMIT_MS = 30_000;

export const restateAdmin =
  (url: string, token?: string): RestateAdmin =>
  async (query) => {
    const res = await fetch(`${url.replace(/\/$/, "")}/query`, {
      method: "POST",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(ADMIN_LIMIT_MS),
    });
    if (!res.ok) throw new Error(`restate admin query: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { rows: Record<string, unknown>[] }).rows;
  };

/** The services with a loop object running: the Shop's "Off" for a part whose loops all stopped. */
export const runningLoops = (admin: RestateAdmin) => async (): Promise<ReadonlySet<string>> =>
  new Set(
    loopsOf(await admin(LOOPS_SQL))
      .filter((l) => l.running)
      .map((l) => l.service),
  );
