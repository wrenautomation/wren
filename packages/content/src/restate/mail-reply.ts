/**
 * MailReply (designs/2026-10-07-mail-access.md): a reply from the Inbox to mail in a client's
 * connected mailbox, sent through that mailbox (Gmail API or Graph), in the same thread. InboxDesk
 * calls it after its gate said yes; it refuses again here while the client's `mail.triage` sends
 * are off. Kept first as `sending`, so a reply that fails says so in the thread.
 */
import { randomUUID } from "node:crypto";
import * as restate from "@restatedev/restate-sdk";
import { findClient, sendsOn } from "@wren/core/clients";
import { SENDS_OFF } from "@wren/core/content/restate";
import { noRawKeys } from "@wren/core/key-refs";
import type { MailSender, Replied } from "@wren/core/mailbox";
import { errorText, serviceHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { z } from "zod";
import {
  failedMailReply,
  type MailPlan,
  MailReplyRefusal,
  planMailReply,
  sentMailReply,
} from "../inbox/mail-reply.js";
import { MAIL_PART } from "../inbox/send.js";

export interface MailReplyDeps {
  main: Db;
  clientDb: (client: string) => Db;
  /**
   * The client's mailbox that sends (channel-email's `senderOf`): throws "Needs setup" when it
   * isn't connected, and breaks the connection on a refused token.
   */
  sender: (client: string, address: string) => Promise<MailSender>;
}

const SEND = z.looseObject({
  client: z.string().min(1).max(64).describe("The client's id"),
  mailId: z.number().int().positive().describe("The mail it answers (watch.mail)"),
  body: z.string().min(1).max(4000),
  by: z.string().max(320).nullish().describe("Who sent it"),
});

/** A Message-ID on the mailbox's own domain. */
const mint = (mailbox: string) =>
  `<${randomUUID().replaceAll("-", "")}@${mailbox.slice(mailbox.lastIndexOf("@") + 1)}>`;

/**
 * A refusal a retry won't change: the mailbox isn't set up, or the provider said no (4xx). A
 * 5xx or a dropped connection is not one.
 */
const refused = (err: unknown) => {
  const e = err as { name?: string; status?: number };
  if (e?.name === "MailRefusal" || err instanceof MailReplyRefusal) return true;
  return e?.name === "MailApiError" && typeof e.status === "number" && e.status < 500;
};

export function makeMailReply(deps: MailReplyDeps) {
  return restate.service({
    name: "MailReply",
    handlers: {
      /** One reply through the mailbox the mail came to. Sent now: InboxDesk's gate said yes. */
      send: serviceHandler(
        { input: noRawKeys(SEND), effect: "sends" },
        async (
          ctx: restate.Context,
          req: { client: string; mailId: number; body: string; by?: string | null },
        ): Promise<{ id: string | null }> => {
          const on = await ctx.run("sends", async () => {
            const c = await findClient(deps.main, req.client);
            return !!c && !c.demo && sendsOn(c, MAIL_PART);
          });
          if (!on) throw new restate.TerminalError(SENDS_OFF, { errorCode: 403 });
          const db = deps.clientDb(req.client);
          const by = req.by ?? "inbox";
          const plan: MailPlan = await ctx.run("plan", async () => {
            try {
              return await planMailReply(db, {
                mailId: req.mailId,
                body: req.body,
                ours: mint,
                by,
              });
            } catch (err) {
              if (err instanceof MailReplyRefusal) throw new restate.TerminalError(err.message);
              throw err;
            }
          });
          let sent: Replied;
          try {
            // One try: a send isn't safe to repeat, so a lost answer fails rather than sends twice.
            sent = await ctx.run(
              "send",
              async () => {
                try {
                  const s = await deps.sender(req.client, plan.mailbox);
                  return await s.reply(plan.to, req.body, plan.ours);
                } catch (err) {
                  if (refused(err)) throw new restate.TerminalError(errorText(err));
                  throw err;
                }
              },
              { maxRetryAttempts: 1 },
            );
          } catch (err) {
            const why = errorText(err);
            await ctx.run("failed", () => failedMailReply(db, plan.sentId, why));
            throw new restate.TerminalError(why);
          }
          const now = new Date(await ctx.date.now());
          await ctx.run("sent", () => sentMailReply(db, plan.sentId, { providerId: sent.id, now }));
          return { id: sent.id };
        },
      ),
    },
  });
}

export type MailReply = ReturnType<typeof makeMailReply>;
