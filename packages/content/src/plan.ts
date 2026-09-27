/**
 * Tomorrow's content plan: each platform's slots against the drafts that
 * hold them, and what is waiting upstream (drafts to review, ideas to draft).
 * The shortfall is the ask: "LinkedIn 1 of 2, 3 drafts wait for you".
 * Read-only; the planner loop sends it once a day.
 */
import type { Platform } from "@wren/core/content";
import { wallClock, zonedInstant } from "@wren/core/time";
import type { Queryable } from "@wren/db";
import { and, count, eq, gte, inArray, lt } from "drizzle-orm";
import { contentDrafts, contentIdeas } from "./schema.js";
import { DEFAULT_SLOTS, type Slots, slotInstants } from "./slots.js";

export interface PlatformPlan {
  platform: Platform;
  slots: number;
  /** Approved or publishing drafts scheduled inside the day. */
  filled: number;
  /** Drafts written and waiting for review. */
  waiting: number;
}

export interface DayPlan {
  /** The day on `zone`'s clock, YYYY-MM-DD. */
  day: string;
  platforms: PlatformPlan[];
  openIdeas: number;
}

/** The calendar day after `now` on `zone`'s clock, as [start, end) instants and its label. */
export function tomorrowOf(now: Date, zone: string): { day: string; from: Date; to: Date } {
  const w = wallClock(zone, now);
  const next = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));
  const after = new Date(Date.UTC(w.year, w.month - 1, w.day + 2));
  const at = (d: Date) =>
    zonedInstant(zone, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return { day: next.toISOString().slice(0, 10), from: at(next), to: at(after) };
}

export async function planFor(
  db: Queryable,
  platforms: readonly Platform[],
  day: { day: string; from: Date; to: Date },
  zone: string,
  slots: Slots = DEFAULT_SLOTS,
): Promise<DayPlan> {
  const out: PlatformPlan[] = [];
  for (const platform of platforms) {
    const inDay = slotInstants(platform, day.from, zone, 1, slots).length;
    const [filled] = await db
      .select({ n: count() })
      .from(contentDrafts)
      .where(
        and(
          eq(contentDrafts.platform, platform),
          inArray(contentDrafts.status, ["approved", "publishing", "published"]),
          gte(contentDrafts.scheduledFor, day.from),
          lt(contentDrafts.scheduledFor, day.to),
        ),
      );
    const [waiting] = await db
      .select({ n: count() })
      .from(contentDrafts)
      .where(and(eq(contentDrafts.platform, platform), eq(contentDrafts.status, "draft")));
    out.push({ platform, slots: inDay, filled: filled?.n ?? 0, waiting: waiting?.n ?? 0 });
  }
  const [ideas] = await db
    .select({ n: count() })
    .from(contentIdeas)
    .where(eq(contentIdeas.status, "open"));
  return { day: day.day, platforms: out, openIdeas: ideas?.n ?? 0 };
}

/** Empty slots across the plan. */
export const shortfallOf = (p: DayPlan): number =>
  p.platforms.reduce((n, x) => n + Math.max(x.slots - x.filled, 0), 0);

export function formatPlan(p: DayPlan): string[] {
  return [
    ...p.platforms.map(
      (x) =>
        `${x.platform}: ${x.filled} of ${x.slots} slots filled${x.waiting > 0 ? `, ${x.waiting} drafts wait for review` : ""}`,
    ),
    `${p.openIdeas} ideas not drafted yet`,
  ];
}
