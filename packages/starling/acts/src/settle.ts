/**
 * A person settles an unsure send (designs/2026-10-16-maybe-sent.md): he saw it on the site, so it
 * is recorded as sent the way a send records it (the item's state, a touch, the draft record),
 * he asks for it again, or he drops it: it did not go out and he does not want it sent. The
 * ledger flips here; what "sent" or "dropped" means for the item is its kind's word (`ItemKinds`).
 */

import { atomic, type Queryable } from "@wren/db";
import type { ObjectContext } from "@wren/runtime";
import { type ItemKinds, itemOf } from "./item-kinds.js";
import { ReachRefusal } from "./refusal.js";
import { forgetUnsure, sendAttempt, settleSent } from "./send-attempts.js";

/** A person's word on an unsure send: he saw it, send it again, or it did not go out and stays out. */
export const SETTLE_OUTCOMES = ["posted", "again", "dropped"] as const;
export type SettleOutcome = (typeof SETTLE_OUTCOMES)[number];

/** `ContentDesk/<key>/settlePost` as inbound serves it: a desk settles a `draft:` through it, no import of inbound. */
export type PostSettle = {
  settlePost: (
    ctx: ObjectContext,
    req: { id: string; outcome: SettleOutcome; by: string },
  ) => Promise<{ id: string; outcome: SettleOutcome; found: boolean }>;
};

/** An unsure item, or the refusal that it isn't one. */
export async function unsureItem(db: Queryable, item: string) {
  const a = await sendAttempt(db, item);
  if (!a) throw new ReachRefusal("nothing waits on that send");
  if (a.state !== "unsure") throw new ReachRefusal(`that send is ${a.state}`);
  return a;
}

/**
 * Mark it posted: recorded as sent by `by`, with no ref (he saw it; we didn't read one). A kind
 * with no `landed` here settles in its own desk (a DM in ReachDesk, a post of ours in ContentDesk,
 * a client's answer in SocialInbox).
 */
export async function markPosted(
  outer: Queryable,
  item: string,
  kinds: ItemKinds,
  o: { by: string; now: Date },
): Promise<void> {
  // One transaction, the flip first: a second "posted" (or a late send) records nothing twice.
  await atomic(outer, async (db) => {
    const a = await unsureItem(db, item);
    const { kind, id } = itemOf(item);
    const landed = kinds[kind]?.landed;
    if (!landed) throw new ReachRefusal(`a ${kind} send settles in its own desk`);
    if (!(await settleSent(db, item, { ref: a.ref, at: o.now, by: o.by, now: o.now })))
      throw new ReachRefusal("that send is already settled");
    await landed(db, id, {
      body: a.words,
      account: a.account,
      ref: a.ref,
      ...(a.via ? { via: a.via } : {}),
      now: o.now,
      by: o.by,
    });
  });
}

/**
 * "Not sent, drop": it did not go out and it stays out. The item closes the way a person's skip
 * closes that kind (its `dropped`), so no pass sends it again, and its ledger row goes.
 */
export async function dropItem(
  db: Queryable,
  item: string,
  kinds: ItemKinds,
  o: { by: string; now: Date },
): Promise<void> {
  await unsureItem(db, item);
  const { kind, id } = itemOf(item);
  const dropped = kinds[kind]?.dropped;
  if (!dropped) throw new ReachRefusal(`a ${kind} send settles in its own desk`);
  await dropped(db, id, { by: o.by, now: o.now, note: "dropped in To approve: it was not sent" });
  await forgetUnsure(db, item);
}
