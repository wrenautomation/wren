/**
 * KeywordDm (designs/2026-10-11-comment-keywords.md): a comment that says a keyword gets the
 * keyword's DM through Meta's private reply, then its public reply when it has one. `SocialWatch`
 * (or `PushedComments`) catches the comments and sends each hit here; the portal adds and removes
 * keywords. 11-04 (designs/2026-11-04-meta-push-flows.md): each DM waits its `MetaPace` slot; a
 * keyword with a button sends it on the DM, and `tap` sends the follow-up.
 */
import * as restate from "@restatedev/restate-sdk";
import { byOf } from "@wren/core/ask";
import { tagged } from "@wren/core/message-settings";
import { errorText, PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { sendAcross } from "@wren/core/send-verdict";
import type { Db } from "@wren/db";
import { ReachRefusal, recordLanded } from "@wren/starling-acts";
import { isSendTaken, isSendUnsure, sendAtMostOnce, sendError } from "@wren/starling-acts/restate";
import { planPrivateReply, turnKinds } from "@wren/starling-conversations";
import { z } from "zod";
import {
  addKeyword,
  catchKeywords,
  failHit,
  followHit,
  handHit,
  hitOf,
  hitOfPayload,
  pickReply,
  removeKeywords,
  tapPayload,
} from "../social/keywords.js";
import { type MetaPace, paceKey } from "./meta-pace.js";

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
      button?: { title: string; payload: string } | null;
      sendKey: string;
      recheck: boolean;
    },
  ) => Promise<unknown>;
} & {
  followUp: (
    ctx: restate.Context,
    req: {
      platform: string;
      to: string;
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
  reply: z
    .string()
    .max(300)
    .nullish()
    .describe("A public answer under the comment; several versions, one a line"),
  button: z.string().max(20).nullish().describe("The DM's button label; needs a follow-up"),
  followup: z.string().max(1000).nullish().describe("What a tap on the button sends"),
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
const TAP = z.looseObject({
  client: z.string().max(64).nullable(),
  platform: z.enum(["instagram", "facebook"]),
  from: z.string().min(1).max(100),
  payload: z.string().min(1).max(1000),
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
       * Meta's 7 days, sends off), Meta's no, or a send that left nothing is logged as failed
       * and ends there. The hit is handed to the ledger before the send; from then on the
       * ledger row is its state, so one that may have gone out waits in To approve, never
       * marked failed. A public reply that fails is logged but the DM stands.
       */
      send: serviceHandler(
        { input: SEND, effect: "sends", ingressPrivate: true },
        async (ctx: restate.Context, req: Send): Promise<{ state: string }> => {
          const db = dbOf(req.client);
          const now = new Date(await ctx.date.now());
          const hit = await ctx.run("hit", () => hitOf(db, req.hit));
          if (hit?.state !== "queued") return { state: hit?.state ?? "gone" };
          const failed = async (why: string) => {
            await ctx.run("failed", () => failHit(db, req.hit, why));
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
          // Under Meta's cap per account: a burst waits its turn, evenly spaced.
          const wait = await ctx
            .objectClient<MetaPace>({ name: "MetaPace" }, paceKey(req.client, c.platform))
            .slot();
          if (wait > 0) await ctx.sleep(wait);
          // Its links carry utm tags like every marketing DM (designs/2026-10-14-customerio-audit.md, B4).
          const dm = await ctx.run("words", () =>
            tagged(db, hit.dm, { source: req.client ?? "wren", medium: "dm", campaign: "keyword" }),
          );
          if (!(await ctx.run("hand", () => handHit(db, req.hit)))) return { state: "gone" };
          try {
            await sendAtMostOnce(ctx, db, {
              item: `private:${c.id}`,
              platform: c.platform,
              account: null,
              via: "wren",
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
                    button:
                      hit.button && hit.followup
                        ? { title: hit.button, payload: tapPayload(req.hit) }
                        : null,
                    ...k,
                  }),
                ),
              landed: (tx, sent) =>
                recordLanded(tx, `private:${c.id}`, turnKinds, {
                  ref: sent.ref,
                  now,
                  by: "keyword",
                }),
            }).catch((err) => {
              throw sendError(err);
            });
          } catch (err) {
            // CP: may have gone out, or another invocation holds it: the ledger row decides.
            if (isSendUnsure(err) || isSendTaken(err)) return { state: "handed" };
            if (err instanceof restate.TerminalError) return failed(err.message);
            throw err;
          }
          const reply = pickReply(hit.reply, hit.commentId);
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
                via: "wren",
                landed: (tx, answer) =>
                  recordLanded(tx, `comment:${c.id}`, turnKinds, {
                    ref: answer.ref,
                    now,
                    by: "keyword",
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
      /**
       * A tap on a keyword DM's button (`kw:<hit>`): the keyword's follow-up to who tapped, once,
       * inside the 24h window the tap opened. Anything else is not ours: nothing.
       */
      tap: serviceHandler(
        { input: TAP, effect: "sends", ingressPrivate: true },
        async (ctx: restate.Context, req: z.infer<typeof TAP>): Promise<{ state: string }> => {
          const id = hitOfPayload(req.payload);
          if (id === null) return { state: "not ours" };
          const db = dbOf(req.client);
          const hit = await ctx.run("hit", () => hitOf(db, id));
          if (!hit?.followup || hit.platform !== req.platform) return { state: "no follow-up" };
          if (hit.followedAt) return { state: "sent before" };
          const now = new Date(await ctx.date.now());
          const text = await ctx.run("words", () =>
            tagged(db, hit.followup ?? "", {
              source: req.client ?? "wren",
              medium: "dm",
              campaign: "keyword",
            }),
          );
          const content = ctx.serviceClient<ContentSend>({ name: "Content" });
          try {
            await sendAtMostOnce(ctx, db, {
              item: `followup:${id}`,
              platform: req.platform,
              account: null,
              via: "wren",
              words: text,
              target: req.from,
              url: null,
              send: () =>
                sendAcross<{ ref: string | null }>((k) =>
                  content.followUp({
                    platform: req.platform,
                    to: req.from,
                    text,
                    client: req.client,
                    ...k,
                  }),
                ),
              landed: (tx) => followHit(tx, id, now),
            }).catch((err) => {
              throw sendError(err);
            });
          } catch (err) {
            if (isSendUnsure(err) || isSendTaken(err)) return { state: "handed" };
            if (err instanceof restate.TerminalError) {
              ctx.console.warn(`keyword follow-up ${id}: ${errorText(err)}`);
              return { state: "failed" };
            }
            throw err;
          }
          return { state: "sent" };
        },
      ),
    },
  });
}

export type KeywordDm = ReturnType<typeof makeKeywordDm>;
