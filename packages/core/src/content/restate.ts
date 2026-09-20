/**
 * The content channels as one Restate service: `Content/publish` and the
 * reads, keyed by platform. A publish is one journaled step (the worker's
 * route is irreversible; a retry of the call does not post twice because
 * Restate replays the journal). This is the door a scheduler or a person
 * uses; the channels behind it are the adapters.
 */
import * as restate from "@restatedev/restate-sdk";
import type { ContentChannel, ListQuery, Platform, Post } from "./index.js";

export type Channels = Partial<Record<Platform, ContentChannel>>;

const PUBLISH_RETRY = { maxRetryAttempts: 1 };

export function makeContent(channels: Channels) {
  const pick = (platform: Platform): ContentChannel => {
    const ch = channels[platform];
    if (!ch)
      throw new restate.TerminalError(`no ${platform} channel configured`, { errorCode: 404 });
    return ch;
  };
  return restate.service({
    name: "Content",
    handlers: {
      platforms: async (): Promise<Platform[]> =>
        (Object.keys(channels) as Platform[]).filter((p) => channels[p]),
      /** Irreversible: a network fault after the post went out is not retried into a duplicate. */
      publish: (ctx: restate.Context, req: { platform: Platform; post: Post }) =>
        ctx.run(
          `publish ${req.platform}`,
          () => pick(req.platform).publish(req.post),
          PUBLISH_RETRY,
        ),
      list: (ctx: restate.Context, req: { platform: Platform; q?: ListQuery }) =>
        ctx.run(`list ${req.platform}`, () => pick(req.platform).list(req.q ?? {})),
      metrics: (ctx: restate.Context, req: { platform: Platform; id: string }) =>
        ctx.run(`metrics ${req.platform} ${req.id}`, () => pick(req.platform).metrics(req.id)),
      comments: (ctx: restate.Context, req: { platform: Platform; id: string; q?: ListQuery }) =>
        ctx.run(`comments ${req.platform} ${req.id}`, () =>
          pick(req.platform).comments(req.id, req.q ?? {}),
        ),
      reply: (ctx: restate.Context, req: { platform: Platform; commentId: string; text: string }) =>
        ctx.run(
          `reply ${req.platform} ${req.commentId}`,
          async () => {
            const ch = pick(req.platform);
            if (!ch.reply)
              throw new restate.TerminalError(`${req.platform} cannot reply here`, {
                errorCode: 501,
              });
            await ch.reply(req.commentId, req.text);
          },
          PUBLISH_RETRY,
        ),
    },
  });
}
export type Content = ReturnType<typeof makeContent>;
