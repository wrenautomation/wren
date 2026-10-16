/**
 * Change-only list reads (designs/2026-10-15-one-write-path.md, "The data layer"). A tab that
 * holds a list sends the hash of each row it has (`known`); the answer carries in full only the
 * rows that changed, and a stub for the rest, which the tab fills from what it holds. Records
 * are views over many tables with no shared change column, so a row's hash is its change mark.
 * A list whose rows carry a row version (Notes' cards) marks each by it instead (`markOf`).
 * Pure: the server (`serveRecords`) and the browser (`@wren/ui`) both use it.
 */
import type { Row } from "./records-serve.js";

/** A row of any list: it has an id. */
type Keyed = { id: string | number };
/** A list answer as change-only reads see it: its rows, their marks, and the stubbed ones. */
export interface Marked<R extends Keyed = Row> {
  rows: R[];
  hashes?: string[];
  same?: number[];
}

/** The most row hashes one read may send. */
export const KNOWN_MAX = 500;
const HASH = /^[0-9a-z]{6,32}$/;

/** cyrb53: a fast 53-bit string hash. */
function cyrb53(s: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** A JSON text with keys in order. */
function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(",")}}`;
}

/** A row's change mark: two seeds, about 106 bits. */
export function rowHash(row: object): string {
  const s = stable(row);
  return cyrb53(s, 1).toString(36) + cyrb53(s, 2).toString(36);
}

/**
 * The change mark of a row that carries a row version: the version (bumped on every write of the
 * row) plus a hash of its id and `derived`, what the row shows from other rows (counts, chips).
 * Its own text is never hashed. The id keeps two rows at the same version apart: a list holds
 * marks, not ids, so a changed row must never take another row's mark.
 */
export const versionMark = (id: string | number, version: number, derived: object = {}): string =>
  `v${version.toString(36)}${rowHash({ id, d: derived }).slice(0, 12)}`;

/** What a list read says it holds, checked: hashes only, at most `KNOWN_MAX`. */
export function knownIn(known: unknown): Set<string> | null {
  if (known === undefined) return null;
  if (!Array.isArray(known) || known.length > KNOWN_MAX) return null;
  const out = new Set<string>();
  for (const h of known) if (typeof h === "string" && HASH.test(h)) out.add(h);
  return out;
}

/**
 * The answer of a list read: each row's mark (`markOf`, its hash unless it has a version), and
 * only the rows the reader lacks in full.
 */
export function changedOnly<R extends Keyed, P extends Marked<R>>(
  page: P,
  known: Set<string> | null,
  markOf: (row: R) => string = rowHash,
): P & { hashes: string[] } {
  const hashes = page.rows.map(markOf);
  if (!known?.size) return { ...page, hashes };
  const same: number[] = [];
  const rows = page.rows.map((r, i) => {
    if (!known.has(hashes[i] as string)) return r;
    same.push(i);
    return { id: r.id } as R;
  });
  return { ...page, rows, hashes, ...(same.length ? { same } : {}) };
}

/** The hashes of the rows `before` holds, to send with the next read of the same list. */
export function knownOf(before: Marked<Keyed> | undefined): string[] {
  return (before?.hashes ?? []).slice(0, KNOWN_MAX);
}

/**
 * A change-only answer made whole from what the tab held: each stub's row by its hash. Null
 * when a stub names a row the tab no longer has: read it again in full.
 */
export function mergeChanged<R extends Keyed, P extends Marked<R>>(
  page: P,
  before: Marked<R> | undefined,
): P | null {
  if (!page.same?.length) {
    const { same: _, ...whole } = page;
    return whole as P;
  }
  const held = new Map<string, R>();
  before?.rows.forEach((r, i) => {
    const h = before.hashes?.[i];
    if (h) held.set(h, r);
  });
  const rows = [...page.rows];
  for (const i of page.same) {
    const h = page.hashes?.[i];
    const row = h ? held.get(h) : undefined;
    if (!row) return null;
    rows[i] = row;
  }
  const { same: _, ...rest } = page;
  return { ...rest, rows } as P;
}
