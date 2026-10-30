/**
 * KeywordDm (designs/2026-10-11-comment-keywords.md): a comment that says a keyword gets the
 * keyword's DM through Meta's private reply, then its public reply when it has one. `SocialWatch`
 * catches the comments and sends each hit here; the portal adds and removes keywords.
 */
import * as restate from "@restatedev/restate-sdk";
import { byOf } from "@wren/core/ask";
import { tagged } from "@wren/core/message-settings";
import { errorText, PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { sendAcross } from "@wren/core/send-verdict";
import type { Db } from "@wren/db";
import { markAnswered, planPrivateReply, privateReplied, ReachRefusal } from "@wren/outreach";
import { sendAtMostOnce, sendError } from "@wren/outreach/restate";
import { z } from "zod";
import { addKeyword, catchKeywords, hitOf, removeKeywords, settleHit } from "../social/keywords.js";

interface KeywordDmDeps {
  db: Db;
  clientDb?: (client: string) => Db;
}

/** `Content/privateReply` and `reply` given a send key: each answers a `Delivery`, which `sendAcross` unwraps. */
type ContentSend = {
  [K in "privateReply" | "reply"]: (
    ctx: restate.Context,
    req: {
      platform: string;
      commentId: string;
      text: string;
      client?: string | null;
      sendKey: string;
      recheck: boolean;
    },
  ) => Promise<unknown>;
};

interface Send {
  client: string | null;
  hit: number;
}

/**
 * The comments just kept that say a keyword, each logged and sent to `KeywordDm`. Send-only:
 * a failed DM is the log's to say, never the watch's.
 */
export async function catchKeywordDms(
  ctx: restate.Context,
  db: Db,
  client: string | null,
  ids: readonly number[],
): Promise<number> {
  if (!ids.length) return 0;
  const hits = await ctx.run("keywords", () => catchKeywords(db, ids));
  for (const h of hits)
    ctx.serviceSendClient<KeywordDm>({ name: "KeywordDm" }).send({ client, hit: h.id });
  return hits.length;
}

const ADD = z.looseObject({
  ...PORTAL_FIELDS,
  keyword: z.string().min(1).max(60).describe("The word people comment"),
  dm: z.string().min(1).max(1000).describe("The DM they get"),
  reply: z.string().max(300).nullish().describe("A public answer under the comment"),
  platform: z.enum(["instagram", "facebook"]).nullish().describe("One site; both when empty"),
  post: z.string().max(200).nullish().describe("One post's id; every post when empty"),
});
const REMOVE = z.looseObject({
  ...PORTAL_FIELDS,
  ids: z
    .array(z.union([z.string(), z.number()]))
    .min(1)
    .describe("The keywords' ids"),
});
const SEND = z.looseObject({
  client: z.string().max(64).nullable(),
  hit: z.number().int().positive(),
});

export function makeKeywordDm(deps: KeywordDmDeps) {
  const dbOf = (client: string | null): Db => {
    if (!client) return deps.db;
    if (!deps.clientDb) throw new restate.TerminalError("no client databases here");
    return deps.clientDb(client);
  };
  return restate.service({
    name: "KeywordDm",
    handlers: {
      /** Wren's own keyword, from Marketing → Keywords. */
      add: serviceHandler({ input: ADD }, (ctx: restate.Context, req: z.infer<typeof ADD>) =>
        ctx.run("add", () => addKeyword(deps.db, req, byOf(req))),
      ),
      remove: serviceHandler(
        { input: REMOVE },
        async (ctx: restate.Context, req: { ids: unknown[] }) => ({
          done: await ctx.run("remove", () =>
            removeKeywords(
              deps.db,
              req.ids.map(Number).filter((n) => Number.isInteger(n)),
            ),
          ),
        }),
      ),
      /**
       * One hit's DM, then its public reply, each on the send ledger (`private:<comment>`,
       * `comment:<comment>`) and sent under its key, so autobrowse or the direct journal says
       * whether it went out (designs/2026-10-16-maybe-sent.md). A refusal (DM'd already, past
       * Meta's 7 days, sends off), Meta's no, a send that left nothing, or one that may have
       * gone out (its ledger row waits in To approve) is logged as failed and ends there. A
       * public reply that fails is logged but the DM stands.
       */
      send: serviceHandler(
        { input: SEND, effect: "sends", ingressPrivate: true },
        async (ctx: restate.Context, req: Send): Promise<{ state: string }> => {
          const db = dbOf(req.client);
          const now = new Date(await ctx.date.now());
          const hit = await ctx.run("hit", () => hitOf(db, req.hit));
          if (hit?.state !== "queued") return { state: hit?.state ?? "gone" };
          const failed = async (why: string) => {
            await ctx.run("failed", () => settleHit(db, req.hit, { sent: false, why }));
            return { state: "failed" };
          };
          const content = ctx.serviceClient<ContentSend>({ name: "Content" });
          let c: Awaited<ReturnType<typeof planPrivateReply>>;
          try {
            c = await ctx.run("plan", async () => {
              try {
                return await planPrivateReply(db, hit.commentId, now);
              } catch (err) {
                if (err instanceof ReachRefusal) throw new restate.TerminalError(err.message);
                throw err;
              }
            });
          } catch (err) {
            if (err instanceof restate.TerminalError) return failed(err.message);
            throw err;
          }
          // Its links carry utm tags like every marketing DM (designs/2026-10-14-customerio-audit.md, B4).
          const dm = await ctx.run("words", () =>
            tagged(db, hit.dm, { source: req.client ?? "wren", medium: "dm", campaign: "keyword" }),
          );
          try {
            await sendAtMostOnce(ctx, db, {
              item: `private:${c.id}`,
              platform: c.platform,
              account: null,
              words: dm,
              target: c.ref,
              url: c.url,
              send: () =>
                sendAcross<{ ref: string | null }>((k) =>
                  content.privateReply({
                    platform: c.platform,
                    commentId: c.ref,
                    text: dm,
                    client: req.client,
                    ...k,
                  }),
                ),
              landed: async (tx, sent) => {
                await privateReplied(tx, c, {
                  body: dm,
                  ref: sent.ref,
                  now,
                  by: "keyword",
                  via: "wren",
                });
                await settleHit(tx, req.hit, { sent: true, ref: sent.ref, now });
              },
            }).catch((err) => {
              throw sendError(err);
            });
          } catch (err) {
            if (err instanceof restate.TerminalError) return failed(err.message);
            throw err;
          }
          const reply = hit.reply?.trim();
          if (reply)
            try {
              await sendAtMostOnce(ctx, db, {
                item: `comment:${c.id}`,
                platform: c.platform,
                account: null,
                words: reply,
                target: c.ref,
                url: c.url,
                send: async () => {
                  await sendAcross((k) =>
                    content.reply({
                      platform: c.platform,
                      commentId: c.ref,
                      text: reply,
                      client: req.client,
                      ...k,
                    }),
                  );
                  return { ref: null };
                },
                landed: (tx, answer) =>
                  markAnswered(tx, c.id, {
                    body: reply,
                    ref: answer.ref,
                    now,
                    by: "keyword",
                    via: "wren",
                  }),
              }).catch((err) => {
                throw sendError(err);
              });
            } catch (err) {
              if (!(err instanceof restate.TerminalError)) throw err;
              ctx.console.warn(`keyword reply on comment ${c.id}: ${errorText(err)}`);
            }
          return { state: "sent" };
        },
      ),
    },
  });
}

export type KeywordDm = ReturnType<typeof makeKeywordDm>;
