/**
 * LinkedIn research reads, search first (designs/2026-10-07-linkedin-search-first.md). Exa and
 * Google answer what they can. The account (William's main) reads only when search came back
 * empty or thin, and only while it has room: 20 reads a day across every kind (vendor
 * `linkedin`; autobrowse holds the account to the same `total`). Each read is metered by the
 * source that served it, so the Vendors page shows search and account apart.
 */
import { gate, meter } from "@wren/core/vendors";
import type { Db, Queryable } from "@wren/db";

/** Reads the account made. */
export const ACCOUNT_VENDOR = "linkedin";
/** Reads Exa or Google served: the account never saw them. */
export const SEARCH_VENDOR = "linkedin_search";

export type ReadSource = "search" | "account";

export const vendorOfSource = (s: ReadSource): string =>
  s === "account" ? ACCOUNT_VENDOR : SEARCH_VENDOR;

/** Where a part's LinkedIn reads ask for room and say who served them. */
export interface ReadLedger {
  /** Account reads still allowed now; 0 = search only. */
  room(): Promise<number>;
  /** One read served: by search, or by `units` account calls. A failed meter is logged. */
  served(source: ReadSource, units?: number): Promise<void>;
}

/** Account reads `client` (null: Wren) may still make now: the `linkedin` vendor's room. */
export async function accountRoom(
  main: Queryable,
  client: string | null,
  now: Date = new Date(),
): Promise<number> {
  const g = await gate(main, client, ACCOUNT_VENDOR, 1, now);
  return g.ok ? (g.room ?? Number.POSITIVE_INFINITY) : 0;
}

/** The ledger on main's vendor rows, for one part (`profiles`) of one owner. */
export function readLedger(
  main: Db,
  o: { client: string | null; part: string; runId?: string | null },
): ReadLedger {
  return {
    room: () => accountRoom(main, o.client),
    async served(source, units = 1) {
      if (units <= 0) return;
      await meter(main, {
        client: o.client,
        vendor: vendorOfSource(source),
        units,
        part: o.part,
        runId: o.runId ?? null,
      }).catch((err: unknown) => {
        console.error(`meter ${o.part} ${source}:`, err instanceof Error ? err.message : err);
      });
    },
  };
}

/** A post's URL as LinkedIn writes it: `/posts/{vanity}_{slug}-activity-{id}-{tail}`. */
const POST_URL = /linkedin\.com\/posts\/([^/?#]+?)_[^/?#]*?-(activity|ugcPost|share)-(\d{15,22})/i;

/** The author's vanity and the post's urn, from its URL; null for anything else. */
export function postOfUrl(url: string): { vanity: string; urn: string; id: string } | null {
  const m = POST_URL.exec(url);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  let vanity = m[1];
  try {
    vanity = decodeURIComponent(vanity);
  } catch {
    // A stray % stays as written.
  }
  return { vanity: vanity.toLowerCase(), urn: `urn:li:${m[2]}:${m[3]}`, id: m[3] };
}

const DAY_MS = 86_400_000;
/** No LinkedIn post id is older than this. */
const EARLIEST = Date.UTC(2010, 0, 1);

/**
 * When LinkedIn made the post: an activity id's top 41 bits are epoch milliseconds. Null when
 * the id reads as a time before 2010 or after `now`.
 */
export function idTime(id: string, now: Date): Date | null {
  let ms: number;
  try {
    ms = Number(BigInt(id) >> 22n);
  } catch {
    return null;
  }
  return ms >= EARLIEST && ms <= now.getTime() + DAY_MS ? new Date(ms) : null;
}
