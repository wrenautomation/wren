/**
 * The Monitor's reader: new mail in each inbox since the newest kept, headers and Gmail's preview
 * only. Promotions and social never come back from the search, so they never reach the model.
 * A row is kept before it's triaged, so a run that dies loses no reads.
 */
import type { Mailbox } from "@wren/core/mailbox";
import type { Db } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { and, eq, inArray, max } from "drizzle-orm";
import { mail, type Reader } from "./schema.js";

/** How far back the first run looks. */
export const FIRST_LOOK_MS = 2 * 86_400_000;
/** Gmail's `after:` is to the second and mail lands late: look this far behind the newest kept. */
const OVERLAP_MS = 3_600_000;
const SKIP = "-category:promotions -category:social -in:chats";

export interface ReadStats {
  /** New rows, by id: each goes to triage. */
  kept: number[];
  /** An inbox that couldn't be read this run, and why. */
  failed: Array<{ mailbox: string; error: string }>;
}

/** `reader`: the Monitor's (William's inboxes), or `mail` for a client's connected mailboxes. */
export async function readMail(
  db: Db,
  boxes: readonly Mailbox[],
  now: Date,
  reader: Reader = "monitor",
): Promise<ReadStats> {
  const stats: ReadStats = { kept: [], failed: [] };
  for (const box of boxes) {
    try {
      const [last] = await db
        .select({ at: max(mail.at) })
        .from(mail)
        .where(eq(mail.mailbox, box.address));
      const since = last?.at ? last.at.getTime() - OVERLAP_MS : now.getTime() - FIRST_LOOK_MS;
      const ids = await box.search(`in:inbox ${SKIP} after:${Math.floor(since / 1000)}`);
      if (!ids.length) continue;
      const known = new Set(
        (
          await db
            .select({ id: mail.messageId })
            .from(mail)
            .where(and(eq(mail.mailbox, box.address), inArray(mail.messageId, ids)))
        ).map((r) => r.id),
      );
      for (const id of ids) {
        if (known.has(id)) continue;
        const m = await box.meta(id);
        const [row] = await db
          .insert(mail)
          .values({
            ...pgSafe({
              mailbox: box.address,
              messageId: m.id,
              threadId: m.threadId,
              fromName: m.fromName,
              fromAddress: m.fromAddress,
              subject: m.subject,
              snippet: m.snippet,
            }),
            at: m.at,
            link: m.link ?? null,
            reader,
          })
          .onConflictDoNothing()
          .returning({ id: mail.id });
        if (row) stats.kept.push(row.id);
      }
    } catch (err) {
      stats.failed.push({ mailbox: box.address, error: String(err).slice(0, 500) });
    }
  }
  return stats;
}
