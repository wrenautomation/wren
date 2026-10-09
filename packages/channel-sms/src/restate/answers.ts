/**
 * The restate side of missed-call text back and review requests
 * (designs/2026-10-07-missed-call-and-reviews.md). `callHooks` is what SmsEvents does with a
 * missed call and with a texted-back caller's reply; `makeReviews` counts a review link's
 * clicks, keeps the private feedback and stops a review email's address, for the phone Worker's
 * `/r/` pages.
 */
import * as restate from "@restatedev/restate-sdk";
import { findClient } from "@wren/core/clients";
import { serviceHandler } from "@wren/core/restate";
import { liveFor, spineEmit } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { z } from "zod";
import { callReplied, missedCallEvent, runOfCall } from "../missed.js";
import { clickReview, saveFeedback, stopReview } from "../reviews.js";

export const MISSED_FLOW = "missed_call.steps";
export const REVIEWS_FLOW = "reviews.steps";
const SPEED_FLOW = "speed_to_lead.steps";

/** What SmsEvents does after a call event or a reply, beside the reply trigger. */
export interface CallHooks {
  /** A call nobody picked up: into the client's missed-call workflow, if it's live. */
  missed(ctx: restate.Context, client: string | null, callId: number): void;
  /** A reply: a texted-back caller's call marked replied, and on to speed to lead if live. */
  replied(ctx: restate.Context, client: string | null, contactId: number): Promise<void>;
}

/** Wren's own calls enter nothing: the templates install per client. */
export function callHooks(d: { main: Db; clientDb(id: string): Db }): CallHooks {
  return {
    missed: (ctx, client, callId) => {
      if (client === null) return;
      spineEmit(ctx, {
        client,
        workflow: MISSED_FLOW,
        from: "in.calls",
        events: [missedCallEvent(callId)],
        onlyLive: true,
      });
    },
    replied: async (ctx, client, contactId) => {
      if (client === null) return;
      const db = d.clientDb(client);
      const now = new Date(await ctx.date.now());
      const call = await ctx.run("call replied", () => callReplied(db, contactId, now));
      if (!call) return;
      const live = await ctx.run("speed live", () => liveFor(d.main, client, SPEED_FLOW));
      if (!live) return;
      const run = await ctx.run("speed run", async () => {
        const r = await runOfCall(db, SPEED_FLOW, call, now);
        return r ? r.id : null;
      });
      if (run === null) return;
      // As if speed to lead's first text had just gone: Call now after its wait, the follow-up.
      spineEmit(ctx, {
        client,
        workflow: SPEED_FLOW,
        from: "text.texted",
        events: [
          {
            subject: `lead:sms:${contactId}`,
            kind: "lead",
            data: { run, contactId, source: "missed call" },
          },
        ],
        onlyLive: true,
      });
    },
  };
}

const CLICK = z.object({
  client: z.string().min(1).max(40).describe("Client"),
  token: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,32}$/)
    .describe("Link token"),
});
const FEEDBACK = CLICK.extend({
  words: z.string().trim().min(1).max(4000).describe("Feedback"),
});

/**
 * `Reviews`: the counted link and the feedback form behind each review ask. Public: the phone
 * Worker calls it for anyone who opens a link. An unknown client or token answers null.
 */
export function makeReviews(d: { main: Db; clientDb(id: string): Db }) {
  const known = (ctx: restate.Context, client: string) =>
    ctx.run("client", async () => (await findClient(d.main, client)) !== null);
  return restate.service({
    name: "Reviews",
    handlers: {
      /** One click: counted, and the Google review form it goes on to. */
      click: serviceHandler(
        { input: CLICK },
        async (
          ctx: restate.Context,
          req: z.infer<typeof CLICK>,
        ): Promise<{ to: string | null }> => {
          if (!(await known(ctx, req.client))) return { to: null };
          const now = new Date(await ctx.date.now());
          const to = await ctx.run("click", () =>
            clickReview(d.clientDb(req.client), req.token, now),
          );
          return { to };
        },
      ),
      /** The private feedback form's words, kept on the ask. */
      feedback: serviceHandler(
        { input: FEEDBACK },
        async (ctx: restate.Context, req: z.infer<typeof FEEDBACK>): Promise<{ ok: boolean }> => {
          if (!(await known(ctx, req.client))) return { ok: false };
          const now = new Date(await ctx.date.now());
          const ok = await ctx.run("feedback", () =>
            saveFeedback(d.clientDb(req.client), req.token, req.words, now),
          );
          return { ok };
        },
      ),
      /** A review email's stop link (the page's button or a one-click unsubscribe). */
      stop: serviceHandler(
        { input: CLICK },
        async (ctx: restate.Context, req: z.infer<typeof CLICK>): Promise<{ ok: boolean }> => {
          if (!(await known(ctx, req.client))) return { ok: false };
          const now = new Date(await ctx.date.now());
          const ok = await ctx.run("stop", () =>
            stopReview(d.clientDb(req.client), req.token, now),
          );
          return { ok };
        },
      ),
    },
  });
}
