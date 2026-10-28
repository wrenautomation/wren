/** `ReachDesk`'s posts to comment on: the comment, a like or follow, passes, skips, redrafts, the list, the pass now. */
import * as restate from "@restatedev/restate-sdk";
import { byOf } from "@wren/core/ask";
import { PASS_REASONS, type PassReason } from "@wren/core/pass-reasons";
import { errorText, NO_INPUT, serviceHandler } from "@wren/core/restate";
import { sendAcross } from "@wren/core/send-verdict";
import { z } from "zod";
import { pickedAccount } from "../draft-accounts.js";
import { liftPass, listPasses, passOn } from "../passes.js";
import {
  listPosts,
  markPostActed,
  markPostCommented,
  ownCircle,
  planPostAct,
  planPostComment,
  postActs,
  skipPost,
} from "../reach-posts/acts.js";
import { type RedraftResult, redraftPosts } from "../reach-posts/draft.js";
import type { PostsStats } from "../reach-posts/pass.js";
import { allCommentsSettings, COMMENT_MAX, commentsSettings } from "../reach-posts/settings.js";
import { sendFailed, sendHeld, stillDue, unschedule } from "../scheduled.js";
import { REACH_POST_PLATFORMS } from "../schema.js";
import type { ContentReply } from "./deps.js";
import { type DeskContext, terminalWhy } from "./desk-context.js";
import { isSendNotSent, isSendUnsure, sendAtMostOnce, sendError } from "./maybe-sent.js";
import { scheduleProofs } from "./proofs.js";
import { postsFor } from "./watch.js";

const POST = z.looseObject({
  id: z.number().int(),
  body: z.string().nullish().describe("The words; the console leaves an untouched draft out"),
  at: z.iso
    .datetime()
    .nullish()
    .describe("The scheduler's slot; one moved or cleared sends nothing"),
});

const POST_ACT = z.looseObject({
  id: z.number().int(),
  act: z.enum(["like", "follow"]).describe("Like the post, or follow its author"),
});

const POST_IDS = z.looseObject({ ids: z.array(z.number().int()).min(1).max(100) });

const PASS = z.looseObject({
  ids: z
    .array(z.string().regex(/^(comment|onpost|thread|dm):\S+$/))
    .min(1)
    .max(200)
    .describe("Engage ids: comment:4, onpost:9, thread:t3_x, dm:3"),
  reason: z
    .enum(PASS_REASONS)
    .describe("Why: not_lead, not_worth, spam, competitor, rude, not_now"),
  note: z.string().max(280).nullish(),
});

const LIFT = z.looseObject({ platform: z.string().min(1), handle: z.string().min(1) });

const POSTS_LIST = z
  .looseObject({ state: z.string().nullish(), limit: z.number().nullish() })
  .nullish();

export function postsHandlers(desk: DeskContext) {
  const { deps, terminal, nowOf } = desk;
  return {
    /**
     * Comment on someone else's post: his words, or the draft he left untouched. The click is
     * the yes. LinkedIn and X go through the content channel as Wren's page; Instagram through
     * the settings' account. Then the like and follow the settings ask for, as that account;
     * neither fails the comment.
     */
    commentPost: serviceHandler(
      { input: POST, effect: "sends" },
      async (
        ctx: restate.Context,
        req: { id: number; body?: string | null; at?: string | null; again?: boolean },
      ): Promise<{ commented: number; held?: string }> => {
        const now = await nowOf(ctx);
        const at = req.at;
        if (at && !(await ctx.run("due", () => stillDue(deps.db, "post", String(req.id), at))))
          return { commented: 0, held: "taken off the schedule" };
        const post = await ctx.run("plan", () => terminal(() => planPostComment(deps.db, req.id)));
        const body = (req.body ?? post.draft ?? "").trim();
        if (!body) throw new restate.TerminalError("the comment is empty");
        const max = COMMENT_MAX[post.platform];
        if (body.length > max)
          throw new restate.TerminalError(`${post.platform} takes ${max} characters at most`);
        const settings = await ctx.run("settings", () => commentsSettings(deps.db, post.platform));
        // A person's pick on the draft, else the comments settings' account.
        const picked = await ctx.run("account", () => pickedAccount(deps.db, `onpost:${post.id}`));
        const account = picked || settings.account || null;
        const acts = postActs(post, settings, body);
        const sites = deps.sitesFor(ctx);
        const item = `onpost:${post.id}`;
        try {
          if (acts.comment && !account)
            throw new restate.TerminalError(`no ${post.platform} account is set for comments`);
          const viaSite = acts.comment;
          // At most once (designs/2026-10-16-send-verdicts.md). Instagram's comment goes
          // through the site, LinkedIn and X through `Content.reply`; both run under the
          // ledger row's key, and autobrowse says whether it went out.
          await sendAtMostOnce(ctx, deps.db, {
            item,
            platform: post.platform,
            account,
            words: body,
            target: post.ref,
            url: post.url,
            again: req.again === true,
            send: async () => {
              if (viaSite) {
                const [site, method, path, input] = viaSite;
                await sites.call(site, method, path, input, account ?? undefined);
              } else
                await sendAcross((k) =>
                  ctx
                    .serviceClient<ContentReply>({ name: "Content" })
                    .reply({ platform: post.platform, commentId: post.ref, text: body, ...k }),
                );
              return { ref: null };
            },
          });
        } catch (thrown) {
          if (isSendUnsure(thrown)) {
            if (at) await ctx.run("hold", () => unschedule(deps.db, { posts: [post.id] }));
            throw thrown;
          }
          // Nothing went out: the slot leaves the schedule and the next pass sends it anew.
          if (isSendNotSent(thrown)) {
            if (at)
              await ctx.run("hold", () =>
                sendHeld(deps.db, "post", String(req.id), thrown.message),
              );
            throw thrown;
          }
          const err = sendError(thrown);
          // A slot that fails for good leaves the schedule, or it would sit queued forever.
          if (at && err instanceof restate.TerminalError)
            await ctx.run("send failed", () =>
              sendFailed(deps.db, "post", String(req.id), err.message, err.code),
            );
          throw err;
        }
        await ctx.run("commented", () =>
          markPostCommented(deps.db, post, { body, by: byOf(req), now }),
        );
        scheduleProofs(ctx, item);
        for (const [what, act] of [
          ["like", acts.like],
          ["follow", acts.follow],
        ] as const) {
          if (!act || !account) continue;
          try {
            const [site, method, path, input] = act;
            await sites.call(site, method, path, input, account);
            await ctx.run(what, () => markPostActed(deps.db, post.id, what, now));
          } catch (err) {
            console.warn(`post ${post.id} ${what}: ${errorText(err)}`);
          }
        }
        return { commented: post.id };
      },
    ),
    /**
     * A like on the post or a follow of its author on its own, as the comments settings'
     * account: the click is the yes. A touch like the one that goes with a comment.
     */
    actOnPost: serviceHandler(
      { input: POST_ACT, effect: "sends" },
      async (
        ctx: restate.Context,
        req: { id: number; act: "like" | "follow" },
      ): Promise<{ id: number; act: "like" | "follow" }> => {
        const now = await nowOf(ctx);
        const post = await ctx.run("plan", () =>
          terminal(() => planPostAct(deps.db, req.id, req.act)),
        );
        const settings = await ctx.run("settings", () => commentsSettings(deps.db, post.platform));
        if (!settings.account)
          throw new restate.TerminalError(`no ${post.platform} account is set for comments`, {
            errorCode: 409,
          });
        const acts = postActs(post, { like: req.act === "like", follow: req.act === "follow" }, "");
        const act = acts[req.act];
        if (!act)
          throw new restate.TerminalError(
            ownCircle(post)
              ? "a UWaterloo student: no follow or like on Instagram or Threads"
              : "that post's author has no handle to follow",
            {
              errorCode: 409,
            },
          );
        const [site, method, path, input] = act;
        await deps.sitesFor(ctx).call(site, method, path, input, settings.account);
        await ctx.run(req.act, () => markPostActed(deps.db, post.id, req.act, now));
        return { id: post.id, act: req.act };
      },
    ),
    /** His no on posts to comment on. */
    /** Pass on the people behind these rows: theirs close now and land closed later. */
    passOn: serviceHandler(
      { input: PASS },
      async (
        ctx: restate.Context,
        req: { ids: string[]; reason: PassReason; note?: string | null },
      ): Promise<{ people: number; closed: number }> => {
        const now = await nowOf(ctx);
        const by = (req as { viewer?: { email?: string } }).viewer?.email ?? byOf(req);
        return ctx.run("pass", () =>
          passOn(deps.db, req.ids, { reason: req.reason, note: req.note ?? null, by, now }),
        );
      },
    ),
    liftPass: serviceHandler(
      { input: LIFT },
      async (ctx: restate.Context, req: { platform: string; handle: string }) => {
        const now = await nowOf(ctx);
        return {
          lifted: await ctx.run("lift", () => liftPass(deps.db, req.platform, req.handle, now)),
        };
      },
    ),
    passes: serviceHandler({ input: z.looseObject({}).nullish() }, async (ctx: restate.Context) =>
      ctx.run("passes", () => listPasses(deps.db)),
    ),
    skipPost: serviceHandler(
      { input: POST_IDS },
      async (
        ctx: restate.Context,
        req: { ids: number[]; by?: unknown; reason?: unknown; note?: unknown },
      ): Promise<{ skipped: number[] }> => {
        const why = terminalWhy(req);
        // The portal's viewer when there is one; else who the CLI names.
        const by =
          (req as { viewer?: { email?: string } }).viewer?.email ??
          (typeof req.by === "string" && req.by.trim() ? req.by.trim().slice(0, 200) : byOf(req));
        return {
          skipped: await ctx.run("skip", () => skipPost(deps.db, req.ids, { by, ...why })),
        };
      },
    ),
    /**
     * Write queued drafts again from the posts kept at read time (no platform read): ranked
     * again, guarded, and the new words replace the old in To approve. One now off target, or
     * one the guard drops, leaves To approve.
     */
    redraftPosts: serviceHandler(
      { input: POST_IDS },
      async (ctx: restate.Context, req: { ids: number[] }): Promise<RedraftResult> => {
        const llm = deps.drafts?.llm;
        if (!llm) throw new restate.TerminalError("no model is set for drafts");
        const now = await nowOf(ctx);
        const settings = await ctx.run("settings", () => allCommentsSettings(deps.db));
        const guide = deps.drafts?.commentGuide;
        const guides = guide
          ? await ctx.run("guides", async () =>
              Object.fromEntries(
                await Promise.all(REACH_POST_PLATFORMS.map(async (p) => [p, await guide(p)])),
              ),
            )
          : {};
        const facts = deps.drafts?.facts;
        const truths = facts ? await ctx.run("facts", async () => [...(await facts())]) : [];
        const oursOf = deps.drafts?.ours;
        const ours = oursOf ? await ctx.run("our posts", async () => [...(await oursOf())]) : [];
        const out: RedraftResult = { redrafted: [], dropped: [], skipped: [] };
        // One step a post: a retry after a crash does not ask the model twice for one done.
        for (const id of [...new Set(req.ids)]) {
          const r = await ctx.run(`redraft ${id}`, () =>
            redraftPosts(deps.db, llm, [id], {
              settings,
              guides,
              facts: truths,
              ours,
              ...(deps.drafts?.voice ? { voice: deps.drafts.voice } : {}),
              now,
            }),
          );
          out.redrafted.push(...r.redrafted);
          out.dropped.push(...r.dropped);
          out.skipped.push(...r.skipped);
        }
        return out;
      },
    ),
    /** Posts to comment on, newest first; a state narrows them. */
    posts: serviceHandler(
      { input: POSTS_LIST },
      async (ctx: restate.Context, req?: { state?: string | null; limit?: number | null }) =>
        ctx.run("posts", () =>
          listPosts(deps.db, {
            ...(req?.state ? { state: req.state } : {}),
            ...(req?.limit ? { limit: req.limit } : {}),
          }),
        ),
    ),
    /** The posts pass now on each platform with an account set: read, rank, draft to the cap. */
    postsNow: serviceHandler(
      { input: NO_INPUT },
      async (ctx: restate.Context): Promise<PostsStats[]> => {
        const now = await nowOf(ctx);
        const all = await ctx.run("settings", () => allCommentsSettings(deps.db));
        const out: PostsStats[] = [];
        for (const platform of REACH_POST_PLATFORMS)
          if (all[platform].account)
            out.push(await postsFor(deps, ctx, platform, all[platform], now));
        return out;
      },
    ),
  };
}
