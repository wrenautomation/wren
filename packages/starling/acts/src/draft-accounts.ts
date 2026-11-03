/**
 * Which account a draft goes out as (designs/2026-10-15-accounts-first-class.md). A person picks
 * one on the draft box; it is kept by draft item in `draft_accounts` and every send reads it
 * before its own default (the place's account, the one they spoke to). A pick that misses the
 * sub's karma or age rule is warned about on the picker, never refused. What the item is and
 * where it goes is its kind's word (`ItemKinds`): this file reads no channel's table.
 */

import type { AccountHealth } from "@wren/core/outreach";
import {
  type AccountOption,
  type AccountPick,
  defaultAccount,
  type RecordAccount,
} from "@wren/core/record-accounts";
import type { Queryable } from "@wren/db";
import { warmupOf } from "@wren/starling-reddit";
import { eq, inArray, sql } from "drizzle-orm";
import { listAccounts, recordAccountsOf } from "./accounts.js";
import { type ItemKinds, itemOf } from "./item-kinds.js";
import { ReachRefusal } from "./refusal.js";
import { draftAccounts, type ReachAccount } from "./schema.js";

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

/** The item's kind, or null for an item no kind here owns (a bad id, a kind the desk lacks). */
const kindOf = (item: string, kinds: ItemKinds) => {
  try {
    const { kind, id } = itemOf(item);
    const k = kinds[kind];
    return k ? { kind: k, id } : null;
  } catch {
    return null;
  }
};

/**
 * Keep a person's pick for an item: an account on the item's platform that isn't retired. Empty
 * clears it (back to the default). Answers the item's picker after.
 */
export async function pickAccount(
  db: Queryable,
  req: { item: string; account: string | null; by?: string | null; now?: Date },
  kinds: ItemKinds,
): Promise<AccountPick | null> {
  const k = kindOf(req.item, kinds);
  const it = k ? await k.kind.place(db, k.id) : null;
  if (!it) throw new ReachRefusal(`no draft ${req.item}`);
  const key = req.account?.trim() || null;
  if (!key) {
    await db.delete(draftAccounts).where(eq(draftAccounts.item, req.item));
    return accountPickFor(db, req.item, kinds, req.now);
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
  return accountPickFor(db, req.item, kinds, req.now);
}

/**
 * An item's picker: the account it goes out as, the default it would use, and every account on
 * its platform with a warning where one misses the sub's rule. Null when the platform has fewer
 * than two (nothing to pick) or the item is gone. Reads the database only.
 */
export async function accountPickFor(
  db: Queryable,
  item: string,
  kinds: ItemKinds,
  now = new Date(),
): Promise<AccountPick | null> {
  const k = kindOf(item, kinds);
  const it = k ? await k.kind.place(db, k.id) : null;
  if (!k || !it) return null;
  const reach = await listAccounts(db);
  const live = new Set(reach.filter((a) => a.state !== "retired").map((a) => a.account));
  const retired = new Set(reach.filter((a) => a.state === "retired").map((a) => a.account));
  const all = (await recordAccountsOf(db)).filter(
    (a): a is RecordAccount => a.platform === it.platform && !retired.has(a.key),
  );
  if (all.length < 2) return null;
  const picked = await pickedAccount(db, item);
  const fallback = await k.kind.fallback(db, k.id);
  const floor =
    it.sub && k.kind.floors ? await k.kind.floors(db, it.sub, now) : (): string | null => null;
  const byKey = new Map(reach.map((a) => [a.account, a]));
  const options: AccountOption[] = all.map((a) => {
    const r = byKey.get(a.key);
    const frozen =
      r?.health && r.platform === "reddit" ? warmupOf(r.health as AccountHealth, now).frozen : null;
    return {
      key: a.key,
      label: a.label,
      state: live.has(a.key) ? (r?.state ?? null) : null,
      warn: frozen ? `${a.label}: ${frozen}` : r ? floor(r, a.label) : null,
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
