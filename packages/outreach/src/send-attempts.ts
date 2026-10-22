/**
 * The send ledger (designs/2026-10-16-maybe-sent.md): one row per item that must land at most
 * once. A claim marks it `sending` before any call and makes the send key (autobrowse keeps one
 * verdict per key); a second invocation meanwhile is refused, and one after a lost answer takes
 * it over under the same key, so autobrowse answers its stored verdict. Settled `sent` (with the
 * real ref) or `unsure` (waits on a person in To approve). A refusal or a send that never left
 * releases it; the next send makes a new key.
 */
import { newSendKey } from "@wren/core/send-verdict";
import type { Queryable } from "@wren/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ReachRefusal } from "./refusal.js";
import { type SendAttempt, sendAttempts } from "./schema.js";

/** A `sending` row this old lost its invocation (a crash, a kill): the next claim takes it over. */
export const SENDING_STALE_MS = 10 * 60_000;

export const UNSURE_WAITS =
  "may have gone out. It waits in To approve, where you can open it on the site, mark it posted, or send it again";

/** Why a key-less `sending` row taken over waits on a person. */
export const KEYLESS_TRY =
  "an earlier try ran with no send key, so no verdict can say if it went out";

export interface SendClaim {
  item: string;
  platform: string;
  account: string | null;
  words: string;
  target: string;
  url: string | null;
  invocation: string;
  now: Date;
  /** A person's Send again on an unsure item. */
  again?: boolean;
}

export type Claimed =
  | { go: "send"; tried: boolean; since: string; sendKey: string }
  | { go: "done"; ref: string | null; at: string | null };

/** Take the item for this invocation, or say why not. */
export async function claimSend(db: Queryable, c: SendClaim): Promise<Claimed> {
  const fields = {
    platform: c.platform,
    account: c.account,
    words: c.words,
    target: c.target,
    url: c.url,
    invocation: c.invocation,
    updatedAt: c.now,
  };
  const [row] = await db.select().from(sendAttempts).where(eq(sendAttempts.item, c.item));
  if (!row) {
    const sendKey = newSendKey(c.item);
    const made = await db
      .insert(sendAttempts)
      .values({ item: c.item, state: "sending", tries: 1, startedAt: c.now, sendKey, ...fields })
      .onConflictDoNothing()
      .returning({ item: sendAttempts.item });
    if (!made.length) throw new ReachRefusal("it is already being sent");
    return { go: "send", tried: false, since: c.now.toISOString(), sendKey };
  }
  if (row.state === "sent")
    return { go: "done", ref: row.ref, at: row.sentAt?.toISOString() ?? null };
  if (row.state === "unsure" && !c.again) throw new ReachRefusal(`it ${UNSURE_WAITS}`);
  const stale = new Date(c.now.getTime() - SENDING_STALE_MS);
  if (row.state === "sending" && row.updatedAt > stale)
    throw new ReachRefusal("it is already being sent");
  // Taken over from a lost invocation, or sent again on a person's word: one winner. A take-over
  // keeps the key (autobrowse answers the stored verdict); a send again is a new send, a new key.
  const takeOver = row.state === "sending";
  if (takeOver && !row.sendKey) {
    // An older wren sent it with no key: no verdict can answer for it, so a person decides.
    await db
      .update(sendAttempts)
      .set({ state: "unsure", why: KEYLESS_TRY, updatedAt: c.now })
      .where(and(eq(sendAttempts.item, c.item), eq(sendAttempts.state, "sending")));
    throw new ReachRefusal(`it ${UNSURE_WAITS}`);
  }
  const sendKey = takeOver && row.sendKey ? row.sendKey : newSendKey(c.item);
  const taken = await db
    .update(sendAttempts)
    .set({ state: "sending", tries: sql`${sendAttempts.tries} + 1`, why: null, sendKey, ...fields })
    .where(
      and(
        eq(sendAttempts.item, c.item),
        eq(sendAttempts.state, row.state),
        row.invocation === null
          ? isNull(sendAttempts.invocation)
          : eq(sendAttempts.invocation, row.invocation),
      ),
    )
    .returning({ item: sendAttempts.item });
  if (!taken.length) throw new ReachRefusal("it is already being sent");
  // A lost invocation may have sent; a person who said send again has looked.
  return {
    go: "send",
    tried: takeOver,
    since: (takeOver ? row.startedAt : c.now).toISOString(),
    sendKey,
  };
}

/** It went out (`by` "sent"), or our words were found on the site (`found`), or a person said so. */
export async function settleSent(
  db: Queryable,
  item: string,
  s: { ref: string | null; at: Date; by: string; now: Date },
): Promise<void> {
  await db
    .update(sendAttempts)
    .set({
      state: "sent",
      ref: s.ref,
      sentAt: s.at,
      settledBy: s.by,
      invocation: null,
      why: null,
      updatedAt: s.now,
    })
    .where(eq(sendAttempts.item, item));
}

/** May have gone through and no read could tell: a person decides. */
export async function settleUnsure(
  db: Queryable,
  item: string,
  s: { why: string; now: Date },
): Promise<void> {
  await db
    .update(sendAttempts)
    .set({ state: "unsure", why: s.why.slice(0, 10_000), invocation: null, updatedAt: s.now })
    .where(eq(sendAttempts.item, item));
}

/** Refused, or never left: no attempt stands, so the item sends as if never tried. */
export async function releaseSend(db: Queryable, item: string): Promise<void> {
  await db
    .delete(sendAttempts)
    .where(and(eq(sendAttempts.item, item), eq(sendAttempts.state, "sending")));
}

/** An unsure item handed back to its own queue (a DM sent again): the queue owns it again. */
export async function forgetUnsure(db: Queryable, item: string): Promise<void> {
  await db
    .delete(sendAttempts)
    .where(and(eq(sendAttempts.item, item), eq(sendAttempts.state, "unsure")));
}

/** Park an item the sender already marked unknown (a DM): unsure, waiting on a person. */
export async function parkUnsure(
  db: Queryable,
  a: Omit<SendClaim, "invocation" | "again"> & {
    why: string;
    tries: number;
    /** When the send began, where it is not `now`: a look on Mark posted reads from it. */
    since?: Date;
    /** The key the send ran under, where there was one. A row parked again keeps its own. */
    sendKey?: string | null;
  },
): Promise<void> {
  const row = {
    state: "unsure" as const,
    platform: a.platform,
    account: a.account,
    words: a.words,
    target: a.target,
    url: a.url,
    tries: a.tries,
    why: a.why.slice(0, 10_000),
    updatedAt: a.now,
  };
  await db
    .insert(sendAttempts)
    .values({ item: a.item, startedAt: a.since ?? a.now, sendKey: a.sendKey ?? null, ...row })
    .onConflictDoUpdate({
      target: sendAttempts.item,
      set: a.sendKey ? { ...row, sendKey: a.sendKey } : row,
    });
}

export async function sendAttempt(db: Queryable, item: string): Promise<SendAttempt | null> {
  const [row] = await db.select().from(sendAttempts).where(eq(sendAttempts.item, item));
  return row ?? null;
}

/** Every unsure item, newest first: To approve's rows. */
export async function unsureSends(db: Queryable): Promise<SendAttempt[]> {
  return db
    .select()
    .from(sendAttempts)
    .where(eq(sendAttempts.state, "unsure"))
    .orderBy(sql`${sendAttempts.updatedAt} desc`);
}

/**
 * SQL true when the item has a send out or waits on a person: a scheduler leaves it alone.
 * `item` is the typed id as SQL (`'thread:' || id`).
 */
export const sendOpen = (item: ReturnType<typeof sql>) =>
  sql`exists (select 1 from ${sendAttempts} where ${sendAttempts.item} = ${item} and ${sendAttempts.state} in ('sending', 'unsure'))`;
