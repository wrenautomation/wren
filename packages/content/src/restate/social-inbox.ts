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
import { errorText, serviceHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { markAnswered, planAnswer, ReachRefusal } from "@wren/outreach";
import { z } from "zod";
import { liveConnections, type SocialAccessApi } from "../connect/access.js";
import {
  type DmAccount,
  type DmPlan,
  failedDm,
  isDmSocial,
  keepDms,
  planDm,
  readDms,
  sendDm,
  sentDm,
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

const CLIENT = z.string().min(1).max(64).describe("The client's id");
const READ = z.looseObject({ client: CLIENT });
const SEND = z.looseObject({
  client: CLIENT,
  contactId: z.number().int().positive().describe("The DM thread's contact"),
  body: z.string().min(1).max(4000),
  by: z.string().max(320).nullish().describe("Who sent it"),
});
const ANSWER = z.looseObject({
  client: CLIENT,
  id: z.number().int().positive().describe("The comment's id"),
  body: z.string().min(1).max(4000),
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

      /** One DM answer through the account that read the thread. Sent now: the gate said yes. */
      send: serviceHandler(
        { input: noRawKeys(SEND), effect: "sends" },
        async (
          ctx: restate.Context,
          req: { client: string; contactId: number; body: string; by?: string | null },
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
          const pageId = await ctx.run(
            "page",
            async () => (await deps.access.connection(plan.connection))?.extra.pageId ?? null,
          );
          let sent: { ref: string | null };
          try {
            sent = await sendDm(deps.sites(ctx, req.client, "reach.outreach"), plan, pageId);
          } catch (err) {
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
          req: { client: string; id: number; body: string; by?: string | null },
        ): Promise<{ ok: true }> => {
          const now = await nowOf(ctx);
          const db = deps.clientDb(req.client);
          const plan = await ctx.run("plan", () =>
            terminal(async () => {
              const p = await planAnswer(db, req.id, now);
              if (p.account) throw new ReachRefusal("that comment answers from Wren's own Inbox");
              return { platform: p.comment.platform, ref: p.comment.ref };
            }),
          );
          await ctx.serviceClient<ContentReply>({ name: "Content" }).reply({
            platform: plan.platform,
            commentId: plan.ref,
            text: req.body,
            client: req.client,
          });
          await ctx.run("answered", () =>
            markAnswered(db, req.id, {
              body: req.body.trim(),
              ref: null,
              now,
              by: req.by ?? "inbox",
            }),
          );
          return { ok: true };
        },
      ),
    },
  });
}

export type SocialInbox = ReturnType<typeof makeSocialInbox>;
