/**
 * Which account a draft goes out as (designs/2026-10-15-accounts-first-class.md). A person picks
 * one on the draft box; it is kept by draft item in `draft_accounts` and every send reads it
 * before its own default (the place's account, the one they spoke to). A pick that misses the
 * sub's karma or age rule is warned about on the picker, never refused.
 */
import { warmupOf } from "@wren/channel-reddit";
import type { AccountHealth } from "@wren/core/outreach";
import {
  type AccountOption,
  type AccountPick,
  defaultAccount,
  type RecordAccount,
} from "@wren/core/record-accounts";
import type { Queryable } from "@wren/db";
import { eq, inArray, sql } from "drizzle-orm";
import { listAccounts, recordAccountsOf } from "./accounts.js";
import { effectiveNeed, shortfall, standingOfAccount } from "./discovery/requirements.js";
import { ReachRefusal } from "./refusal.js";
import { draftAccounts, type ReachAccount, redditRequirements } from "./schema.js";

/** The draft items that can go out as a picked account: their kinds, as `<kind>:<id>`. */
export const ACCOUNT_ITEMS = ["thread", "comment", "dm", "invite", "onpost", "draft"] as const;

const rowsOf = async <T>(db: Queryable, q: ReturnType<typeof sql>): Promise<T[]> =>
  (await db.execute(q)) as unknown as T[];

/** The account a person picked for an item; null when none was. */
export async function pickedAccount(db: Queryable, item: string): Promise<string | null> {
  const [row] = await db
    .select({ account: draftAccounts.account })
    .from(draftAccounts)
    .where(eq(draftAccounts.item, item));
  return row?.account ?? null;
}

/** Many items' picks at once, by item. */
export async function pickedAccounts(
  db: Queryable,
  items: readonly string[],
): Promise<Map<string, string>> {
  if (!items.length) return new Map();
  const rows = await db
    .select()
    .from(draftAccounts)
    .where(inArray(draftAccounts.item, [...items]));
  return new Map(rows.map((r) => [r.item, r.account]));
}

/** An item's platform and the subreddit its rule comes from; null when there is no such item. */
async function itemOf(
  db: Queryable,
  item: string,
): Promise<{ platform: string; sub: string | null } | null> {
  const at = item.indexOf(":");
  const kind = item.slice(0, at);
  const id = item.slice(at + 1);
  if (at < 1 || !id) return null;
  const one = async (q: ReturnType<typeof sql>) =>
    (await rowsOf<{ platform: string; sub: string | null }>(db, q))[0] ?? null;
  switch (kind) {
    case "thread":
      return one(sql`select 'reddit' platform, subreddit sub from reddit_threads where id = ${id}`);
    case "comment":
      return /^\d+$/.test(id)
        ? one(
            sql`select platform, case when platform = 'reddit' then lower(regexp_replace(place, '^r/', '')) end sub
              from comments where id = ${Number(id)}`,
          )
        : null;
    case "dm":
    case "invite":
      return /^\d+$/.test(id)
        ? one(sql`select platform, null sub from reach_contacts where id = ${Number(id)}`)
        : null;
    case "onpost":
      return /^\d+$/.test(id)
        ? one(sql`select platform, null sub from reach_posts where id = ${Number(id)}`)
        : null;
    case "draft":
      return /^[0-9a-f-]{36}$/i.test(id)
        ? one(
            sql`select platform::text platform, null sub from content_drafts where id = ${id}::uuid`,
          )
        : null;
    default:
      return null;
  }
}

/**
 * Keep a person's pick for an item: an account on the item's platform that isn't retired. Empty
 * clears it (back to the default). Answers the item's picker after.
 */
export async function pickAccount(
  db: Queryable,
  req: { item: string; account: string | null; by?: string | null; now?: Date },
): Promise<AccountPick | null> {
  const it = await itemOf(db, req.item);
  if (!it) throw new ReachRefusal(`no draft ${req.item}`);
  const key = req.account?.trim() || null;
  if (!key) {
    await db.delete(draftAccounts).where(eq(draftAccounts.item, req.item));
    return accountPickFor(db, req.item, req.now);
  }
  const known = (await recordAccountsOf(db)).find((a) => a.key === key);
  if (!known || known.platform !== it.platform)
    throw new ReachRefusal(`${key} is not one of our ${it.platform} accounts`);
  const [reach] = (await listAccounts(db)).filter((a) => a.account === key);
  if (reach?.state === "retired") throw new ReachRefusal(`${key} is retired`);
  await db
    .insert(draftAccounts)
    .values({ item: req.item, account: key, by: req.by ?? null })
    .onConflictDoUpdate({
      target: draftAccounts.item,
      set: { account: key, by: req.by ?? null, at: sql`now()` },
    });
  return accountPickFor(db, req.item, req.now);
}

/** The account an item goes out as with no pick: its place's, the one they spoke to, the read's. */
async function fallbackOf(db: Queryable, item: string): Promise<string | null> {
  const at = item.indexOf(":");
  const kind = item.slice(0, at);
  const id = item.slice(at + 1);
  const one = async (q: ReturnType<typeof sql>) =>
    (await rowsOf<{ account: string | null }>(db, q))[0]?.account ?? null;
  const n = /^\d+$/.test(id) ? Number(id) : null;
  switch (kind) {
    case "thread":
      // The send's order (`planThreadComment`): the place's account, else the thread's.
      return one(sql`select coalesce(pa.account, ta.account) account
        from reddit_threads t
        left join reddit_places p on p.subreddit = t.subreddit
        left join reach_accounts pa on pa.id = p.account_id
        left join reach_accounts ta on ta.id = t.account_id
        where t.id = ${id}`);
    case "comment":
      return n === null
        ? null
        : one(sql`select a.account from comments c join reach_accounts a on a.id = c.account_id
            where c.id = ${n}`);
    case "dm":
    case "invite":
      return n === null
        ? null
        : one(sql`select a.account from reach_contacts c join reach_accounts a on a.id = c.account_id
            where c.id = ${n}`);
    case "onpost":
      return n === null ? null : one(sql`select account from reach_posts where id = ${n}`);
    default:
      return null;
  }
}

/** Why an account may not land in a sub: its karma or age under the sub's floor. Null = fine. */
export function warnOf(
  sub: string | null,
  a: ReachAccount | undefined,
  rows: Parameters<typeof effectiveNeed>[0],
  label: string,
  now: Date,
): string | null {
  if (!sub || !a || a.platform !== "reddit") return null;
  const need = effectiveNeed(rows);
  if (need.hold) return `r/${sub} removed our last comment without saying why`;
  const s = shortfall(need, standingOfAccount(a, now));
  if (!s.needs.length) return null;
  return `r/${sub} needs ${s.needs.join(" and ")}, ${label} has ${s.has.join(" and ")}`;
}

/**
 * An item's picker: the account it goes out as, the default it would use, and every account on
 * its platform with a warning where one misses the sub's rule. Null when the platform has fewer
 * than two (nothing to pick) or the item is gone. Reads the database only.
 */
export async function accountPickFor(
  db: Queryable,
  item: string,
  now = new Date(),
): Promise<AccountPick | null> {
  const it = await itemOf(db, item);
  if (!it) return null;
  const reach = await listAccounts(db);
  const live = new Set(reach.filter((a) => a.state !== "retired").map((a) => a.account));
  const retired = new Set(reach.filter((a) => a.state === "retired").map((a) => a.account));
  const all = (await recordAccountsOf(db)).filter(
    (a): a is RecordAccount => a.platform === it.platform && !retired.has(a.key),
  );
  if (all.length < 2) return null;
  const picked = await pickedAccount(db, item);
  const fallback = await fallbackOf(db, item);
  const rows = it.sub
    ? await db.select().from(redditRequirements).where(eq(redditRequirements.subreddit, it.sub))
    : [];
  const byKey = new Map(reach.map((a) => [a.account, a]));
  const options: AccountOption[] = all.map((a) => {
    const r = byKey.get(a.key);
    const frozen =
      r?.health && r.platform === "reddit" ? warmupOf(r.health as AccountHealth, now).frozen : null;
    return {
      key: a.key,
      label: a.label,
      state: live.has(a.key) ? (r?.state ?? null) : null,
      warn: frozen ? `${a.label}: ${frozen}` : warnOf(it.sub, r, rows, a.label, now),
    };
  });
  return {
    platform: it.platform,
    current: defaultAccount({ picked, assigned: fallback }),
    fallback,
    picked: picked !== null,
    options,
  };
}

/**
 * The reach account an item goes out as: the pick when there is one (by its key), else null and
 * the caller's own default. Refuses a pick that is paused or retired: the send would fail anyway.
 */
export async function pickedReachAccount(
  db: Queryable,
  item: string,
): Promise<ReachAccount | null> {
  const key = await pickedAccount(db, item);
  if (!key) return null;
  const [a] = (await listAccounts(db)).filter((r) => r.account === key);
  if (!a) throw new ReachRefusal(`the picked account ${key} is gone: pick another`);
  if (a.state === "paused" || a.state === "retired")
    throw new ReachRefusal(`the picked account ${key} is ${a.state}: pick another`);
  return a;
}
