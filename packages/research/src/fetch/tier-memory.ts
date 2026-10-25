/**
 * The fetch ladder's memory (designs/2026-10-18-fetch-ladder.md): per domain, what the render
 * pass learned, so the crawl skips a domain it cannot fetch plain and the pass does not try a
 * dead one again. It lives on main only: a domain is the same fact for every client.
 */
import type { Queryable } from "@wren/db";
import { eq } from "drizzle-orm";
import { fetchTiers } from "../schema.js";

/** autobrowse's rungs (`web GET /fetch`), lowest first. wren's own plain fetch is not one. */
export const LADDER_TIERS = ["impersonate", "render", "exit"] as const;
export type LadderTier = (typeof LADDER_TIERS)[number];

/** What a domain needs: a rung, wren's own box browser, or nothing works (`dead`). */
const MEMORY_TIERS = ["browser", ...LADDER_TIERS, "dead"] as const;
export type MemoryTier = (typeof MEMORY_TIERS)[number];

export const isLadderTier = (tier: string | null | undefined): tier is LadderTier =>
  LADDER_TIERS.some((t) => t === tier);

/** A remembered row older than this is ignored. */
export const FETCH_TIER_DAYS = 30;
const DAY_MS = 86_400_000;

/** The domain a URL's memory is kept under: lowercase hostname, no leading `www.`. Null: not a URL. */
export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export interface TierMemory {
  /** What a domain needs, or null: nothing known, or the row is stale. */
  get(domain: string): Promise<MemoryTier | null>;
  /** The domains that are `dead` and not stale. */
  dead(): Promise<string[]>;
  /** A fetch ended at `tier`; `block` is the signal that sent the domain to the render pass. */
  learn(domain: string, tier: MemoryTier, block: string | null): Promise<void>;
}

interface TierRow {
  tier: string;
  learnedAt: Date;
}

const isStale = (row: TierRow, now: Date): boolean =>
  now.getTime() - row.learnedAt.getTime() >= FETCH_TIER_DAYS * DAY_MS;

/**
 * Write when the domain has no fresh row or the tier changes. `learnedAt` never moves on a
 * repeat, or a domain we meet often would never go stale.
 */
export function shouldWrite(row: TierRow | null, tier: MemoryTier, now: Date): boolean {
  return row === null || isStale(row, now) || row.tier !== tier;
}

/** The memory over a database (main's). */
export function tierMemory(db: Queryable, now: () => Date = () => new Date()): TierMemory {
  const rowOf = async (domain: string): Promise<TierRow | null> => {
    const [row] = await db
      .select({ tier: fetchTiers.tier, learnedAt: fetchTiers.learnedAt })
      .from(fetchTiers)
      .where(eq(fetchTiers.domain, domain));
    return row ?? null;
  };
  return {
    async get(domain) {
      const row = await rowOf(domain);
      if (!row || isStale(row, now())) return null;
      return MEMORY_TIERS.find((t) => t === row.tier) ?? null;
    },
    async dead() {
      const rows = await db
        .select({ domain: fetchTiers.domain, learnedAt: fetchTiers.learnedAt })
        .from(fetchTiers)
        .where(eq(fetchTiers.tier, "dead"));
      const at = now();
      return rows
        .filter((r) => !isStale({ tier: "dead", learnedAt: r.learnedAt }, at))
        .map((r) => r.domain);
    },
    async learn(domain, tier, block) {
      const at = now();
      if (!shouldWrite(await rowOf(domain), tier, at)) return;
      await db
        .insert(fetchTiers)
        .values({ domain, tier, block, learnedAt: at })
        .onConflictDoUpdate({ target: fetchTiers.domain, set: { tier, block, learnedAt: at } });
    },
  };
}
