/** `ReachDesk`'s comments: answered in their thread, read again, armed, DMed, dropped. */
import * as restate from "@restatedev/restate-sdk";
import { byOf } from "@wren/core/ask";
import { serviceHandler } from "@wren/core/restate";
import { sendAcross } from "@wren/core/send-verdict";
import { spineEmit } from "@wren/core/spine";
import { z } from "zod";
import { listAccounts } from "../accounts.js";
import {
  COMMENTS_FLOW,
  COMMENTS_FROM,
  commentById,
  commentEvent,
  dmCommenter,
  dropComment,
  planAnswer,
  planPrivateReply,
  privateReplied,
} from "../comments.js";
import { pickAccount } from "../draft-accounts.js";
import {
  adoptNode,
  applyThread,
  asThread,
  focusesOf,
  mergeReads,
  threadFor,
  wrenCommentsRead,
} from "../follow-ups.js";
import { type ContentReply, channelsFor, finalRefusal } from "./deps.js";
import { type DeskContext, terminalWhy } from "./desk-context.js";
import { sendAtMostOnce } from "./maybe-sent.js";

const COMMENT = z.looseObject({ id: z.number() });

/** `SocialDesk/readPost` (@wren/content, which imports this package). */
type PostReads = {
  readPost: (ctx: restate.Context, req: { id: number }) => Promise<{ read: boolean }>;
};

const ANSWER = COMMENT.extend({
  body: z.string().nullish().describe("The words; the console leaves an untouched draft out"),
});

const DM = COMMENT.extend({
  body: z.string(),
  again: z.boolean().optional().describe("Send again after a person said it did not go out"),
});

const THREAD_REPLY = COMMENT.extend({
  ref: z.string().min(1).max(200).describe("The platform id of the comment to reply to"),
  body: z.string().nullish().describe("The words"),
  account: z.string().nullish().describe("The account it goes out as; none: the default"),
});

export function commentsHandlers(desk: DeskContext) {
  const { deps, terminal, nowOf, nudge, failed, answerOne } = desk;
  return {
    /**
     * Answer a comment in its thread, as the account that read it, or through `Content.reply` on
     * our own post. Sent now: the click is the yes.
     */
    answerComment: serviceHandler(
      { input: ANSWER, effect: "sends" },
      (ctx: restate.Context, req: { id: number; body?: string | null; again?: boolean }) =>
        answerOne(ctx, req.id, req.body ?? null, byOf(req), req.again === true),
    ),
    /**
     * Reply to any comment in a thread's conversation (designs/2026-10-15-engage-threads.md):
     * one the inbox kept, or one only the thread read saw, kept now so it answers like any
     * other. `id` is the row the conversation was opened from; `account`, a Send as pick.
     */
    replyInThread: serviceHandler(
      { input: THREAD_REPLY, effect: "sends" },
      async (
        ctx: restate.Context,
        req: { id: number; ref: string; body?: string | null; account?: string | null },
      ): Promise<{ id: number; ref: string | null }> => {
        const target = await ctx.run("target", () =>
          terminal(() => adoptNode(deps.db, req.id, req.ref)),
        );
        if (req.account)
          await ctx.run("send as", () =>
            terminal(() =>
              pickAccount(deps.db, {
                item: `comment:${target}`,
                account: req.account ?? null,
                by: byOf(req),
              }),
            ),
          );
        const sent = await answerOne(ctx, target, req.body ?? null, byOf(req));
        return { id: target, ...sent };
      },
    ),
    /** Read a thread's conversation again now, on the reads budget: the context view's refresh. */
    readThread: serviceHandler(
      { input: ANSWER },
      async (ctx: restate.Context, req: { id: number }): Promise<{ read: boolean }> => {
        const now = await nowOf(ctx);
        const found = await ctx.run("thread", () =>
          terminal(() => threadFor(deps.db, req.id, now)),
        );
        // A comment on our own post: SocialDesk reads that post's comments again.
        if (!found)
          return ctx.serviceClient<PostReads>({ name: "SocialDesk" }).readPost({ id: req.id });
        const got = { ...found, thread: asThread(found.thread) };
        const a = got.account;
        const ch = channelsFor(deps, ctx)(a);
        if (!ch?.thread) return { read: false };
        const ours = await ctx.run("ours", async () =>
          (await listAccounts(deps.db)).flatMap((x) => (x.handle ? [x.handle] : [])),
        );
        let read = await ch.thread(got.thread.post).catch((err) => {
          throw finalRefusal(err);
        });
        if (read.more > 0)
          for (const focus of focusesOf(read, ours))
            read = mergeReads(read, [await ch.thread(got.thread.post, focus)]);
        const r = ctx.rand.random();
        const days = await ctx.run("follow-up days", async () =>
          Math.max(1, (await wrenCommentsRead(deps.db)).followUpDays),
        );
        const applied = await ctx.run("apply", () =>
          applyThread(deps.db, got.thread, a, read, ours, now, r, days),
        );
        if (applied.kept.length)
          spineEmit(ctx, {
            client: null,
            workflow: COMMENTS_FLOW,
            from: COMMENTS_FROM,
            events: applied.kept.map(commentEvent),
          });
        return { read: true };
      },
    ),
    /**
     * Warm `answerComment` while it waits on a yes: on our own post, `Content.arm` runs its
     * browser leg to the reply box. A reach account's answer is not armed. Never fails.
     */
    armComment: serviceHandler(
      { input: ANSWER },
      async (
        ctx: restate.Context,
        req: { id: number; body?: string | null },
      ): Promise<{ armed: boolean }> => {
        const now = await nowOf(ctx);
        // A comment that can't be answered now arms nothing; the yes says why.
        const plan = await ctx.run("plan", () =>
          planAnswer(deps.db, req.id, now).catch(() => null),
        );
        const text = (req.body ?? plan?.comment.draft ?? "").trim();
        if (!plan || plan.account || !text) return { armed: false };
        return ctx.serviceClient<ContentReply>({ name: "Content" }).arm({
          platform: plan.comment.platform,
          commentId: plan.comment.ref,
          postId: plan.comment.post,
          text,
        });
      },
    ),
    /**
     * One DM to the comment's author through its door (`dmDoorOf`): on our own Instagram or
     * Facebook post, Meta's private reply now; on a reach inbox, queued for the sender (its
     * window and caps); anywhere else refused with what to do instead.
     */
    dmComment: serviceHandler(
      { input: DM, effect: "sends" },
      async (
        ctx: restate.Context,
        req: { id: number; body: string; again?: boolean },
      ): Promise<{ contactId: number; messageId: number }> => {
        const now = await nowOf(ctx);
        const body = req.body.trim();
        if (!body) throw new restate.TerminalError("the message is empty");
        const c = await ctx.run("comment", () => terminal(() => commentById(deps.db, req.id)));
        if (!c.accountId) {
          await ctx.run("plan", () => terminal(() => planPrivateReply(deps.db, req.id, now)));
          // At most once (designs/2026-10-16-send-verdicts.md): the private reply runs under
          // the ledger row's key; autobrowse says whether it went out.
          const sent = await sendAtMostOnce(ctx, deps.db, {
            item: `private:${c.id}`,
            platform: c.platform,
            account: null,
            words: body,
            target: c.ref,
            url: c.url,
            again: req.again === true,
            send: () =>
              sendAcross<{ ref: string | null }>((k) =>
                ctx
                  .serviceClient<ContentReply>({ name: "Content" })
                  .privateReply({ platform: c.platform, commentId: c.ref, text: body, ...k }),
              ),
          }).catch(failed);
          return ctx.run("sent", () =>
            privateReplied(deps.db, c, { body, ref: sent.ref, now, by: byOf(req) }),
          );
        }
        const r = await ctx.run("queue", () =>
          terminal(() => dmCommenter(deps.db, { id: req.id, body: req.body, now })),
        );
        nudge(ctx);
        return r;
      },
    ),
    dropComment: serviceHandler(
      { input: COMMENT },
      async (ctx: restate.Context, req: { id: number; reason?: unknown; note?: unknown }) => {
        const why = terminalWhy(req);
        await ctx.run("drop", () => dropComment(deps.db, req.id, { by: byOf(req), ...why }));
      },
    ),
  };
}
