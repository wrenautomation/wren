/**
 * `ReachDesk`'s Reddit handlers: watch, skip or move a place; comment in or skip a queued thread.
 * The RedditReads loop that found places and drafted threads is cut (2026-11-04 stripdown).
 */
import * as restate from "@restatedev/restate-sdk";
import { byOf } from "@wren/core/ask";
import { serviceHandler } from "@wren/core/restate";
import { ReachRefusal, recordLanded } from "@wren/starling-acts";
import {
  isSendNotSent,
  isSendUnsure,
  type Landed,
  sendAtMostOnce,
  sendError,
} from "@wren/starling-acts/restate";
import { z } from "zod";
import { movePlace, skipPlace, watchPlace } from "../discovery/places.js";
import { ThreadHeld } from "../discovery/requirements.js";
import { planThreadComment, skipThread } from "../discovery/threads.js";
import { reachKinds } from "../item-kinds.js";
import { sendFailed, sendHeld, stillDue, unschedule } from "../scheduled.js";
import { channelsFor, type ReachDeps, terminalWhy, wakeWatch } from "./index.js";
import { scheduleProofs } from "./proofs.js";

const SUB = z.looseObject({ subreddit: z.string() });
const MOVE = SUB.extend({ account: z.string().describe("reddit@alt, or the handle") });
const THREAD = z.looseObject({ id: z.string() });
const COMMENT = THREAD.extend({
  body: z.string().nullish().describe("The words; the console leaves an untouched draft out"),
  at: z.iso
    .datetime()
    .nullish()
    .describe("The scheduler's slot; one moved or cleared sends nothing"),
});

/** The desk's Reddit handlers, bound on ReachDesk. */
export function redditHandlers(deps: ReachDeps) {
  const terminal = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ReachRefusal) throw new restate.TerminalError(err.message);
      throw err;
    }
  };
  const nowOf = async (ctx: restate.Context) =>
    deps.clock ? deps.clock() : new Date(await ctx.date.now());
  return {
    /** Watch a place, from the pool account it gets. */
    watchPlace: serviceHandler(
      { input: SUB },
      async (ctx: restate.Context, req: { subreddit: string }) => {
        const now = await nowOf(ctx);
        return ctx.run("watch", () => terminal(() => watchPlace(deps.db, req.subreddit, now)));
      },
    ),
    skipPlace: serviceHandler(
      { input: SUB },
      async (ctx: restate.Context, req: { subreddit: string }): Promise<void> => {
        await ctx.run("skip", () => skipPlace(deps.db, req.subreddit));
      },
    ),
    movePlace: serviceHandler(
      { input: MOVE },
      async (ctx: restate.Context, req: { subreddit: string; account: string }): Promise<void> => {
        // The input names it `account` (MOVE); `accountId` was always undefined here.
        await ctx.run("move", () => terminal(() => movePlace(deps.db, req.subreddit, req.account)));
      },
    ),
    /** Comment in a queued thread from its place's account. Sent now: the click is the yes. */
    commentThread: serviceHandler(
      { input: COMMENT, effect: "sends" },
      async (
        ctx: restate.Context,
        req: { id: string; body?: string | null; at?: string | null; again?: boolean },
      ): Promise<{ ref: string | null; held?: string }> => {
        const now = await nowOf(ctx);
        const at = req.at;
        if (at && !(await ctx.run("due", () => stillDue(deps.db, "thread", req.id, at))))
          return { ref: null, held: "taken off the schedule" };
        // A sub whose floor we don't meet holds the comment: queued, not dropped, not sent.
        const planned = await ctx.run("plan", async () => {
          try {
            return { plan: await planThreadComment(deps.db, req.id, now) };
          } catch (err) {
            if (err instanceof ThreadHeld) return { held: err.message };
            if (err instanceof ReachRefusal) throw new restate.TerminalError(err.message);
            throw err;
          }
        });
        if ("held" in planned) {
          if (!at) throw new restate.TerminalError(planned.held);
          await ctx.run("hold", () => unschedule(deps.db, { threads: [req.id] }));
          return { ref: null, held: planned.held };
        }
        const plan = planned.plan;
        const body = (req.body ?? plan.thread.draft ?? "").trim();
        if (!body) throw new restate.TerminalError("the comment is empty");
        const ch = channelsFor(deps, ctx)(plan.account);
        const comment = ch?.comment;
        if (!ch || !comment) throw new restate.TerminalError("this account can't comment");
        const target = plan.thread.target ?? plan.thread.id;
        let sent: Landed;
        try {
          // At most once (designs/2026-10-16-send-verdicts.md): the send runs under the ledger
          // row's key, and autobrowse says whether it went out. A take-over asks the same key.
          sent = await sendAtMostOnce(ctx, deps.db, {
            item: `thread:${req.id}`,
            platform: "reddit",
            account: plan.account.account,
            words: body,
            target,
            url: plan.thread.url,
            again: req.again === true,
            // The guard again at send: none of ours may already be in the thread.
            before: async () => {
              const authors = (await ch.threadAuthors?.(plan.thread.id)) ?? [];
              const met = plan.others.find((o) =>
                authors.some((a) => a.toLowerCase() === o.toLowerCase()),
              );
              if (met) throw new restate.TerminalError(`u/${met} already wrote in this thread`);
            },
            send: () => comment(target, body),
            landed: (tx, landed) =>
              recordLanded(tx, `thread:${req.id}`, reachKinds, {
                ref: landed.ref,
                now,
                by: byOf(req),
              }),
          });
        } catch (thrown) {
          // Unsure waits on a person in To approve; its slot leaves the schedule.
          if (isSendUnsure(thrown)) {
            if (at) await ctx.run("hold", () => unschedule(deps.db, { threads: [req.id] }));
            throw thrown;
          }
          // Nothing went out: the slot leaves the schedule and the next pass sends it anew.
          if (isSendNotSent(thrown)) {
            if (at)
              await ctx.run("hold", () => sendHeld(deps.db, "thread", req.id, thrown.message));
            throw thrown;
          }
          const err = sendError(thrown);
          if (at && err instanceof restate.TerminalError)
            await ctx.run("send failed", () => sendFailed(deps.db, "thread", req.id, err.message));
          throw err;
        }
        scheduleProofs(ctx, `thread:${req.id}`);
        wakeWatch(ctx);
        return { ref: sent.ref };
      },
    ),
    skipThread: serviceHandler(
      { input: THREAD },
      async (ctx: restate.Context, req: { id: string; reason?: unknown; note?: unknown }) => {
        const why = terminalWhy(req);
        await ctx.run("skip", () => skipThread(deps.db, req.id, { by: byOf(req), ...why }));
      },
    ),
  };
}
