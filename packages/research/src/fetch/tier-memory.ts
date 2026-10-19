/**
 * The fetch ladder's memory (designs/2026-10-18-fetch-ladder.md): per domain, the lowest
 * rung that worked, so the next fetch starts there and does not climb again. It lives on
 * main only: a domain is the same fact for every client.
 */
import type { Queryable } from "@wren/db";
import { eq } from "drizzle-orm";
import { fetchTiers } from "../schema.js";

/** The rungs, lowest first. `plain` is wren's own fetch; the rest run in autobrowse. */
export const LADDER_TIERS = ["plain", "impersonate", "render", "exit"] as const;
export type LadderTier = (typeof LADDER_TIERS)[number];

/** A remembered row older than this is ignored: the next fetch starts at `plain` again. */
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
  /** The rung to start at for a domain, or null: start at `plain`. */
  startFor(domain: string): Promise<LadderTier | null>;
  /** A fetch got its page at `tier`; `block` is the signal that made it climb. */
  learn(domain: string, tier: LadderTier, block: string | null): Promise<void>;
}

export interface TierRow {
  tier: string;
  learnedAt: Date;
}

const isStale = (row: TierRow, now: Date): boolean =>
  now.getTime() - row.learnedAt.getTime() >= FETCH_TIER_DAYS * DAY_MS;

/**
 * What to do with a domain's row after a page came at `tier`.
 * - `plain` over a stale row: delete it. `plain` over a fresh row or none: leave it.
 * - A higher rung than the row, or any rung over a stale row or none: write it.
 * - The same or a lower rung over a fresh row: leave it. `learnedAt` never moves on a repeat,
 *   or a domain we fetch often would never go stale.
 */
export function learning(
  row: TierRow | null,
  tier: LadderTier,
  now: Date,
): "write" | "delete" | "keep" {
  const stale = row !== null && isStale(row, now);
  if (tier === "plain") return stale ? "delete" : "keep";
  if (row === null || stale) return "write";
  const known = LADDER_TIERS.indexOf(row.tier as LadderTier);
  return LADDER_TIERS.indexOf(tier) > known ? "write" : "keep";
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
    async startFor(domain) {
      const row = await rowOf(domain);
      if (!row || isStale(row, now())) return null;
      const tier = LADDER_TIERS.find((t) => t === row.tier);
      return tier && tier !== "plain" ? tier : null;
    },
    async learn(domain, tier, block) {
      const at = now();
      const act = learning(await rowOf(domain), tier, at);
      if (act === "delete") await db.delete(fetchTiers).where(eq(fetchTiers.domain, domain));
      if (act !== "write") return;
      await db
        .insert(fetchTiers)
        .values({ domain, tier, block, learnedAt: at })
        .onConflictDoUpdate({
          target: fetchTiers.domain,
          set: { tier, block, learnedAt: at },
        });
    },
  };
}
