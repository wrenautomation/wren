/**
 * Page splits: an A/B test at the edge. A page's address serves one of its arms per visitor, by
 * weight, and the arm sticks by a cookie that holds only the arm (no visitor id). Bots get A and
 * aren't counted. "Make B the page" copies B's live copy onto A as a new version and asks for it
 * in To approve; the yes ships the split, a no puts it back to running.
 *
 * Built on the experiments engine's beta-binomial (`split-call.ts`), not on its `flags` tables:
 * those are Wren's lander only, have no owner, and move shares by bandit.
 */
import { type Db, type Queryable, serializable, snapshot } from "@wren/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { ARM_LABELS, type ArmLabel, SPLIT_GOALS, type SplitGoal } from "./model.js";
import { type SitePage, type SiteSplit, sitePages, siteSplitArms, siteSplits } from "./schema.js";
import { type ArmCount, type SplitCall, splitCall } from "./split-call.js";
import { askPublish, pageById, SitesRefusal, saveVersion, UUID, versionOf } from "./store.js";
import type { Content } from "./templates/types.js";

/** Visitors' arm sticks this long: a month, so a returning visitor sees what they saw. */
export const SPLIT_COOKIE_DAYS = 30;
/** The cookie's value: the split's first 8 hex, a dot, the arm. */
export const SPLIT_COOKIE = /^([0-9a-f]{8})\.([A-E])$/;

export const splitCookieName = "wab";
export const splitCookieValue = (split: string, label: string) => `${split.slice(0, 8)}.${label}`;

export interface SplitArm {
  label: ArmLabel;
  page: string;
  weight: number;
  slug: string;
  title: string;
  template: string | null;
  status: string;
}
export interface SplitWithArms extends SiteSplit {
  arms: SplitArm[];
}

async function armsOf(db: Queryable, split: string): Promise<SplitArm[]> {
  const rows = await db
    .select({
      label: siteSplitArms.label,
      page: siteSplitArms.page,
      weight: siteSplitArms.weight,
      slug: sitePages.slug,
      title: sitePages.title,
      template: sitePages.template,
      status: sitePages.status,
    })
    .from(siteSplitArms)
    .innerJoin(sitePages, eq(sitePages.id, siteSplitArms.page))
    .where(eq(siteSplitArms.split, split))
    .orderBy(asc(siteSplitArms.label));
  return rows as SplitArm[];
}

/** The split running on a page (as A), or waiting to ship; null when none. */
export async function liveSplitOf(db: Queryable, page: string): Promise<SplitWithArms | null> {
  if (!UUID.test(page)) return null;
  const [s] = await db
    .select()
    .from(siteSplits)
    .where(and(eq(siteSplits.page, page), inArray(siteSplits.state, ["running", "shipping"])));
  return s ? { ...s, arms: await armsOf(db, s.id) } : null;
}

export async function splitById(db: Queryable, id: string): Promise<SplitWithArms | null> {
  if (!UUID.test(id)) return null;
  const [s] = await db.select().from(siteSplits).where(eq(siteSplits.id, id));
  return s ? { ...s, arms: await armsOf(db, s.id) } : null;
}

/** A page's splits, newest first, for its detail: the live one and the ones before. */
export async function splitsOf(db: Queryable, page: string): Promise<SplitWithArms[]> {
  if (!UUID.test(page)) return [];
  const rows = await db
    .select()
    .from(siteSplits)
    .where(eq(siteSplits.page, page))
    .orderBy(sql`${siteSplits.startedAt} desc`)
    .limit(10);
  return Promise.all(rows.map(async (s) => ({ ...s, arms: await armsOf(db, s.id) })));
}

const servable = (p: SitePage) => p.source === "data" && p.status === "live" && !!p.liveVersion;

/**
 * Even when left out; else whole numbers 1..100, one per arm. They're shares, not percents:
 * 1/1 is even, 3/1 is 75/25.
 */
function weightsOf(n: number, weights: readonly number[] | null | undefined): number[] {
  if (!weights?.length) return Array.from({ length: n }, () => 1);
  if (weights.length !== n) throw new SitesRefusal("one weight per version", 400);
  for (const w of weights)
    if (!Number.isInteger(w) || w < 1 || w > 100)
      throw new SitesRefusal("weights are whole numbers 1 to 100", 400);
  return [...weights];
}

/**
 * Start splitting a page's address across it (A) and its variants. Every arm must be live and the
 * same owner's; a page runs at most one split, and an arm can't be split itself.
 */
export async function startSplit(
  db: Db,
  s: {
    page: string;
    arms: readonly string[];
    weights?: readonly number[] | null;
    goal?: SplitGoal | null;
    by: string;
  },
): Promise<SplitWithArms> {
  const ids = [s.page, ...s.arms.filter((a) => a !== s.page)];
  if (ids.length < 2) throw new SitesRefusal("pick at least one other version", 400);
  if (ids.length > ARM_LABELS.length)
    throw new SitesRefusal(`at most ${ARM_LABELS.length} versions`, 400);
  if (new Set(ids).size !== ids.length) throw new SitesRefusal("each version once", 400);
  if (!ids.every((id) => UUID.test(id))) throw new SitesRefusal("no such page", 404);
  const weights = weightsOf(ids.length, s.weights);
  const goal = s.goal ?? "forms";
  if (!SPLIT_GOALS.includes(goal)) throw new SitesRefusal("no such goal", 400);
  const id = await serializable(db, async (tx) => {
    const pages = await tx.select().from(sitePages).where(inArray(sitePages.id, ids));
    const byId = new Map(pages.map((p) => [p.id, p]));
    const a = byId.get(s.page);
    if (!a) throw new SitesRefusal("no such page", 404);
    if (goal === "won" && a.client !== null)
      throw new SitesRefusal("won deals are counted for Wren's pages only", 400);
    for (const pid of ids) {
      const p = byId.get(pid);
      if (!p) throw new SitesRefusal("no such page", 404);
      if (p.client !== a.client)
        throw new SitesRefusal("every version must be the same owner's", 400);
      if (!servable(p)) throw new SitesRefusal(`${p.slug} isn't live; publish it first`, 409);
    }
    const busy = await tx
      .select({ page: siteSplits.page })
      .from(siteSplits)
      .where(
        and(inArray(siteSplits.page, ids), inArray(siteSplits.state, ["running", "shipping"])),
      );
    if (busy.some((b) => b.page === s.page))
      throw new SitesRefusal("this page already has a split running", 409);
    if (busy.length) throw new SitesRefusal("a version picked has its own split running", 409);
    const [row] = await tx
      .insert(siteSplits)
      .values({ client: a.client, page: a.id, goal, startedBy: s.by })
      .returning({ id: siteSplits.id });
    if (!row) throw new Error("insert returned nothing");
    await tx.insert(siteSplitArms).values(
      ids.map((page, i) => ({
        split: row.id,
        label: ARM_LABELS[i] as ArmLabel,
        page,
        weight: weights[i] as number,
      })),
    );
    return row.id;
  });
  return (await splitById(db, id)) as SplitWithArms;
}

/** New shares on a running split, in arm order. */
export async function setSplitWeights(
  db: Db,
  id: string,
  weights: readonly number[],
): Promise<SplitWithArms> {
  const s = await splitById(db, id);
  if (!s) throw new SitesRefusal("no such split", 404);
  if (s.state !== "running") throw new SitesRefusal("this split isn't running", 409);
  const w = weightsOf(s.arms.length, weights);
  await serializable(db, async (tx) => {
    for (const [i, arm] of s.arms.entries())
      await tx
        .update(siteSplitArms)
        .set({ weight: w[i] as number })
        .where(and(eq(siteSplitArms.split, id), eq(siteSplitArms.label, arm.label)));
    await tx.update(siteSplits).set({ updatedAt: sql`now()` }).where(eq(siteSplits.id, id));
  });
  return (await splitById(db, id)) as SplitWithArms;
}

/** Stop splitting: the address serves A again. A version waiting to ship stays waiting. */
export async function stopSplit(db: Db, id: string, by: string): Promise<boolean> {
  const out = await db
    .update(siteSplits)
    .set({ state: "stopped", endedAt: sql`now()`, endedBy: by, updatedAt: sql`now()` })
    .where(and(eq(siteSplits.id, id), eq(siteSplits.state, "running")))
    .returning({ id: siteSplits.id });
  return out.length > 0;
}

/**
 * "Make B the page": B's live copy saved on A as a new version and asked for in To approve. The
 * split keeps running until the yes (shipped) or the no (back to running).
 */
export async function shipSplit(
  db: Db,
  id: string,
  label: string,
  by: string,
  sure?: number | null,
): Promise<{ split: SplitWithArms; page: SitePage; number: number }> {
  const s = await splitById(db, id);
  if (!s) throw new SitesRefusal("no such split", 404);
  if (s.state !== "running") throw new SitesRefusal("this split isn't running", 409);
  const a = s.arms.find((x) => x.label === "A");
  const win = s.arms.find((x) => x.label === label);
  if (!a || !win) throw new SitesRefusal("no such version in this split", 404);
  if (win.label === "A")
    throw new SitesRefusal("A is the page already; stop the split instead", 409);
  if ((win.template ?? "lander") !== (a.template ?? "lander"))
    throw new SitesRefusal("B uses another layout; publish it at A's address by hand", 409);
  const winPage = await pageById(db, win.page);
  const v = winPage?.liveVersion ? await versionOf(db, win.page, winPage.liveVersion) : null;
  if (!v) throw new SitesRefusal(`${win.slug} has no live copy`, 409);
  const why = `won the split${sure ? `, ${Math.min(99, Math.floor(sure * 100))}% sure` : ""}: copy of ${win.slug} v${v.number}`;
  const saved = await saveVersion(db, s.page, {
    content: v.content as Content,
    origin: "copy",
    why,
    by,
  });
  const number = saved.draftVersion as number;
  const page = await askPublish(db, s.page, { by, number });
  const moved = await db
    .update(siteSplits)
    .set({ state: "shipping", winner: win.label, shipVersion: number, updatedAt: sql`now()` })
    .where(and(eq(siteSplits.id, id), eq(siteSplits.state, "running")))
    .returning({ id: siteSplits.id });
  if (!moved.length) throw new SitesRefusal("this split changed; open it again", 409);
  return { split: (await splitById(db, id)) as SplitWithArms, page, number };
}

/**
 * What a visit to a split page gets: the arm its cookie names (when it's still in the split), else
 * one picked by weight. Null when the page has no split running.
 */
export async function armToServe(
  db: Queryable,
  page: SitePage,
  cookie: string | null,
  roll: number,
): Promise<{ split: string; label: string; page: SitePage; content: Content } | null> {
  const s = await liveSplitOf(db, page.id);
  if (!s) return null;
  const m = cookie ? SPLIT_COOKIE.exec(cookie) : null;
  const want = m && s.id.startsWith(m[1] as string) ? (m[2] as string) : null;
  const live = s.arms.filter((a) => a.status === "live");
  const arm = pickArm(live, want, roll);
  if (!arm) return null;
  const p = arm.page === page.id ? page : await pageById(db, arm.page);
  const v = p?.liveVersion ? await versionOf(db, p.id, p.liveVersion) : null;
  if (!p || !v) return null;
  return { split: s.id, label: arm.label, page: p, content: v.content };
}

/**
 * Pick an arm for a visit: the one its cookie names when the split still has it, else by weight
 * with `roll` in [0, 1).
 */
export function pickArm<T extends { label: string; weight: number }>(
  arms: readonly T[],
  want: string | null,
  roll: number,
): T | null {
  if (!arms.length) return null;
  const kept = want ? arms.find((a) => a.label === want) : undefined;
  if (kept) return kept;
  const total = arms.reduce((t, a) => t + Math.max(0, a.weight), 0);
  let at = Math.min(Math.max(roll, 0), 0.999999) * total;
  for (const a of arms) {
    at -= Math.max(0, a.weight);
    if (at < 0) return a;
  }
  return arms[arms.length - 1] ?? null;
}

export interface ArmNumbers {
  label: string;
  page: string;
  slug: string;
  title: string;
  weight: number;
  visits: number;
  forms: number;
  books: number;
  won: number;
}

/**
 * Each arm's numbers inside the split: unique views (a view id counts once), forms sent, booking
 * clicks, and won deals (a form's email that booked a call after it, marked won; Wren's only).
 */
export async function splitNumbers(db: Queryable, split: SplitWithArms): Promise<ArmNumbers[]> {
  return snapshot(db, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
      select a.label, a.page::text page,
        (select count(distinct e.view) from site_events e
          where e.split = a.split and e.page = a.page and e.name = 'view')::int visits,
        (select count(*) from site_forms f where f.split = a.split and f.page = a.page)::int forms,
        (select count(distinct e.view) from site_events e
          where e.split = a.split and e.page = a.page and e.name = 'book')::int books,
        (select count(distinct lower(f.fields ->> 'email')) from site_forms f
          where f.split = a.split and f.page = a.page and f.fields ? 'email'
            and exists (select 1 from call_bookings b
              where lower(b.email) = lower(f.fields ->> 'email') and b.outcome = 'won'
                and b.booked_at >= f.at))::int won
      from site_split_arms a where a.split = ${split.id}::uuid order by a.label`)),
    ] as unknown as {
      label: string;
      page: string;
      visits: number;
      forms: number;
      books: number;
      won: number;
    }[];
    return split.arms.map((arm) => {
      const r = rows.find((x) => x.label === arm.label);
      return {
        label: arm.label,
        page: arm.page,
        slug: arm.slug,
        title: arm.title,
        weight: arm.weight,
        visits: r?.visits ?? 0,
        forms: r?.forms ?? 0,
        books: r?.books ?? 0,
        won: split.client === null ? (r?.won ?? 0) : 0,
      };
    });
  });
}

export interface SplitResult {
  split: SplitWithArms;
  arms: ArmNumbers[];
  call: SplitCall;
}

/** A split's numbers and its call on the split's goal. */
export async function splitResult(db: Queryable, split: SplitWithArms): Promise<SplitResult> {
  const arms = await splitNumbers(db, split);
  const counts: ArmCount[] = arms.map((a) => ({
    label: a.label,
    visits: a.visits,
    goals: split.goal === "books" ? a.books : split.goal === "won" ? a.won : a.forms,
  }));
  return { split, arms, call: splitCall(counts) };
}
