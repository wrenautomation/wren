/**
 * A person settles an unsure send (designs/2026-10-16-maybe-sent.md): he saw it on the site, so it
 * is recorded as sent the way a send records it (the item's state, a touch, the draft record),
 * or he asks for it again. One function per item kind, keyed by the typed id.
 */
import type { Queryable } from "@wren/db";
import { and, eq } from "drizzle-orm";
import { markAnswered } from "./comments.js";
import { markCommented } from "./discovery/threads.js";
import { markPostCommented, planPostComment } from "./reach-posts.js";
import { ReachRefusal } from "./refusal.js";
import { reachAccounts, reachContacts, reachMessages } from "./schema.js";
import { forgetUnsure, sendAttempt, settleSent } from "./send-attempts.js";
import {
  type Candidate,
  emptyStats,
  recordSent,
  type TickOptions,
  type TickStats,
} from "./tick.js";

/** The item kinds a send ledger row can name. */
export type SendItem = "thread" | "comment" | "onpost" | "dm";

export function itemOf(item: string): { kind: SendItem; id: string } {
  const at = item.indexOf(":");
  const kind = item.slice(0, at);
  if (at < 0 || !["thread", "comment", "onpost", "dm"].includes(kind))
    throw new ReachRefusal(`not a send: ${item}`);
  return { kind: kind as SendItem, id: item.slice(at + 1) };
}

/** An unsure item, or the refusal that it isn't one. */
export async function unsureItem(db: Queryable, item: string) {
  const a = await sendAttempt(db, item);
  if (!a) throw new ReachRefusal("nothing waits on that send");
  if (a.state !== "unsure") throw new ReachRefusal(`that send is ${a.state}`);
  return a;
}

/**
 * Mark it posted: recorded as sent by `by`, with no ref (he saw it; we didn't read one). A DM's
 * sequence moves on as if it sent; its steps come back for the spine.
 */
export async function markPosted(
  db: Queryable,
  item: string,
  o: Pick<TickOptions, "sequences" | "sender"> & { by: string; now: Date },
): Promise<TickStats> {
  const a = await unsureItem(db, item);
  const { kind, id } = itemOf(item);
  const stats = emptyStats();
  if (kind === "thread") {
    const [acct] = a.account
      ? await db
          .select({ id: reachAccounts.id })
          .from(reachAccounts)
          .where(eq(reachAccounts.account, a.account))
      : [];
    if (!acct) throw new ReachRefusal(`no account ${a.account ?? ""}`);
    await markCommented(db, id, {
      body: a.words,
      ref: a.ref,
      accountId: acct.id,
      now: o.now,
      by: o.by,
    });
  } else if (kind === "comment")
    await markAnswered(db, Number(id), { body: a.words, ref: a.ref, now: o.now, by: o.by });
  else if (kind === "onpost")
    await markPostCommented(db, await planPostComment(db, Number(id)), {
      body: a.words,
      by: o.by,
      now: o.now,
    });
  else {
    const [row] = await db
      .select()
      .from(reachMessages)
      .where(eq(reachMessages.id, Number(id)));
    if (!row) throw new ReachRefusal(`no message ${id}`);
    const [contact] = await db
      .select()
      .from(reachContacts)
      .where(eq(reachContacts.id, row.contactId));
    const [account] = row.accountId
      ? await db.select().from(reachAccounts).where(eq(reachAccounts.id, row.accountId))
      : [];
    if (!contact || !account) throw new ReachRefusal(`message ${id} has no contact or account`);
    const c: Candidate = { row, contact, account, checkRelationship: false };
    await recordSent(
      db,
      c,
      { ref: a.ref, at: o.now.toISOString(), fetchedWith: "browser" },
      { ...o, runId: null },
      stats,
    );
  }
  await settleSent(db, item, { ref: a.ref, at: o.now, by: o.by, now: o.now });
  return stats;
}

/** A DM sent again: back in the sender's queue, due now; its ledger row goes with it. */
export async function requeueDm(db: Queryable, id: number, now: Date): Promise<void> {
  const [m] = await db
    .update(reachMessages)
    .set({ state: "queued", dueAt: now, stateReason: "sent again after an unsure send" })
    .where(and(eq(reachMessages.id, id), eq(reachMessages.state, "unknown")))
    .returning({ id: reachMessages.id });
  if (!m) throw new ReachRefusal("that message is no longer waiting");
  await forgetUnsure(db, `dm:${id}`);
}
