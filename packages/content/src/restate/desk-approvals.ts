/** ContentDesk handlers for verdicts: approve, settle, approve a video, pick a thumbnail, reject. */
import * as restate from "@restatedev/restate-sdk";
import { byOf } from "@wren/core/ask";
import type { Platform, Post, Published } from "@wren/core/content";
import { ShapeError } from "@wren/core/content/shapes";
import { REJECT_REASONS, rejectWhy } from "@wren/core/draft-record";
import { clientKey, clientOfKey, exclusiveHandler, PORTAL_FIELDS } from "@wren/core/restate";
import { isDelivery } from "@wren/core/send-verdict";
import {
  forgetUnsure,
  SETTLE_OUTCOMES,
  type SettleOutcome,
  settleSent,
  unsureItem,
} from "@wren/outreach";
import { z } from "zod";
import { POSTS_UNIT } from "../components.js";
import { postedLinks } from "../funnel.js";
import { postOf } from "../platforms.js";
import { dropDraft, markPostedBy, sendAgain } from "../queue.js";
import { approveDrafts, getDraft, rejectDrafts } from "../review.js";
import { approveVideo, pickThumbnail, VIDEO_PRIVACY, type VideoPrivacy } from "../video.js";
import { afterPublish, type ReplyService } from "./after-publish.js";
import { type ContentDeskContext, verdict, verdictOf } from "./desk-context.js";

const VIDEO = z.looseObject({
  id: z.number().int().positive().describe("The video (wren video list)"),
  short: z
    .number()
    .int()
    .positive()
    .nullish()
    .describe("A Short, 1 for the first; none: the long video"),
  vertical: z.boolean().nullish().describe("The whole cut, 9:16, instead of the long video"),
  privacy: z.enum(VIDEO_PRIVACY).nullish().describe("Who sees the upload; none: private"),
  replace: z
    .boolean()
    .nullish()
    .describe("The long video is up already: upload this render as a new video"),
  publishAt: z
    .string()
    .nullish()
    .describe("When YouTube makes it public (ISO); it uploads now, private until then"),
});

const THUMBNAIL = z.looseObject({
  id: z.number().int().positive(),
  n: z.number().int().positive().describe("Which rendered thumbnail, 1 for the first"),
});

const IDS = z.looseObject({
  ids: z.array(z.string()).describe("Draft ids"),
  viewer: PORTAL_FIELDS.viewer,
});

const APPROVE = IDS.extend({
  now: z.boolean().nullish().describe("On the next pass instead of the next slot"),
  at: z.iso.datetime({ offset: true }).nullish().describe("Post at this time instead (ISO)"),
  expect: z
    .string()
    .nullish()
    .describe("For one draft: the version on screen; a change since refuses it"),
});

const SETTLE_POST = z.looseObject({
  id: z.string().describe("The draft that may have gone out"),
  outcome: z
    .enum(SETTLE_OUTCOMES)
    .describe("He saw it up, it should go out once more, or it did not go out and stays out"),
  by: z.string().describe("Who decides"),
});

/** `Content/publish` as the core serves it. `verifyOnly` asks the stored verdict and never writes. */
type ContentPublish = {
  publish: (
    ctx: restate.Context,
    req: {
      platform: Platform;
      post: Post;
      client?: string;
      account?: string | null;
      sendKey: string;
      recheck: true;
      verifyOnly: true;
    },
  ) => Promise<unknown>;
};

/**
 * The post, if autobrowse's verdict under its send key says it is up: sent or found. Any other
 * answer (not sent, unknown, a refusal, an error) is null and leaves the person's word.
 */
async function askVerdict(
  ctx: restate.Context,
  platform: Platform,
  ask: { post: Post; client: string | null; account: string | null; sendKey: string },
): Promise<Published | null> {
  try {
    const got = await ctx.serviceClient<ContentPublish>({ name: "Content" }).publish({
      platform,
      post: ask.post,
      ...(ask.client ? { client: ask.client } : {}),
      ...(ask.account ? { account: ask.account } : {}),
      sendKey: ask.sendKey,
      recheck: true,
      verifyOnly: true,
    });
    if (!isDelivery(got)) return null;
    if (got.kind === "sent") {
      const out = (got.out ?? {}) as Partial<Published>;
      return {
        id: out.id || "",
        url: out.url || "",
        publishedAt: out.publishedAt ?? new Date(await ctx.date.now()).toISOString(),
        fetchedWith: "api",
      };
    }
    if (got.kind === "found")
      return { id: got.id ?? "", url: got.url ?? "", publishedAt: got.at, fetchedWith: "api" };
    return null;
  } catch (err) {
    if (err instanceof restate.TerminalError) return null;
    throw err;
  }
}

/** The loop that posts it: woken after a Send again, so it goes out now, not after a long sleep. */
type SchedulerWake = { wake: (ctx: restate.ObjectContext) => Promise<boolean> };

const REJECT = z.looseObject({
  ids: z.array(z.string()).describe("Draft ids"),
  reason: z.enum(REJECT_REASONS).nullish().describe("Why, as a quick pick"),
  note: z.string().nullish().describe("Why, in a few words"),
  viewer: PORTAL_FIELDS.viewer,
});

export function approvalsHandlers(desk: ContentDeskContext) {
  const { deps, scopeOf, slotsHere } = desk;
  return {
    /** A person's yes from the console: each draft posts at its platform's next slot. */
    approve: exclusiveHandler(
      { input: APPROVE },
      async (
        ctx: restate.ObjectContext,
        req: {
          ids: string[];
          now?: boolean | null;
          at?: string | null;
          expect?: string | null;
          viewer?: unknown;
        },
      ) => {
        const { db } = await scopeOf(ctx);
        const slots = await slotsHere(ctx);
        return ctx.run("approve", () =>
          verdict(() => {
            const now = new Date();
            const at = req.at ? new Date(req.at) : null;
            if (at && at.getTime() <= now.getTime())
              throw new Error("That time has passed. Pick a later one.");
            return approveDrafts(db, req.ids, {
              now,
              zone: deps.zone,
              slots,
              asap: req.now === true,
              ...(at ? { at } : {}),
              ...(req.expect ? { expect: req.expect } : {}),
              by: byOf(req),
            });
          }),
        );
      },
    ),
    /**
     * A post that may have gone out, settled (from its To approve row). It asks autobrowse for
     * the verdict stored under the post's send key, Wren's or a client's, at any age
     * (`Content.publish` with `verifyOnly`: it writes nothing). Found: published with the
     * platform's id, whatever he chose, then the after-publish (the first comment once, the
     * warm-replies hook). Else `posted` marks it published on his word (no id, so no numbers)
     * and runs the hook; `again` puts it back in the queue and wakes the loop; `dropped`
     * rejects it, so nothing posts it. Only `ReachDesk` and `SocialInbox` call it.
     */
    settlePost: exclusiveHandler(
      { input: SETTLE_POST, effect: "posts", ingressPrivate: true },
      async (
        ctx: restate.ObjectContext,
        req: { id: string; outcome: SettleOutcome; by: string },
      ): Promise<{ id: string; outcome: SettleOutcome; found: boolean }> => {
        const { db } = await scopeOf(ctx);
        const client = clientOfKey(ctx.key)?.client ?? null;
        const item = `draft:${req.id}`;
        const waiting = await ctx.run("item", () =>
          verdictOf(async () => {
            const a = await unsureItem(db, item);
            const d = await getDraft(db, req.id);
            if (d.status !== "publishing")
              throw new Error(`That post is ${d.status} now; nothing waits on it.`);
            // A client's post carries no Wren link; Wren's carries its funnel's.
            const links = client ? { text: null, comment: null } : await postedLinks(db, d);
            let ask: {
              post: Post;
              client: string | null;
              account: string | null;
              sendKey: string;
            } | null = null;
            if (a.sendKey) {
              try {
                ask = {
                  post: postOf(d, links.text),
                  client,
                  account: a.account,
                  sendKey: a.sendKey,
                };
              } catch (err) {
                if (!(err instanceof ShapeError)) throw err;
              }
            }
            return {
              platform: d.platform,
              ask,
              link: links.text ?? links.comment,
              comment: links.comment,
              account: a.account,
              sendKey: a.sendKey ?? undefined,
            };
          }),
        );
        const now = new Date(await ctx.date.now());
        if (req.outcome === "dropped") {
          await ctx.run("dropped", async () => {
            await dropDraft(db, req.id, req.by);
            await forgetUnsure(db, item);
          });
          return { id: req.id, outcome: "dropped", found: false };
        }
        const found = waiting.ask ? await askVerdict(ctx, waiting.platform, waiting.ask) : null;
        if (found) {
          await afterPublish(
            ctx,
            { db, client, posted: deps.posted },
            ctx.serviceClient<ReplyService>({ name: "Content" }),
            {
              draftId: req.id,
              platform: waiting.platform,
              link: waiting.link,
              comment: waiting.comment,
              account: waiting.account,
              sendKey: waiting.sendKey,
            },
            found,
            "found",
            req.by,
          );
          return { id: req.id, outcome: req.outcome, found: true };
        }
        if (req.outcome === "posted") {
          await ctx.run("posted", async () => {
            await markPostedBy(db, req.id, { by: req.by, at: now });
            await settleSent(db, item, { ref: null, at: now, by: req.by, now });
          });
          // His word is up too, with no id to comment under: only the hook runs.
          deps.posted?.(ctx, waiting.platform, client);
          return { id: req.id, outcome: "posted", found: false };
        }
        await ctx.run("again", async () => {
          await sendAgain(db, req.id);
          await forgetUnsure(db, item);
        });
        ctx
          .objectSendClient<SchedulerWake>(
            { name: "ContentScheduler" },
            client ? clientKey(client, POSTS_UNIT) : "default",
          )
          .wake();
        return { id: req.id, outcome: "again", found: false };
      },
    ),
    /** His yes on a rendered video, one Short or the vertical: a YouTube draft (private unless asked), posted on the next pass. */
    approveVideo: exclusiveHandler(
      { input: VIDEO },
      async (
        ctx: restate.ObjectContext,
        req: {
          id: number;
          short?: number | null;
          vertical?: boolean | null;
          privacy?: VideoPrivacy | null;
          replace?: boolean | null;
          publishAt?: string | null;
        },
      ) => {
        const { db } = await scopeOf(ctx);
        const at = req.publishAt ? new Date(req.publishAt) : null;
        if (at && Number.isNaN(at.getTime()))
          throw new restate.TerminalError("publishAt: not a time", { errorCode: 400 });
        return ctx.run("approve video", () =>
          verdict(async () => [
            await approveVideo(db, req.id, {
              source: "api",
              ...(at ? { publishAt: at } : {}),
              ...(req.short ? { short: req.short } : {}),
              ...(req.vertical ? { vertical: true } : {}),
              ...(req.privacy ? { privacy: req.privacy } : {}),
              ...(req.replace ? { replace: true } : {}),
            }),
          ]),
        );
      },
    ),
    pickThumbnail: exclusiveHandler(
      { input: THUMBNAIL },
      async (ctx: restate.ObjectContext, req: { id: number; n: number }) => {
        const { db } = await scopeOf(ctx);
        return ctx.run("pick thumbnail", () =>
          verdict(async () => {
            await pickThumbnail(db, req.id, req.n);
            return [{ id: String(req.id) }];
          }),
        );
      },
    ),
    /** No, with an optional quick pick and note: the draft record keeps why. */
    reject: exclusiveHandler(
      { input: REJECT },
      async (
        ctx: restate.ObjectContext,
        req: { ids: string[]; reason?: string | null; note?: string | null; viewer?: unknown },
      ) => {
        const { db } = await scopeOf(ctx);
        return ctx.run("reject", () =>
          verdict(() => rejectDrafts(db, req.ids, { by: byOf(req), ...rejectWhy(req) })),
        );
      },
    ),
  };
}
