/**
 * Tomorrow's content plan: each platform's slots against the drafts that
 * hold them, and what is waiting upstream (drafts to review, ideas to draft).
 * The shortfall is the ask: "LinkedIn 1 of 2, 3 drafts wait for you".
 * The planner loop sends it once a day and, when told to, fills the open slots from `nextIdea`.
 */
import type { Platform } from "@wren/core/content";
import { wallClock, zonedInstant } from "@wren/core/time";
import type { Queryable } from "@wren/db";
import { and, asc, count, eq, gte, inArray, lt, notInArray } from "drizzle-orm";
import { buildLogIdea, type Fetch } from "./ideas/build-log.js";
import { questionIdea } from "./ideas/questions.js";
import { type ContentIdea, contentDrafts, contentIdeas } from "./schema.js";
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

/** Slots neither an approved post nor a waiting draft can fill. */
export const shortfallOf = (p: DayPlan): number =>
  p.platforms.reduce((n, x) => n + Math.max(x.slots - x.filled - x.waiting, 0), 0);

/** Slot instants no draft holds yet, capped so a draft scheduled off-slot (`--at`) still counts as one. */
export function freeSlots(instants: readonly Date[], taken: readonly Date[]): Date[] {
  const held = new Set(taken.map((t) => t.getTime()));
  return instants
    .filter((at) => !held.has(at.getTime()))
    .slice(0, Math.max(instants.length - taken.length, 0));
}

/** Per platform, the day's slots a draft (waiting, approved or out) does not hold yet. */
export async function openSlots(
  db: Queryable,
  platforms: readonly Platform[],
  day: { from: Date; to: Date },
  zone: string,
  slots: Slots = DEFAULT_SLOTS,
): Promise<Partial<Record<Platform, Date[]>>> {
  const out: Partial<Record<Platform, Date[]>> = {};
  for (const platform of platforms) {
    const rows = await db
      .select({ at: contentDrafts.scheduledFor })
      .from(contentDrafts)
      .where(
        and(
          eq(contentDrafts.platform, platform),
          inArray(contentDrafts.status, ["draft", "approved", "publishing", "published"]),
          gte(contentDrafts.scheduledFor, day.from),
          lt(contentDrafts.scheduledFor, day.to),
        ),
      );
    out[platform] = freeSlots(
      slotInstants(platform, day.from, zone, 1, slots),
      rows.flatMap((r) => (r.at ? [r.at] : [])),
    );
  }
  return out;
}

export interface NextIdea {
  idea: Pick<ContentIdea, "id" | "source" | "text"> | null;
  /** Repos the build log could not read. */
  errors: string[];
}

/**
 * The next idea to draft, in order: the oldest undrafted idea, then today's build log, then a
 * reader's question. `exclude` holds ideas already tried this pass, so one that fails to draft
 * is not picked again.
 */
export async function nextIdea(
  db: Queryable,
  o: {
    now: Date;
    day: string;
    exclude?: readonly string[];
    repos?: readonly string[];
    fetch?: Fetch;
  },
): Promise<NextIdea> {
  const pick = ({ id, source, text }: ContentIdea) => ({ id, source, text });
  const exclude = o.exclude ?? [];
  const [open] = await db
    .select()
    .from(contentIdeas)
    .where(
      and(
        eq(contentIdeas.status, "open"),
        exclude.length > 0 ? notInArray(contentIdeas.id, [...exclude]) : undefined,
      ),
    )
    .orderBy(asc(contentIdeas.createdAt))
    .limit(1);
  if (open) return { idea: pick(open), errors: [] };
  const log = await buildLogIdea(db, o.now, o.day, {
    ...(o.repos ? { repos: o.repos } : {}),
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });
  if (log.idea) return { idea: pick(log.idea), errors: log.errors };
  const q = await questionIdea(db, o.now);
  return { idea: q ? pick(q) : null, errors: log.errors };
}

export function formatPlan(p: DayPlan): string[] {
  return [
    ...p.platforms.map(
      (x) =>
        `${x.platform}: ${x.filled} of ${x.slots} slots filled${x.waiting > 0 ? `, ${x.waiting} drafts wait for review` : ""}`,
    ),
    `${p.openIdeas} ideas not drafted yet`,
  ];
}
