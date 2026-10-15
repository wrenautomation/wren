/**
 * Change-only list reads (designs/2026-10-15-one-write-path.md, "The data layer"). A tab that
 * holds a list sends the hash of each row it has (`known`); the answer carries in full only the
 * rows that changed, and a stub for the rest, which the tab fills from what it holds. Records
 * are views over many tables with no shared change column, so a row's hash is its change mark.
 * Pure: the server (`serveRecords`) and the browser (`@wren/ui`) both use it.
 */
import type { RecordsPage, Row } from "./records-serve.js";

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
export function rowHash(row: Row): string {
  const s = stable(row);
  return cyrb53(s, 1).toString(36) + cyrb53(s, 2).toString(36);
}

/** What a list read says it holds, checked: hashes only, at most `KNOWN_MAX`. */
export function knownIn(known: unknown): Set<string> | null {
  if (known === undefined) return null;
  if (!Array.isArray(known) || known.length > KNOWN_MAX) return null;
  const out = new Set<string>();
  for (const h of known) if (typeof h === "string" && HASH.test(h)) out.add(h);
  return out;
}

/** The answer of a list read: each row's hash, and only the rows the reader lacks in full. */
export function changedOnly(page: RecordsPage, known: Set<string> | null): RecordsPage {
  const hashes = page.rows.map(rowHash);
  if (!known?.size) return { ...page, hashes };
  const same: number[] = [];
  const rows = page.rows.map((r, i) => {
    if (!known.has(hashes[i] as string)) return r;
    same.push(i);
    return { id: r.id } as Row;
  });
  return { ...page, rows, hashes, ...(same.length ? { same } : {}) };
}

/** The hashes of the rows `before` holds, to send with the next read of the same list. */
export function knownOf(before: RecordsPage | undefined): string[] {
  return (before?.hashes ?? []).slice(0, KNOWN_MAX);
}

/**
 * A change-only answer made whole from what the tab held: each stub's row by its hash. Null
 * when a stub names a row the tab no longer has: read it again in full.
 */
export function mergeChanged(
  page: RecordsPage,
  before: RecordsPage | undefined,
): RecordsPage | null {
  if (!page.same?.length) {
    const { same: _, ...whole } = page;
    return whole;
  }
  const held = new Map<string, Row>();
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
  return { ...rest, rows };
}
