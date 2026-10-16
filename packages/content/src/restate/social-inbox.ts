/**
 * SocialInbox (designs/2026-10-07-client-social.md): a client's DMs and comment answers through
 * its own connected accounts. `read` brings its Facebook Page's, Instagram's and X's DMs into its
 * Inbox (SocialWatch calls it each pass). `send` answers a DM and `answer` a comment, each after
 * InboxDesk's gate said yes, and each refused again here while the client's sends are off.
 */
import * as restate from "@restatedev/restate-sdk";
import { findClient, sendsOn } from "@wren/core/clients";
import type { SiteClient } from "@wren/core/content";
import { SENDS_OFF } from "@wren/core/content/restate";
import { noRawKeys } from "@wren/core/key-refs";
import { clientKey, errorText, serviceHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import {
  itemOf,
  markAnswered,
  markPosted,
  planAnswer,
  ReachRefusal,
  settleSent,
  unsureItem,
} from "@wren/outreach";
import {
  contentLook,
  isSendTaken,
  isSendUnsure,
  type PostSettle,
  sendAtMostOnce,
} from "@wren/outreach/restate";
import { z } from "zod";
import { liveConnections, loginOf, type SocialAccessApi } from "../connect/access.js";
import {
  type DmAccount,
  type DmPlan,
  dmPlanOf,
  failedDm,
  isDmSocial,
  keepDms,
  planDm,
  readDms,
  seenInDms,
  sendDm,
  sentDm,
  unknownDm,
} from "../connect/dms.js";

export interface SocialInboxDeps {
  main: Db;
  clientDb: (client: string) => Db;
  access: Pick<SocialAccessApi, "connection">;
  /** A client's accounts' API, each call one journaled step, reads metered as `part`. */
  sites: (
    ctx: restate.Context,
    client: string,
    part: "content.social" | "reach.outreach",
  ) => SiteClient;
}

type Fn<I, O> = (ctx: unknown, req: I) => Promise<O>;
type ContentReply = {
  reply: Fn<{ platform: string; commentId: string; text: string; client: string }, unknown>;
};
type OwnSends = {
  send: Fn<{ client: string; contactId: number; body: string; by?: string; again: true }, unknown>;
  answer: Fn<{ client: string; id: number; body: string; by?: string; again: true }, unknown>;
};

const CLIENT = z.string().min(1).max(64).describe("The client's id");
const READ = z.looseObject({ client: CLIENT });
const SEND = z.looseObject({
  client: CLIENT,
  contactId: z.number().int().positive().describe("The DM thread's contact"),
  body: z.string().min(1).max(4000),
  by: z.string().max(320).nullish().describe("Who sent it"),
  again: z.boolean().optional().describe("Send again after a person said it did not go out"),
});
const ANSWER = z.looseObject({
  client: CLIENT,
  id: z.number().int().positive().describe("The comment's id"),
  body: z.string().min(1).max(4000),
  by: z.string().max(320).nullish(),
  again: z.boolean().optional(),
});
/** A person's word on an unsure send of the client's (designs/2026-10-16-maybe-sent.md). */
const SETTLE = z.looseObject({
  client: CLIENT,
  item: z.string().min(3).max(80).describe("The send's typed id: sdm:<message> or comment:<id>"),
  outcome: z
    .enum(["posted", "again"])
    .describe("posted: they saw it on the site; again: send it once more"),
  by: z.string().max(320).nullish(),
});

/** A refusal is final: asking again gets the same answer. */
const terminal = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ReachRefusal) throw new restate.TerminalError(err.message);
    throw err;
  }
};

export function makeSocialInbox(deps: SocialInboxDeps) {
  const nowOf = async (ctx: restate.Context) => new Date(await ctx.date.now());
  /** The client's sends for `part` are on, read fresh. */
  const sending = async (ctx: restate.Context, client: string, part: string) => {
    const on = await ctx.run("sends", async () => {
      const c = await findClient(deps.main, client);
      return !!c && !c.demo && sendsOn(c, part);
    });
    if (!on) throw new restate.TerminalError(SENDS_OFF, { errorCode: 403 });
  };
  return restate.service({
    name: "SocialInbox",
    handlers: {
      /** Its connected accounts' DMs into its Inbox. A failed account is said, not a failed read. */
      read: serviceHandler(
        { input: noRawKeys(READ) },
        async (ctx: restate.Context, req: { client: string }) => {
          const conns: DmAccount[] = await ctx.run("accounts", async () =>
            (await liveConnections(deps.main, req.client))
              .filter((c) => isDmSocial(c.platform))
              .map(({ id, platform, externalId, handle, name, extra }) => ({
                id,
                platform,
                externalId,
                handle,
                name,
                extra,
              })),
          );
          const sites = deps.sites(ctx, req.client, "content.social");
          const out = { accounts: 0, threads: 0, messages: 0, errors: [] as string[] };
          for (const c of conns) {
            try {
              const threads = await readDms(sites, c);
              const kept = await ctx.run(`keep ${c.platform} ${c.id}`, () =>
                keepDms(deps.clientDb(req.client), c, threads),
              );
              out.accounts += 1;
              out.threads += kept.threads;
              out.messages += kept.messages;
            } catch (err) {
              out.errors.push(`${c.platform}: ${errorText(err)}`.slice(0, 300));
            }
          }
          return out;
        },
      ),

      /**
       * One DM answer through the account that read the thread. Sent now: the gate said yes. At
       * most once (designs/2026-10-16-maybe-sent.md): a send whose outcome was lost is looked
       * for in their conversation, found or proved absent, else unsure for a person.
       */
      send: serviceHandler(
        { input: noRawKeys(SEND), effect: "sends" },
        async (
          ctx: restate.Context,
          req: {
            client: string;
            contactId: number;
            body: string;
            by?: string | null;
            again?: boolean;
          },
        ): Promise<{ ref: string | null }> => {
          await sending(ctx, req.client, "reach.outreach");
          const now = await nowOf(ctx);
          const db = deps.clientDb(req.client);
          const plan: DmPlan = await ctx.run("plan", () =>
            terminal(() =>
              planDm(db, {
                contactId: req.contactId,
                body: req.body,
                now,
                live: async (id) => {
                  const c = await deps.access.connection(id);
                  return !!c && c.client === req.client && c.state === "connected";
                },
              }),
            ),
          );
          const { pageId, account } = await ctx.run("account", async () => {
            const c = await deps.access.connection(plan.connection);
            const account: DmAccount | null = c && {
              id: c.id,
              platform: c.platform,
              externalId: c.externalId,
              handle: c.handle,
              name: c.name,
              extra: c.extra,
            };
            return { pageId: c?.extra.pageId ?? null, account };
          });
          const reads = deps.sites(ctx, req.client, "content.social");
          let sent: { ref: string | null };
          try {
            sent = await sendAtMostOnce(ctx, db, {
              item: `sdm:${plan.messageId}`,
              platform: plan.platform,
              account: loginOf(plan.connection),
              words: plan.body,
              target: plan.handle,
              url: plan.url,
              again: req.again === true,
              look: account
                ? async (since) => seenInDms(await readDms(reads, account), plan, since)
                : undefined,
              send: () => sendDm(deps.sites(ctx, req.client, "reach.outreach"), plan, pageId),
            });
          } catch (err) {
            // Unsure: the row waits as `unknown` with its ledger row. Taken: nothing changed.
            if (isSendUnsure(err)) {
              await ctx.run("unknown", () => unknownDm(db, plan.messageId, err.message));
              throw err;
            }
            if (isSendTaken(err)) throw err;
            const why = errorText(err);
            await ctx.run("failed", () => failedDm(db, plan.messageId, why));
            throw new restate.TerminalError(why);
          }
          await ctx.run("sent", () =>
            sentDm(db, plan, { ref: sent.ref, now, by: req.by ?? "inbox" }),
          );
          return sent;
        },
      ),

      /** One comment answered on the client's own post, through `Content.reply` as the client. */
      answer: serviceHandler(
        { input: noRawKeys(ANSWER), effect: "sends" },
        async (
          ctx: restate.Context,
          req: { client: string; id: number; body: string; by?: string | null; again?: boolean },
        ): Promise<{ ok: true }> => {
          const now = await nowOf(ctx);
          const db = deps.clientDb(req.client);
          const plan = await ctx.run("plan", () =>
            terminal(async () => {
              const p = await planAnswer(db, req.id, now);
              if (p.account) throw new ReachRefusal("that comment answers from Wren's own Inbox");
              const { platform, ref, post, author, url } = p.comment;
              return { platform, ref, post, author, url };
            }),
          );
          const text = req.body.trim();
          // At most once (designs/2026-10-16-maybe-sent.md), read back as the client's account.
          const sent = await sendAtMostOnce(ctx, db, {
            item: `comment:${req.id}`,
            platform: plan.platform,
            account: null,
            words: text,
            target: plan.ref,
            url: plan.url,
            again: req.again === true,
            look: contentLook(ctx, {
              platform: plan.platform,
              post: plan.post,
              parent: plan.ref,
              to: plan.author,
              text,
              client: req.client,
            }),
            send: async () => {
              await ctx.serviceClient<ContentReply>({ name: "Content" }).reply({
                platform: plan.platform,
                commentId: plan.ref,
                text: req.body,
                client: req.client,
              });
              return { ref: null };
            },
          });
          await ctx.run("answered", () =>
            markAnswered(db, req.id, { body: text, ref: sent.ref, now, by: req.by ?? "inbox" }),
          );
          return { ok: true };
        },
      ),

      /**
       * A person's word on an unsure send of the client's, from its To approve: posted records
       * it as its send would; again sends it once more through `send` or `answer`. A post on its
       * own channel (`draft:`) settles in its `ContentDesk`, which reads the listing first.
       */
      settle: serviceHandler(
        { input: noRawKeys(SETTLE), effect: "sends" },
        async (
          ctx: restate.Context,
          req: { client: string; item: string; outcome: "posted" | "again"; by?: string | null },
        ): Promise<{ item: string; outcome: "posted" | "again" }> => {
          const now = await nowOf(ctx);
          const db = deps.clientDb(req.client);
          const by = req.by ?? "inbox";
          const { kind, id, words, ref, contactId } = await ctx.run("item", () =>
            terminal(async () => {
              const a = await unsureItem(db, req.item);
              const it = itemOf(req.item);
              if (it.kind !== "sdm" && it.kind !== "comment" && it.kind !== "draft")
                throw new ReachRefusal(`a ${it.kind} send settles in Wren's own To approve`);
              const contactId =
                it.kind === "sdm" ? (await dmPlanOf(db, Number(it.id))).contactId : null;
              return { ...it, words: a.words, ref: a.ref, contactId };
            }),
          );
          // A post of the client's on its own channel: its desk reads the listing first.
          if (kind === "draft") {
            await ctx
              .objectClient<PostSettle>({ name: "ContentDesk" }, clientKey(req.client, "desk"))
              .settlePost({ id, outcome: req.outcome, by });
            return { item: req.item, outcome: req.outcome };
          }
          if (req.outcome === "posted") {
            await ctx.run("posted", () =>
              terminal(async () => {
                if (kind === "comment") return void (await markPosted(db, req.item, { by, now }));
                const plan = await dmPlanOf(db, Number(id));
                await sentDm(db, plan, { ref, now, by });
                await settleSent(db, req.item, { ref, at: now, by, now });
              }),
            );
            return { item: req.item, outcome: "posted" };
          }
          const own = ctx.serviceClient<OwnSends>({ name: "SocialInbox" });
          const again = { client: req.client, body: words, by, again: true as const };
          if (kind === "sdm" && contactId) await own.send({ ...again, contactId });
          else await own.answer({ ...again, id: Number(id) });
          return { item: req.item, outcome: "again" };
        },
      ),
    },
  });
}

export type SocialInbox = ReturnType<typeof makeSocialInbox>;
