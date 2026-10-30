/**
 * The context of `ReachDesk`: the request shapes several handler groups share, and
 * `deskContext(deps)`, the closures they all use (one invite, the terminal map of a refusal,
 * the clock, a client's database, the sender's nudge, one comment answered).
 */
import * as restate from "@restatedev/restate-sdk";
import type { byOf } from "@wren/core/ask";
import { rejectWhy } from "@wren/core/draft-record";
import { sendAcross } from "@wren/core/send-verdict";
import type { Db, Queryable } from "@wren/db";
import { z } from "zod";
import { listAccounts } from "../accounts.js";
import { answerFor, checkThread, planAnswer } from "../comments.js";
import { contactById } from "../contacts.js";
import { enroll } from "../enroll.js";
import { INVITE_SEQUENCE, inviteSettings } from "../invites.js";
import { ReachRefusal } from "../refusal.js";
import type { ReachContact } from "../schema.js";
import { recordLanded } from "../send-kinds.js";
import { slotsOf } from "../sequences.js";
import {
  type ContentReply,
  channelsFor,
  nowFor,
  type ReachDeps,
  SENDER_KEY,
  wakeWatch,
} from "./deps.js";
import { isSendUnsure, type Landed, sendAtMostOnce, sendError } from "./maybe-sent.js";
import { scheduleProofs } from "./proofs.js";
import { invitesAccount } from "./watch.js";

export const PLATFORM = z.string().describe("reddit or linkedin");

export const CONTACT = z.looseObject({ contactId: z.number() });

/** A drop's optional why (quick pick, note) for the draft record; a bad pick is the caller's. */
export const terminalWhy = (req: { reason?: unknown; note?: unknown }) => {
  try {
    return rejectWhy(req);
  } catch (err) {
    throw new restate.TerminalError((err as Error).message, { errorCode: 400 });
  }
};

/**
 * What every handler group of `ReachDesk` shares, built once: the deps and the closures over
 * them. Each group takes it and returns its handlers (`desk.ts` spreads them into the service).
 */
export function deskContext(deps: ReachDeps) {
  /** A LinkedIn invite for one contact through the invite sequence; answers their id. */
  const invite = async (c: ReachContact, now: Date): Promise<number> => {
    const seq = deps.sequences.get(INVITE_SEQUENCE);
    if (!seq) throw new ReachRefusal(`no sequence ${INVITE_SEQUENCE}`);
    const settings = await inviteSettings(deps.db);
    const a = invitesAccount(await listAccounts(deps.db), settings);
    if (!a) throw new ReachRefusal("no active account set in Shop → LinkedIn invites");
    if (c.platform !== "linkedin") throw new ReachRefusal("invites are LinkedIn only");
    if (c.connectedAt) throw new ReachRefusal("already connected: message them");
    if (c.state !== "new") throw new ReachRefusal(`already ${c.state}`);
    const e = await enroll(deps.db, {
      sequence: seq,
      sender: deps.senderName,
      contactIds: [c.id],
      limit: 1,
      account: a.account,
      now,
    });
    if (!e.enrolled)
      throw new ReachRefusal((await contactById(deps.db, c.id)).stateReason ?? "not enrolled");
    return c.id;
  };
  const terminal = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ReachRefusal) throw new restate.TerminalError(err.message);
      throw err;
    }
  };
  const nowOf = (ctx: restate.Context) => nowFor(ctx, deps.clock);
  /** Wren's database, or a client's own (its logins' rows). */
  const dbOf = (client: string | null | undefined): Db => {
    if (!client) return deps.db;
    if (!deps.clients) throw new restate.TerminalError("no client databases here");
    return deps.clients.clientDb(client);
  };
  const slots = slotsOf(deps.sequences.values());
  const nudge = (ctx: restate.Context) =>
    ctx
      .objectSendClient<{ sync: (c: restate.ObjectContext) => Promise<unknown> }>(
        { name: "ReachSender" },
        SENDER_KEY,
      )
      .sync();
  /**
   * One comment answered in its thread, as the account that read it, or through `Content.reply`
   * on our own post. `body` null: the draft. Sent now: the click is the yes.
   */
  /** Unsure waits on a person; any other failure as the handler throws it. */
  const failed = (err: unknown): never => {
    throw isSendUnsure(err) ? err : sendError(err);
  };
  const answerOne = async (
    ctx: restate.Context,
    id: number,
    given: string | null,
    by: ReturnType<typeof byOf>,
    again = false,
  ): Promise<{ ref: string | null }> => {
    const now = await nowOf(ctx);
    const plan = await ctx.run("plan", () => terminal(() => planAnswer(deps.db, id, now)));
    const words = (given ?? plan.comment.draft ?? "").trim();
    if (!words) throw new restate.TerminalError("the answer is empty");
    // Answered, and words that differ from the draft kept as his edit.
    const item = `comment:${id}`;
    const answered = (tx: Queryable, sent: Landed) =>
      recordLanded(tx, item, { ref: sent.ref, now, by });
    if (!plan.account) {
      // On our own post: the content channel answers (designs/2026-10-06-social-inbox.md).
      const { target, text } = answerFor(plan.comment, words);
      const platform = plan.comment.platform;
      const sent = await sendAtMostOnce(ctx, deps.db, {
        item,
        platform,
        account: null,
        words: text,
        target,
        url: plan.comment.url,
        again,
        send: async () => {
          // The key crosses to `Content`, which runs the write under it and answers a Delivery.
          await sendAcross((k) =>
            ctx.serviceClient<ContentReply>({ name: "Content" }).reply({
              platform,
              commentId: target,
              // LinkedIn names a member comment by its post and its bare id.
              postId: plan.comment.post,
              text,
              ...k,
            }),
          );
          return { ref: null };
        },
        landed: answered,
      }).catch(failed);
      scheduleProofs(ctx, item);
      return { ref: sent.ref };
    }
    const ch = channelsFor(deps, ctx)(plan.account);
    const comment = ch?.comment;
    if (!ch || !comment) throw new restate.TerminalError("this site can't answer comments");
    const to = plan.comment.ref;
    const sent = await sendAtMostOnce(ctx, deps.db, {
      item,
      platform: plan.account.platform,
      account: plan.account.account,
      words,
      target: to,
      url: plan.comment.url,
      again,
      before: async () => {
        const authors = (await ch.threadAuthors?.(plan.comment.post)) ?? [];
        await terminal(async () => checkThread(authors, plan.others));
      },
      send: () => comment(to, words),
      landed: answered,
    }).catch(failed);
    scheduleProofs(ctx, item);
    wakeWatch(ctx);
    return { ref: sent.ref };
  };
  return { deps, invite, terminal, nowOf, dbOf, slots, nudge, failed, answerOne };
}

export type DeskContext = ReturnType<typeof deskContext>;
