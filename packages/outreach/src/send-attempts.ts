/**
 * The send ledger (designs/2026-10-16-maybe-sent.md): one row per item that must land at most
 * once. A claim marks it `sending` before any call; a second invocation meanwhile is refused, and
 * one after a lost answer knows an earlier try may have left. Settled `sent` (with the real ref)
 * or `unsure` (waits on a person in To approve). A refusal or a send that never left releases it.
 */
import type { Queryable } from "@wren/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ReachRefusal } from "./refusal.js";
import { type SendAttempt, sendAttempts } from "./schema.js";

/** A `sending` row this old lost its invocation (a crash, a kill): the next claim takes it over. */
export const SENDING_STALE_MS = 10 * 60_000;

export const UNSURE_WAITS =
  "may have gone out. It waits in To approve, where you can open it on the site, mark it posted, or send it again";

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
  | { go: "send"; tried: boolean; since: string }
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
    const made = await db
      .insert(sendAttempts)
      .values({ item: c.item, state: "sending", tries: 1, startedAt: c.now, ...fields })
      .onConflictDoNothing()
      .returning({ item: sendAttempts.item });
    if (!made.length) throw new ReachRefusal("it is already being sent");
    return { go: "send", tried: false, since: c.now.toISOString() };
  }
  if (row.state === "sent")
    return { go: "done", ref: row.ref, at: row.sentAt?.toISOString() ?? null };
  if (row.state === "unsure" && !c.again) throw new ReachRefusal(`it ${UNSURE_WAITS}`);
  const stale = new Date(c.now.getTime() - SENDING_STALE_MS);
  if (row.state === "sending" && row.updatedAt > stale)
    throw new ReachRefusal("it is already being sent");
  // Taken over from a lost invocation, or sent again on a person's word: one winner.
  const taken = await db
    .update(sendAttempts)
    .set({ state: "sending", tries: sql`${sendAttempts.tries} + 1`, why: null, ...fields })
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
    tried: row.state === "sending",
    since: (row.state === "sending" ? row.startedAt : c.now).toISOString(),
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
    .set({ state: "unsure", why: s.why.slice(0, 1000), invocation: null, updatedAt: s.now })
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
  a: Omit<SendClaim, "invocation" | "again"> & { why: string; tries: number },
): Promise<void> {
  const row = {
    state: "unsure" as const,
    platform: a.platform,
    account: a.account,
    words: a.words,
    target: a.target,
    url: a.url,
    tries: a.tries,
    why: a.why.slice(0, 1000),
    updatedAt: a.now,
  };
  await db
    .insert(sendAttempts)
    .values({ item: a.item, startedAt: a.now, ...row })
    .onConflictDoUpdate({ target: sendAttempts.item, set: row });
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
