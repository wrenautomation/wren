/**
 * Tomorrow's content plan: each platform's slots against the drafts that
 * hold them, and what is waiting upstream (drafts to review, ideas to draft).
 * The shortfall is the ask: "LinkedIn 1 of 2, 3 drafts wait for you".
 * The planner loop sends it once a day and, when told to, fills the open slots from `nextIdea`.
 */
import type { Platform } from "@wren/core/content";
import { wallClock, zonedInstant } from "@wren/core/time";
import type { Queryable } from "@wren/db";
import { and, asc, count, eq, gte, inArray, isNull, lt, notInArray } from "drizzle-orm";
import { chapterIdea } from "./ideas/chapters.js";
import { questionIdea } from "./ideas/questions.js";
import { type ContentIdea, contentDrafts, contentIdeas } from "./schema.js";
import { DEFAULT_SLOTS, type Slots, slotInstants } from "./slots.js";

interface PlatformPlan {
  platform: Platform;
  slots: number;
  /** Approved or publishing drafts scheduled inside the day. */
  filled: number;
  /** Drafts waiting for review that hold a slot inside the day; older ones wait in To approve and don't count. */
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
      .where(
        and(
          eq(contentDrafts.platform, platform),
          eq(contentDrafts.status, "draft"),
          gte(contentDrafts.scheduledFor, day.from),
          lt(contentDrafts.scheduledFor, day.to),
        ),
      );
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

/** The statuses that hold a slot: a waiting draft, an approved one, one out. */
const HOLDING = ["draft", "approved", "publishing", "published"] as const;

/** Per campaign, per platform, the day's slots its drafts hold (through their idea). */
export async function campaignSlots(
  db: Queryable,
  day: { from: Date; to: Date },
): Promise<Record<string, Partial<Record<Platform, number>>>> {
  const rows = await db
    .select({ campaign: contentIdeas.campaign, platform: contentDrafts.platform, n: count() })
    .from(contentDrafts)
    .innerJoin(contentIdeas, eq(contentIdeas.id, contentDrafts.ideaId))
    .where(
      and(
        inArray(contentDrafts.status, [...HOLDING]),
        gte(contentDrafts.scheduledFor, day.from),
        lt(contentDrafts.scheduledFor, day.to),
      ),
    )
    .groupBy(contentIdeas.campaign, contentDrafts.platform);
  const out: Record<string, Partial<Record<Platform, number>>> = {};
  for (const r of rows) if (r.campaign) out[r.campaign] = { ...out[r.campaign], [r.platform]: r.n };
  return out;
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
          inArray(contentDrafts.status, [...HOLDING]),
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

interface NextIdea {
  idea: Pick<ContentIdea, "id" | "source" | "text"> | null;
}

/**
 * The next idea to draft, in order: the oldest undrafted idea, then a reader's question, then a
 * chapter of a video that is up (Wren only). No build log: commit-by-commit updates gave readers
 * little (William, 2026-10-14). `exclude` holds ideas already tried this pass, so one that fails
 * to draft is not picked again. A campaign takes only its own open ideas; the default (no
 * campaign) takes the untagged ones, then questions and chapters.
 */
export async function nextIdea(
  db: Queryable,
  o: {
    now: Date;
    exclude?: readonly string[];
    /** A client's planner: chapters are of Wren's own videos, so it skips them. */
    client?: boolean;
    /** A metro campaign id; unset = the default. */
    campaign?: string | null;
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
        o.campaign ? eq(contentIdeas.campaign, o.campaign) : isNull(contentIdeas.campaign),
        exclude.length > 0 ? notInArray(contentIdeas.id, [...exclude]) : undefined,
      ),
    )
    .orderBy(asc(contentIdeas.createdAt))
    .limit(1);
  if (open) return { idea: pick(open) };
  if (o.campaign) return { idea: null };
  const q = (await questionIdea(db, o.now)) ?? (o.client ? null : await chapterIdea(db));
  return { idea: q ? pick(q) : null };
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
