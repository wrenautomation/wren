/**
 * Replies in: each account's new inbound, one row per platform id (the
 * unique index dedupes), the contact marked `replied` and its queued steps
 * skipped. A stranger who writes first gets a contact row (`foundIn`
 * inbound). "Stop" in any spelling ends them as `opted_out`: never enrolled
 * again (the handle is unique per platform and enroll takes `new` only).
 */
import type { OutreachChannel, Reply } from "@wren/core/outreach";
import type { Queryable } from "@wren/db";
import { and, eq, inArray } from "drizzle-orm";
import { addProspects, contactByHandle, setContactState } from "./contacts.js";
import { type Platform, type ReachAccount, reachContacts, reachMessages } from "./schema.js";

const OPT_OUT =
  /\b(stop|unsubscribe|remove me|leave me alone|do not (contact|message|dm)|don'?t (contact|message|dm))\b/i;

export const isOptOut = (text: string) => OPT_OUT.test(text);

export interface RepliesStats {
  checked: number;
  received: number;
  optedOut: number;
  errors: string[];
  /** Contacts who replied (not asking to stop), for a Reply trigger. */
  replied?: number[];
}

export async function pullReplies(
  db: Queryable,
  accounts: readonly ReachAccount[],
  channelFor: (a: ReachAccount) => OutreachChannel | null,
  now: Date,
): Promise<RepliesStats> {
  const stats: RepliesStats = { checked: 0, received: 0, optedOut: 0, errors: [], replied: [] };
  for (const a of accounts) {
    const ch = channelFor(a);
    if (!ch) continue;
    let replies: Reply[];
    try {
      replies = await ch.replies(null);
      stats.checked++;
    } catch (err) {
      stats.errors.push(`${a.account}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const r of replies) {
      const n = await receive(db, a.platform, a.id, r, now);
      stats.received += n.received;
      stats.optedOut += n.optedOut;
      if (n.received && !n.optedOut && n.contactId !== undefined) stats.replied?.push(n.contactId);
    }
  }
  return stats;
}

/** One inbound message applied; a repeat (same platform id) is a no-op. */
export async function receive(
  db: Queryable,
  platform: Platform,
  accountId: string,
  r: Reply,
  now: Date,
): Promise<{ received: number; optedOut: number; contactId?: number }> {
  await addProspects(db, platform, [
    { handle: r.handle, url: r.threadUrl ?? "", name: r.name, headline: null, foundIn: "inbound" },
  ]);
  const contact = await contactByHandle(db, platform, r.handle);
  const inserted = await db
    .insert(reachMessages)
    .values({
      contactId: contact.id,
      accountId,
      direction: "in",
      kind: "inbound",
      body: r.text,
      state: "received",
      sentAt: new Date(r.at),
      ref: r.ref.slice(0, 200),
    })
    .onConflictDoNothing()
    .returning({ id: reachMessages.id });
  if (inserted.length === 0) return { received: 0, optedOut: 0 };
  const optOut = isOptOut(r.text);
  // A draft answered their older word: stale now, the watch drafts again (drafts.ts).
  await db
    .update(reachContacts)
    .set({ draft: null, ...(contact.accountId ? {} : { accountId }) })
    .where(eq(reachContacts.id, contact.id));
  if (optOut) await setContactState(db, contact.id, "opted_out", { reason: "asked to stop", now });
  else if (["new", "enrolled", "connected"].includes(contact.state))
    await setContactState(db, contact.id, "replied", { now });
  // Whatever was still queued for them stops.
  await db
    .update(reachMessages)
    .set({ state: "skipped", stateReason: optOut ? "opted out" : "they replied" })
    .where(
      and(
        eq(reachMessages.contactId, contact.id),
        inArray(reachMessages.state, ["queued"]),
        eq(reachMessages.kind, "sequence"),
      ),
    );
  return { received: 1, optedOut: optOut ? 1 : 0, contactId: contact.id };
}
