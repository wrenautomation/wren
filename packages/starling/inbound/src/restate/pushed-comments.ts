/**
 * `PushedComments`: comments a Meta push carried, kept with no read (designs/2026-11-04-meta-push-flows.md).
 * The same steps as the pass's read: keep (dedupes on the comment's ref), a keyword's DM, the
 * executor's `comment` events. Only with `WREN_META_PUSH_EVENTS`; `SocialPush.meta` sends here.
 */

import { executorEmit } from "@wren/core/executor";
import { serviceHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import * as restate from "@wren/runtime";
import { COMMENTS_FLOW, COMMENTS_FROM, commentEvent } from "@wren/starling-conversations";
import type { CommentRow } from "@wren/starling-core";
import { z } from "zod";
import { keepPostComments, publishedPost } from "../social/store.js";
import { catchKeywordDms } from "./keyword-dm.js";

const KEEP = z.object({
  client: z.string().max(64).nullable(),
  platform: z.enum(["instagram", "facebook"]),
  post: z.string().min(1).max(200),
  rows: z
    .array(
      z.looseObject({
        id: z.string().min(1),
        postId: z.string().min(1),
        author: z.string(),
        text: z.string(),
        at: z.string(),
      }),
    )
    .min(1)
    .max(500),
});

export function makePushedComments(deps: { db: Db; clientDb?: ((client: string) => Db) | null }) {
  return restate.service({
    name: "PushedComments",
    handlers: {
      keep: serviceHandler(
        { input: KEEP, ingressPrivate: true },
        async (ctx: restate.Context, req: z.infer<typeof KEEP>): Promise<{ kept: number }> => {
          let db = deps.db;
          if (req.client) {
            if (!deps.clientDb) throw new restate.TerminalError("no client databases here");
            db = deps.clientDb(req.client);
          }
          // Its title and link from our published row, as the read keeps them.
          const post = (await ctx.run("post", () => publishedPost(db, req.platform, req.post))) ?? {
            platform: req.platform,
            id: req.post,
            url: null,
            title: "",
            publishedAt: "",
          };
          const kept = await ctx.run("keep", () =>
            keepPostComments(db, post, req.rows as unknown as CommentRow[]),
          );
          if (!kept.length) return { kept: 0 };
          await catchKeywordDms(
            ctx,
            db,
            req.client,
            kept.map((k) => k.id),
          );
          executorEmit(ctx, {
            client: req.client,
            workflow: COMMENTS_FLOW,
            from: COMMENTS_FROM,
            events: kept.map(commentEvent),
          });
          return { kept: kept.length };
        },
      ),
    },
  });
}
