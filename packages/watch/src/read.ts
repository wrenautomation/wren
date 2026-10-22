/**
 * The Monitor's reader: new mail in each inbox since the newest kept, headers and Gmail's preview
 * only. Promotions and social never come back from the search, so they never reach the model.
 * A row is kept before it's triaged, so a run that dies loses no reads.
 */
import { parseMessage } from "@wren/core/mail";
import type { Mailbox } from "@wren/core/mailbox";
import type { Db } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { and, desc, eq, gt, inArray, isNull, lt, max, or } from "drizzle-orm";
import { primaryLink } from "./links.js";
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
        const link = m.link ?? (await linkOf(box, id, m.fromAddress));
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
            link,
            reader,
          })
          .onConflictDoNothing()
          .returning({ id: mail.id });
        if (row) stats.kept.push(row.id);
      }
    } catch (err) {
      stats.failed.push({ mailbox: box.address, error: String(err).slice(0, 5000) });
    }
  }
  return stats;
}

/**
 * The page a notification is about (LinkedIn's thread, a Reddit reply), read from the whole message
 * when the provider names none. A read that fails leaves it null: the Gmail thread still opens.
 */
async function linkOf(box: Mailbox, id: string, fromAddress: string): Promise<string | null> {
  try {
    return primaryLink(parseMessage(await box.raw(id)), fromAddress);
  } catch {
    return null;
  }
}

/** How many mails without a link one pass reads again. */
export const RELINK_BATCH = 40;

export interface RelinkWindow {
  /** Only mail newer than this is read again. */
  since: Date;
  /** Only mail older than this: the pass before stopped here. Null on the first pass. */
  before: Date | null;
}

/**
 * Links for mail kept before links were read: the newest `RELINK_BATCH` rows in Needs you with
 * none, per pass, walking back in time. `oldest` is where the next pass starts; null when there is
 * nothing older in the window, so the caller stops asking.
 */
export async function relinkMail(
  db: Db,
  boxes: readonly Mailbox[],
  window: RelinkWindow,
): Promise<{ linked: number; tried: number; oldest: Date | null }> {
  const byAddress = new Map(boxes.map((b) => [b.address, b]));
  if (!byAddress.size) return { linked: 0, tried: 0, oldest: null };
  const rows = await db
    .select({
      id: mail.id,
      mailbox: mail.mailbox,
      messageId: mail.messageId,
      fromAddress: mail.fromAddress,
      at: mail.at,
    })
    .from(mail)
    .where(
      and(
        inArray(mail.mailbox, [...byAddress.keys()]),
        isNull(mail.link),
        isNull(mail.doneAt),
        gt(mail.at, window.since),
        window.before ? lt(mail.at, window.before) : undefined,
        or(isNull(mail.verdict), eq(mail.verdict, "show")),
      ),
    )
    .orderBy(desc(mail.at))
    .limit(RELINK_BATCH);
  let linked = 0;
  for (const r of rows) {
    const box = byAddress.get(r.mailbox);
    if (!box) continue;
    const link = await linkOf(box, r.messageId, r.fromAddress);
    if (!link) continue;
    linked++;
    await db
      .update(mail)
      .set({ link })
      .where(and(eq(mail.id, r.id), isNull(mail.link)));
  }
  return {
    linked,
    tried: rows.length,
    oldest: rows.length ? (rows[rows.length - 1]?.at ?? null) : null,
  };
}
