/**
 * Write-through into a page's read caches. A save that landed patches every answer the page
 * holds (the record, the list it sits in) instead of reading them all again. A read that left
 * before the patch and lands after it gets the patch too, so it can't put the old value back.
 *
 * A scope is whatever the answers share (a workspace's records api, the portal's calls): the
 * same object `useLoad` and `useCall` keep their answers under.
 */
import { tick } from "./clock.js";

/** A pure change to one cached answer: the new answer, or `data` itself when it isn't touched. */
export type Patch = (key: string, data: unknown) => unknown;

/** Patches kept this long, for reads still out when they were made. */
const PATCH_MS = 2 * 60_000;
const PATCH_MAX = 50;
/** Answers kept per scope, newest last. */
const CACHE_MAX = 200;

interface Scope {
  answers: Map<string, unknown>;
  /** When the read behind each kept answer left: an older one never replaces it. */
  leftAt: Map<string, number>;
  log: { at: number; when: number; patch: Patch }[];
  seen: Set<(patch: Patch) => void>;
}
const SCOPES = new WeakMap<object, Scope>();

function scopeOf(scope: object): Scope {
  let s = SCOPES.get(scope);
  if (!s) {
    s = { answers: new Map(), leftAt: new Map(), log: [], seen: new Set() };
    SCOPES.set(scope, s);
  }
  return s;
}

/** The answers kept for `scope`, by key. */
export const answersOf = (scope: object): Map<string, unknown> => scopeOf(scope).answers;

/** Keep `data` as the newest answer for `key`; the oldest goes past `max`. */
export function remember(seen: Map<string, unknown>, key: string, data: unknown, max = CACHE_MAX) {
  seen.delete(key);
  seen.set(key, data);
  if (seen.size > max) seen.delete(seen.keys().next().value as string);
}

/**
 * Keep the answer of a read of `key` that left at tick `left`, unless a read that left later is
 * kept already: two reads out at once land in any order, and the newer one stands. False when
 * it was older.
 */
export function rememberRead(scope: object, key: string, data: unknown, left: number): boolean {
  const s = scopeOf(scope);
  if ((s.leftAt.get(key) ?? -1) > left) return false;
  s.leftAt.set(key, left);
  remember(s.answers, key, data);
  for (const k of s.leftAt.keys()) if (!s.answers.has(k)) s.leftAt.delete(k);
  return true;
}

/** Patch every answer in `scope` now, every mounted read of it, and any read still out. */
export function writeThrough(scope: object, patch: Patch, now = Date.now()) {
  const s = scopeOf(scope);
  s.log.push({ at: tick(), when: now, patch });
  while (s.log.length > PATCH_MAX || (s.log[0] && now - s.log[0].when > PATCH_MS)) s.log.shift();
  for (const [k, v] of s.answers) {
    const next = patch(k, v);
    if (next !== v) s.answers.set(k, next);
  }
  for (const f of [...s.seen]) f(patch);
}

/** `data` from a read of `key` that left at tick `left`, with every patch made since applied. */
export function patchedSince(scope: object, key: string, data: unknown, left: number): unknown {
  let out = data;
  for (const p of scopeOf(scope).log) if (p.at > left) out = p.patch(key, out);
  return out;
}

/** Told each patch to `scope`, until the returned function is called. */
export function onWrite(scope: object, fn: (patch: Patch) => void): () => void {
  const s = scopeOf(scope);
  s.seen.add(fn);
  return () => void s.seen.delete(fn);
}
