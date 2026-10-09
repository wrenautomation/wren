/**
 * A reply to mail in a client's connected mailbox (designs/2026-10-07-mail-access.md): kept in
 * `watch.mail_sent` as `sending` before the provider call, then `sent` or `failed`. The words are
 * ours; theirs are never kept.
 */
import type { ReplyTo } from "@wren/core/mailbox";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";

/** A reply kept and ready to go: its row and what the provider needs. */
export interface MailPlan {
  sentId: number;
  mailbox: string;
  to: ReplyTo;
  ours: string;
}

/** A refusal a retry won't change: the mail is gone or isn't the client's. */
export class MailReplyRefusal extends Error {
  override name = "MailReplyRefusal";
}

type Row = Record<string, unknown>;

/** The subject ours goes out under: "Re: " once, as the provider sends it. */
const reSubject = (s: string) => (/^re:/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`);

/**
 * Keep the reply to `mailId` as `sending`. Only mail a client's mailbox read in (`reader =
 * 'mail'`); the Monitor's is William's own. `ours` names the Message-ID the send carries.
 */
export async function planMailReply(
  db: Queryable,
  o: { mailId: number; body: string; ours: (mailbox: string) => string; by: string },
): Promise<MailPlan> {
  const [m] = (await db.execute(
    sql`select mailbox, message_id, thread_id, from_address, subject from watch.mail
      where id = ${o.mailId} and reader = 'mail'`,
  )) as unknown as Row[];
  if (!m) throw new MailReplyRefusal("That mail is gone.");
  const mailbox = String(m.mailbox);
  const to: ReplyTo = {
    messageId: String(m.message_id),
    threadId: String(m.thread_id),
    to: String(m.from_address),
    subject: String(m.subject),
  };
  if (!to.to.includes("@")) throw new MailReplyRefusal("That mail has no address to answer.");
  const ours = o.ours(mailbox);
  const [r] = (await db.execute(
    sql`insert into watch.mail_sent (mail_id, mailbox, thread_id, to_address, subject, body, ours,
        by)
      values (${o.mailId}, ${mailbox}, ${to.threadId}, ${to.to}, ${reSubject(to.subject)}, ${o.body},
        ${ours}, ${o.by.toLowerCase()})
      returning id`,
  )) as unknown as Row[];
  return { sentId: Number(r?.id), mailbox, to, ours };
}

/** It went: the provider's id when it names one. */
export async function sentMailReply(
  db: Queryable,
  id: number,
  o: { providerId: string | null; now: Date },
): Promise<void> {
  await db.execute(
    sql`update watch.mail_sent set state = 'sent', provider_id = ${o.providerId},
        sent_at = ${o.now.toISOString()}, why = null
      where id = ${id}`,
  );
}

/** It didn't: why, in the provider's or the mailbox's words. */
export async function failedMailReply(db: Queryable, id: number, why: string): Promise<void> {
  await db.execute(
    sql`update watch.mail_sent set state = 'failed', why = ${why.slice(0, 500)} where id = ${id}`,
  );
}
