/**
 * A post's titles, thumbnails and hooks over time (designs/2026-10-07-content-analytics.md, item
 * "Hook, title and thumbnail variants"). The one it went out with is kept at publish; a swap is
 * asked for (`proposed`), waits in To approve, and on his yes goes to the platform, then becomes
 * `live` and ends the one before. YouTube's own Test and compare has no API, so a test is a swap
 * over time: each variant's window reads the post's days (views, the reach report's impressions
 * and CTR). The swap's own day counts for neither window.
 */
import { hookOf, type Platform, type PostPatch } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { contentDrafts, type PostVariant, postVariants, type VariantField } from "../schema.js";

const DAY = 86_400_000;
/** YouTube's title cap; a hook is the description's first line. */
export const TITLE_MAX = 100;
export const HOOK_MAX = 300;
/** Where a swap reaches the live post. Elsewhere a post can't be changed once it's up. */
export const SWAPS: Partial<Record<Platform, readonly VariantField[]>> = {
  youtube: ["title", "thumbnail", "hook"],
};

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * The variants a post went out with: its title (when it has one), its thumbnail (a YouTube long
 * video's, unless the platform refused it) and its hook. A step that runs again keeps one.
 */
export async function keepFirstVariants(
  db: Queryable,
  d: {
    id: string;
    platform: Platform;
    title: string | null;
    text: string;
    extra: Record<string, unknown> | null;
  },
  at: Date,
  refused: readonly string[] = [],
): Promise<number> {
  const thumb =
    d.platform === "youtube" &&
    d.extra?.kind !== "short" &&
    typeof d.extra?.thumbnail === "string" &&
    !refused.some((n) => n.startsWith("Thumbnail"))
      ? d.extra.thumbnail
      : null;
  const hook = hookOf(d.text).slice(0, HOOK_MAX);
  const rows = (
    [
      ["title", d.title?.trim() || null],
      ["thumbnail", thumb],
      ["hook", hook || null],
    ] as const
  ).flatMap(([field, value]) =>
    value
      ? [
          {
            draftId: d.id,
            field,
            value,
            state: "live" as const,
            source: "publish" as const,
            askedBy: "scheduler",
            askedAt: at,
            startedAt: at,
          },
        ]
      : [],
  );
  if (!rows.length) return 0;
  const kept = await db
    .insert(postVariants)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: postVariants.id });
  return kept.length;
}

export class SwapRefusal extends Error {}

/**
 * A swap asked for on a published post: `proposed`, waiting in To approve. An earlier swap of the
 * same field still waiting is replaced (rejected) so one waits at a time.
 */
export async function askSwap(
  db: Queryable,
  a: { draftId: string; field: VariantField; value: string; why?: string | null; by: string },
  now: Date,
): Promise<PostVariant> {
  const [d] = await db
    .select({
      platform: contentDrafts.platform,
      status: contentDrafts.status,
      extra: contentDrafts.extra,
    })
    .from(contentDrafts)
    .where(eq(contentDrafts.id, a.draftId));
  if (!d) throw new SwapRefusal(`no draft ${a.draftId}`);
  if (d.status !== "published") throw new SwapRefusal("only a published post can swap");
  if (!SWAPS[d.platform]?.includes(a.field))
    throw new SwapRefusal(`a ${d.platform} post can't change its ${a.field} once it's up`);
  if (a.field === "thumbnail" && d.extra?.kind === "short")
    throw new SwapRefusal("YouTube's API can't set a Short's thumbnail");
  const value = a.value.trim();
  if (!value) throw new SwapRefusal(`the new ${a.field} is empty`);
  if (a.field === "title" && value.length > TITLE_MAX)
    throw new SwapRefusal(`a title is ${TITLE_MAX} characters at most`);
  if (a.field === "hook" && (value.length > HOOK_MAX || value.includes("\n")))
    throw new SwapRefusal(`a hook is one line of ${HOOK_MAX} characters at most`);
  const [live] = await db
    .select({ value: postVariants.value })
    .from(postVariants)
    .where(
      and(
        eq(postVariants.draftId, a.draftId),
        eq(postVariants.field, a.field),
        eq(postVariants.state, "live"),
      ),
    );
  if (live?.value === value) throw new SwapRefusal(`that ${a.field} is the live one`);
  await db
    .update(postVariants)
    .set({
      state: "rejected",
      decidedBy: a.by,
      endedAt: now,
      why: sql`coalesce(${postVariants.why}, 'replaced by a newer ask')`,
    })
    .where(
      and(
        eq(postVariants.draftId, a.draftId),
        eq(postVariants.field, a.field),
        eq(postVariants.state, "proposed"),
      ),
    );
  const [row] = await db
    .insert(postVariants)
    .values({
      draftId: a.draftId,
      field: a.field,
      value,
      state: "proposed",
      source: "swap",
      why: a.why?.trim() || null,
      askedBy: a.by,
      askedAt: now,
    })
    .returning();
  return row as PostVariant;
}

/** What his yes sends: the swap, its post's platform id and the change. */
export interface SwapPlan {
  variant: PostVariant;
  platform: Platform;
  publishedId: string;
  patch: PostPatch;
}

/** A waiting swap and what the platform must be sent; refuses one not waiting. */
export async function planSwap(db: Queryable, id: number): Promise<SwapPlan> {
  const [v] = await db.select().from(postVariants).where(eq(postVariants.id, id));
  if (!v) throw new SwapRefusal(`no swap ${id}`);
  if (v.state !== "proposed") throw new SwapRefusal(`that swap is ${v.state}`);
  const [d] = await db
    .select({ platform: contentDrafts.platform, publishedId: contentDrafts.publishedId })
    .from(contentDrafts)
    .where(eq(contentDrafts.id, v.draftId));
  if (!d?.publishedId) throw new SwapRefusal("the post isn't up");
  return {
    variant: v,
    platform: d.platform,
    publishedId: d.publishedId,
    patch: { [v.field]: v.value },
  };
}

/** The platform took it: this one is live from `now`, the one before ends then. */
export async function startSwap(db: Queryable, id: number, by: string, now: Date): Promise<void> {
  const [v] = await db.select().from(postVariants).where(eq(postVariants.id, id));
  if (v?.state !== "proposed") return;
  await db
    .update(postVariants)
    .set({ state: "ended", endedAt: now })
    .where(
      and(
        eq(postVariants.draftId, v.draftId),
        eq(postVariants.field, v.field),
        eq(postVariants.state, "live"),
      ),
    );
  await db
    .update(postVariants)
    .set({ state: "live", startedAt: now, decidedBy: by })
    .where(eq(postVariants.id, id));
}

/** His no: the swap never goes out. Returns the ids turned down. */
export async function skipSwaps(
  db: Queryable,
  ids: readonly number[],
  by: string,
  now: Date,
): Promise<number[]> {
  const out: number[] = [];
  for (const id of ids) {
    const [r] = await db
      .update(postVariants)
      .set({ state: "rejected", decidedBy: by, endedAt: now })
      .where(and(eq(postVariants.id, id), eq(postVariants.state, "proposed")))
      .returning({ id: postVariants.id });
    if (r) out.push(r.id);
  }
  return out;
}

/** One variant's window and what the post earned in it. */
export interface VariantWindow {
  id: number;
  field: VariantField;
  value: string;
  state: PostVariant["state"];
  source: PostVariant["source"];
  started: string | null;
  ended: string | null;
  /** The days counted: the swap's own day is left out of both windows. */
  from: string | null;
  to: string | null;
  days: number;
  views: number | null;
  viewsPerDay: number | null;
  impressions: number | null;
  /** Percent, weighted by each day's impressions. */
  ctr: number | null;
}

/** A day series' value on `day` or the nearest day before it; null when none. */
function valueOn(
  series: ReadonlyArray<{ day: string; value: number }>,
  day: string,
): number | null {
  let v: number | null = null;
  for (const s of series) {
    if (s.day > day) break;
    v = s.value;
  }
  return v;
}

/**
 * Each of a post's variants with its window's numbers, oldest first, per field. A window runs
 * from its start (the day after a swap) to the day before the next swap, or to `today`. Views
 * gained come from the day totals; impressions and CTR from the reach report's own days.
 */
export async function variantWindows(
  db: Queryable,
  draftId: string,
  today: Date,
): Promise<VariantWindow[]> {
  const variants = await db
    .select()
    .from(postVariants)
    .where(eq(postVariants.draftId, draftId))
    .orderBy(asc(postVariants.field), asc(postVariants.askedAt), asc(postVariants.id));
  if (!variants.length) return [];
  const days = (await db.execute(sql`
    select day::text as day, metric, value from post_metric_days
    where draft_id = ${draftId} and key = '' and metric in ('views', 'impressions_day', 'ctr_day')
    order by day`)) as unknown as Array<{ day: string; metric: string; value: number }>;
  const views = days.filter((d) => d.metric === "views").map((d) => ({ ...d, value: +d.value }));
  const byDay = new Map<string, { impressions?: number; ctr?: number }>();
  for (const d of days) {
    if (d.metric === "views") continue;
    const r = byDay.get(d.day) ?? {};
    if (d.metric === "impressions_day") r.impressions = +d.value;
    else r.ctr = +d.value;
    byDay.set(d.day, r);
  }
  const last = dayOf(today);
  return variants.map((v) => {
    const base = {
      id: v.id,
      field: v.field,
      value: v.value,
      state: v.state,
      source: v.source,
      started: v.startedAt?.toISOString() ?? null,
      ended: v.state === "rejected" ? null : (v.endedAt?.toISOString() ?? null),
    };
    const none = { from: null, to: null, days: 0, views: null, viewsPerDay: null };
    if (!v.startedAt || v.state === "rejected" || v.state === "proposed")
      return { ...base, ...none, impressions: null, ctr: null };
    const from = v.source === "swap" ? plusDays(dayOf(v.startedAt), 1) : dayOf(v.startedAt);
    const to = v.endedAt ? plusDays(dayOf(v.endedAt), -1) : last;
    if (to < from) return { ...base, ...none, impressions: null, ctr: null };
    const n = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
    const end = valueOn(views, to);
    const start = v.source === "publish" ? 0 : valueOn(views, plusDays(from, -1));
    const gained = end !== null && start !== null ? Math.max(0, end - start) : null;
    let impressions = 0;
    let weighted = 0;
    let any = false;
    for (const [day, r] of byDay) {
      if (day < from || day > to || r.impressions === undefined) continue;
      any = true;
      impressions += r.impressions;
      weighted += r.impressions * (r.ctr ?? 0);
    }
    return {
      ...base,
      from,
      to,
      days: n,
      views: gained,
      viewsPerDay: gained === null ? null : Math.round((gained / n) * 10) / 10,
      impressions: any ? impressions : null,
      ctr: any && impressions > 0 ? Math.round((weighted / impressions) * 100) / 100 : null,
    };
  });
}

/** A swap waiting on his yes, as To approve lists it. */
export interface WaitingSwap {
  id: number;
  draftId: string;
  platform: Platform;
  title: string | null;
  field: VariantField;
  value: string;
  /** What is live now, which the yes replaces. */
  live: string | null;
  why: string | null;
  by: string;
  at: Date;
  url: string | null;
}

/** Every swap still waiting, newest first. */
export async function waitingSwaps(db: Queryable): Promise<WaitingSwap[]> {
  const rows = (await db.execute(sql`
    select v.id, v.draft_id::text draft_id, d.platform, d.title, v.field, v.value, v.why,
      v.asked_by, v.asked_at, d.url,
      (select l.value from post_variants l where l.draft_id = v.draft_id and l.field = v.field
        and l.state = 'live') live
    from post_variants v join content_drafts d on d.id = v.draft_id
    where v.state = 'proposed' order by v.asked_at desc, v.id desc`)) as unknown as Array<{
    id: number;
    draft_id: string;
    platform: Platform;
    title: string | null;
    field: VariantField;
    value: string;
    why: string | null;
    asked_by: string;
    asked_at: Date | string;
    url: string | null;
    live: string | null;
  }>;
  return rows.map((r) => ({
    id: Number(r.id),
    draftId: r.draft_id,
    platform: r.platform,
    title: r.title,
    field: r.field,
    value: r.value,
    live: r.live,
    why: r.why,
    by: r.asked_by,
    at: new Date(r.asked_at),
    url: r.url,
  }));
}
