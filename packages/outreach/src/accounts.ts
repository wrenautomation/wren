/**
 * The accounts we speak as. A row is a pointer at an autobrowse credential
 * (`reddit@alt`); the login itself lives in autobrowse. `refreshHealth` asks
 * the adapter and stores the answer; `standingOf` (policy.ts) turns it into
 * today's caps.
 */
import type { AccountHealth, OutreachChannel } from "@wren/core/outreach";
import type { Queryable } from "@wren/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { fleetDay, type ReachPolicy, type Standing, standingOf } from "./policy.js";
import { ReachRefusal } from "./refusal.js";
import {
  type AccountState,
  PLATFORMS,
  type Platform,
  type ReachAccount,
  reachAccounts,
} from "./schema.js";

export interface AccountView extends Omit<ReachAccount, "health"> {
  health: AccountHealth | null;
  standing: Standing;
}

export const healthOf = (a: ReachAccount): AccountHealth | null =>
  (a.health as AccountHealth | null) ?? null;

export function viewOf(a: ReachAccount, policy: ReachPolicy, now: Date): AccountView {
  const health = healthOf(a);
  return {
    ...a,
    health,
    standing: standingOf({ platform: a.platform, startedOn: a.startedOn, health }, policy, now),
  };
}

export function platformOf(text: string): Platform {
  const p = text.trim().toLowerCase();
  if (!(PLATFORMS as readonly string[]).includes(p))
    throw new ReachRefusal(`platform must be one of ${PLATFORMS.join(", ")}`);
  return p as Platform;
}

/** Add (or find) the row for a credential. New rows start `warming`: `activate` lets them reach. */
export async function addAccount(
  db: Queryable,
  req: { platform: Platform; account: string; now: Date },
): Promise<ReachAccount> {
  const account = req.account.trim();
  if (!account.includes("@"))
    throw new ReachRefusal(`not a credential key (site@label): ${account}`);
  if (!account.startsWith(`${req.platform}@`))
    throw new ReachRefusal(`a ${req.platform} account's key starts with ${req.platform}@`);
  const [row] = await db
    .insert(reachAccounts)
    .values({ platform: req.platform, account, startedOn: fleetDay(req.now) })
    .onConflictDoNothing({ target: [reachAccounts.platform, reachAccounts.account] })
    .returning();
  if (row) return row;
  const [found] = await db
    .select()
    .from(reachAccounts)
    .where(and(eq(reachAccounts.platform, req.platform), eq(reachAccounts.account, account)));
  return found as ReachAccount;
}

export async function listAccounts(
  db: Queryable,
  platform?: Platform | null,
): Promise<ReachAccount[]> {
  return db
    .select()
    .from(reachAccounts)
    .where(platform ? eq(reachAccounts.platform, platform) : undefined)
    .orderBy(asc(reachAccounts.platform), asc(reachAccounts.createdAt));
}

/**
 * Each account's last touch, by account id: a DM sent or received, a comment on us or our answer.
 * The warm cadence reads it (`@wren/core/warm`).
 */
export async function lastTouches(db: Queryable): Promise<Record<string, string>> {
  const rows = (await db.execute(sql`
    select account_id, max(at) at from (
      select account_id, coalesce(sent_at, created_at) at from reach_messages
        where account_id is not null and (sent_at is not null or direction = 'in')
      union all select account_id, at from comments where account_id is not null
      union all select account_id, answered_at from comments
        where account_id is not null and answered_at is not null
    ) t group by account_id`)) as unknown as Array<{ account_id: string; at: Date | string }>;
  return Object.fromEntries(rows.map((r) => [r.account_id, new Date(r.at).toISOString()]));
}

export async function accountById(db: Queryable, id: string): Promise<ReachAccount> {
  const [row] = await db.select().from(reachAccounts).where(eq(reachAccounts.id, id));
  if (!row) throw new ReachRefusal(`no account ${id}`);
  return row;
}

/** Accounts that may send today: `active`, on one platform or all. */
export async function activeAccounts(
  db: Queryable,
  platform?: Platform | null,
): Promise<ReachAccount[]> {
  return db
    .select()
    .from(reachAccounts)
    .where(
      and(
        eq(reachAccounts.state, "active"),
        platform ? eq(reachAccounts.platform, platform) : undefined,
      ),
    )
    .orderBy(asc(reachAccounts.createdAt));
}

export async function setAccountState(
  db: Queryable,
  id: string,
  state: AccountState,
  o: { reason?: string | null; now: Date },
): Promise<ReachAccount> {
  const [row] = await db
    .update(reachAccounts)
    .set({
      state,
      pausedReason: state === "paused" ? o.reason?.trim() || "paused by hand" : null,
      ...(state === "retired" ? { retiredAt: o.now } : {}),
      ...(state === "active" ? { retiredAt: null } : {}),
    })
    .where(eq(reachAccounts.id, id))
    .returning();
  if (!row) throw new ReachRefusal(`no account ${id}`);
  return row;
}

export interface HealthStats {
  checked: number;
  frozen: string[];
  errors: string[];
}

/** One `health()` per account, stored; a suspended account is paused with the reason. */
export async function refreshHealth(
  db: Queryable,
  accounts: readonly ReachAccount[],
  channelFor: (a: ReachAccount) => OutreachChannel | null,
  now: Date,
): Promise<HealthStats> {
  const stats: HealthStats = { checked: 0, frozen: [], errors: [] };
  for (const a of accounts) {
    const ch = channelFor(a);
    if (!ch) continue;
    try {
      const health = await ch.health();
      await db
        .update(reachAccounts)
        .set({ health, healthAt: now, handle: health.handle })
        .where(eq(reachAccounts.id, a.id));
      stats.checked++;
      if (health.suspended && a.state !== "paused") {
        await setAccountState(db, a.id, "paused", { reason: "suspended by the platform", now });
        stats.frozen.push(a.account);
      }
    } catch (err) {
      stats.errors.push(`${a.account}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return stats;
}

export async function accountsById(
  db: Queryable,
  ids: readonly string[],
): Promise<Map<string, ReachAccount>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(reachAccounts)
    .where(inArray(reachAccounts.id, [...ids]));
  return new Map(rows.map((r) => [r.id, r]));
}
