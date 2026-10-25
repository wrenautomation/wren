/**
 * Marketing email bounces: a delivery report that came back to a workspace's sending mailbox,
 * matched to the send it answers, then acted on. The one writer of `mail_bounces` and
 * `mail_bounce_reads` (`./bounces-schema.ts`). Reading the mailbox and classifying the report is
 * channel-email's (`inbox/marketing-bounces.ts`); this is what the verdict does to the records.
 *
 * A report matches a send by the Message-ID it carries (the embedded original, else References or
 * In-Reply-To): a broadcast's `broadcast_recipients.message_id`, or a `sent` consent event's (a
 * workflow's Send message). With none, by its Final-Recipient: the newest marketing email to that
 * address in the week before it came. A report that matches nothing is left alone: the mailbox may
 * be a client's own, and its other mail isn't ours.
 *
 * A hard bounce puts the address we mailed on do-not-contact (reason bounce, the status code and
 * diagnostic as evidence), unless the report names a different address (a forward failed, not
 * ours). A soft bounce is kept and nothing else. The sent log reads these rows (`./sent-views.ts`).
 */
import { randomUUID } from "node:crypto";
import type { Queryable } from "@wren/db";
import { atomic } from "@wren/db/isolation";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  type BounceClass,
  type BounceMatch,
  mailBounceReads,
  mailBounces,
} from "./bounces-schema.js";
import { addSuppression } from "./suppress.js";

/** How far back a report's address finds its send: mail servers give up within five days. */
const BOUNCE_LOOKBACK_MS = 7 * 86_400_000;

/**
 * How long a mailbox is read after it last sent. A server retries for up to five days before it
 * returns a report, and the report may sit in the listing a while; the rest is a week of margin
 * for a loop that was off or a connection that lapsed.
 */
export const BOUNCE_LATE_MS = 14 * 86_400_000;

/** One delivery report, as read from the mailbox. */
interface BounceReport {
  /** The sending mailbox it came back to. */
  mailbox: string;
  /** Its id in that mailbox. */
  providerId: string;
  /** Every Message-ID it names: the embedded original first, then References, In-Reply-To. */
  messageIds: readonly string[];
  /** The address it says failed (Final-Recipient), when it says. */
  address: string | null;
  class: BounceClass;
  status: string | null;
  diagnostic: string | null;
  receivedAt: Date;
}

/**
 * What a report came to: `seen` (kept before), `unmatched` (none of our sends), `soft` (kept),
 * `suppressed` (hard: kept, address on do-not-contact), `mismatch` (hard, but for another address).
 */
export type BounceVerdict = "seen" | "unmatched" | "soft" | "suppressed" | "mismatch";

/** A Message-ID as we keep them: in angle brackets, lowercased. */
export const keptMessageId = (id: string): string =>
  `<${id
    .trim()
    .replace(/^<+|>+$/g, "")
    .trim()
    .toLowerCase()}>`;

/** A fresh Message-ID on the sender's domain, kept with the send before it leaves. */
export const mintMessageId = (domain: string): string => keptMessageId(`${randomUUID()}@${domain}`);

interface Send {
  recipientId: number | null;
  consentEventId: number | null;
  address: string;
  by: BounceMatch;
  messageId: string | null;
}

type Row = Record<string, unknown>;
const rows = async (db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as Row[];

/** The send a report answers: by its Message-ID, else its address; null when none is ours. */
export async function sendOf(
  db: Queryable,
  r: Pick<BounceReport, "messageIds" | "address" | "receivedAt">,
): Promise<Send | null> {
  const ids = [...new Set(r.messageIds.map(keptMessageId))];
  if (ids.length) {
    const list = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );
    const [b] = await rows(
      db,
      sql`select r.id, r.address, r.message_id from broadcast_recipients r
        join broadcasts b on b.id = r.broadcast_id
        where r.message_id in (${list}) and b.channel = 'email' limit 1`,
    );
    if (b)
      return {
        recipientId: Number(b.id),
        consentEventId: null,
        address: String(b.address),
        by: "message_id",
        messageId: String(b.message_id),
      };
    const [e] = await rows(
      db,
      sql`select e.id, c.address, e.message_id from consent_events e
        join consents c on c.id = e.consent_id
        where e.message_id in (${list}) and e.kind = 'sent' limit 1`,
    );
    if (e)
      return {
        recipientId: null,
        consentEventId: Number(e.id),
        address: String(e.address),
        by: "message_id",
        messageId: String(e.message_id),
      };
  }
  if (!r.address) return null;
  const to = r.address.trim().toLowerCase();
  const at = r.receivedAt.toISOString();
  const from = new Date(r.receivedAt.getTime() - BOUNCE_LOOKBACK_MS).toISOString();
  // A broadcast's own consent event is skipped: its recipient row is the send.
  const [s] = await rows(
    db,
    sql`select * from (
        select 'recipient' src, r.id, r.address, r.message_id, r.sent_at at
        from broadcast_recipients r join broadcasts b on b.id = r.broadcast_id
        where b.channel = 'email' and r.state = 'sent' and lower(r.address) = ${to}
          and r.sent_at <= ${at}::timestamptz and r.sent_at > ${from}::timestamptz
        union all
        select 'event', e.id, c.address, e.message_id, e.created_at
        from consent_events e join consents c on c.id = e.consent_id
        where e.kind = 'sent' and c.channel = 'email' and c.address = ${to}
          and not coalesce(e.evidence ? 'broadcast', false)
          and e.created_at <= ${at}::timestamptz and e.created_at > ${from}::timestamptz
      ) x order by at desc limit 1`,
  );
  if (!s) return null;
  return {
    recipientId: s.src === "recipient" ? Number(s.id) : null,
    consentEventId: s.src === "event" ? Number(s.id) : null,
    address: String(s.address),
    by: "address",
    messageId: (s.message_id as string | null) ?? null,
  };
}

/** Which of these report ids this mailbox already kept: a re-read skips them before any fetch. */
export async function keptBounces(
  db: Queryable,
  mailbox: string,
  providerIds: readonly string[],
): Promise<Set<string>> {
  if (!providerIds.length) return new Set();
  const got = await db
    .select({ id: mailBounces.providerId })
    .from(mailBounces)
    .where(
      and(eq(mailBounces.mailbox, mailbox), inArray(mailBounces.providerId, [...providerIds])),
    );
  return new Set(got.map((g) => g.id));
}

/**
 * Match one report and act on it, in one transaction: the row, and for a hard bounce on the
 * address we mailed, do-not-contact. A report kept before does nothing again.
 */
export async function recordBounce(db: Queryable, r: BounceReport): Promise<BounceVerdict> {
  const send = await sendOf(db, r);
  if (!send) return "unmatched";
  const named = r.address?.trim().toLowerCase() ?? null;
  const mailed = send.address.trim().toLowerCase();
  const mismatch = named !== null && named !== mailed;
  return atomic(db, async (tx) => {
    const [row] = await tx
      .insert(mailBounces)
      .values({
        mailbox: r.mailbox,
        providerId: r.providerId,
        messageId: send.messageId,
        address: named,
        class: r.class,
        matchedBy: send.by,
        status: r.status,
        diagnostic: r.diagnostic,
        recipientId: send.recipientId,
        consentEventId: send.consentEventId,
        receivedAt: r.receivedAt,
      })
      .onConflictDoNothing()
      .returning({ id: mailBounces.id });
    if (!row) return "seen";
    if (r.class === "soft") return "soft";
    if (mismatch) return "mismatch";
    const { row: s } = await addSuppression(tx, {
      kind: "email",
      value: mailed,
      reason: "bounce",
      evidence: {
        status: r.status,
        diagnostic: r.diagnostic,
        mailbox: r.mailbox,
        bounce: row.id,
        ...(send.messageId ? { message_id: send.messageId } : {}),
      },
    });
    await tx.update(mailBounces).set({ suppressionId: s.id }).where(eq(mailBounces.id, row.id));
    return "suppressed";
  });
}

/** A mailbox as the check records keep it: addresses differ by case between a setting and a connection. */
const readKey = (mailbox: string): string => mailbox.trim().toLowerCase();

/**
 * This mailbox is the workspace's sender at `at`. It stays readable for `BOUNCE_LATE_MS` after
 * the last time this is said, which is how a bounce to a sender the workspace has since dropped
 * still gets read. Never moves back; keeps an earlier check where it stands.
 */
export async function noteBounceSender(db: Queryable, mailbox: string, at: Date): Promise<void> {
  await db
    .insert(mailBounceReads)
    .values({ mailbox: readKey(mailbox), readAt: null, lastSenderAt: at })
    .onConflictDoUpdate({
      target: mailBounceReads.mailbox,
      set: {
        lastSenderAt: sql`greatest(${mailBounceReads.lastSenderAt}, excluded.last_sender_at)`,
      },
    });
}

/** The mailboxes that sent within `BOUNCE_LATE_MS` of `now`, newest sender first. */
export async function bounceMailboxes(db: Queryable, now: Date): Promise<string[]> {
  const got = await db
    .select({ mailbox: mailBounceReads.mailbox })
    .from(mailBounceReads)
    .where(gt(mailBounceReads.lastSenderAt, new Date(now.getTime() - BOUNCE_LATE_MS)))
    .orderBy(desc(mailBounceReads.lastSenderAt));
  return got.map((g) => g.mailbox);
}

/** When this mailbox was last checked, or null before its first check. */
export async function bouncesReadAt(db: Queryable, mailbox: string): Promise<Date | null> {
  const [r] = await db
    .select({ at: mailBounceReads.readAt })
    .from(mailBounceReads)
    .where(eq(mailBounceReads.mailbox, readKey(mailbox)));
  return r?.at ?? null;
}

/** A check finished: the next one reads from `at`. Never moves back. */
export async function markBouncesRead(
  db: Queryable,
  mailbox: string,
  at: Date,
  stats: Record<string, unknown>,
): Promise<void> {
  await db
    .insert(mailBounceReads)
    .values({ mailbox: readKey(mailbox), readAt: at, stats })
    .onConflictDoUpdate({
      target: mailBounceReads.mailbox,
      set: {
        readAt: sql`greatest(${mailBounceReads.readAt}, excluded.read_at)`,
        stats: sql`excluded.stats`,
      },
    });
}
