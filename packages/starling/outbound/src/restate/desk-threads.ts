/** `ReachDesk`'s DM threads: the list, one thread, read, a reply queued for the sender. */
import type * as restate from "@restatedev/restate-sdk";
import { byOf } from "@wren/core/ask";
import { serviceHandler } from "@wren/core/restate";
import { z } from "zod";
import { contactById } from "../contacts.js";
import { queueDraft } from "../drafts.js";
import { ReachRefusal } from "../refusal.js";
import { CONTACT_STATES } from "../schema.js";
import {
  getThread,
  listThreads,
  markRead,
  type Thread,
  type ThreadFilter,
  type ThreadSummary,
} from "../threads.js";
import { CONTACT, type DeskContext, PLATFORM } from "./desk-context.js";

const THREADS = z
  .looseObject({
    platform: PLATFORM.nullish(),
    state: z.enum(CONTACT_STATES).nullish(),
    unread: z.boolean().nullish(),
    limit: z.number().nullish(),
  })
  .nullish();

const REPLY = CONTACT.extend({
  body: z.string().nullish().describe("The words; the console leaves an untouched draft out"),
  subject: z.string().nullish().describe("Reddit only"),
});

export function threadsHandlers(desk: DeskContext) {
  const { deps, terminal, nowOf, nudge } = desk;
  return {
    threads: serviceHandler(
      { input: THREADS },
      async (ctx: restate.Context, req: ThreadFilter = {}): Promise<ThreadSummary[]> =>
        ctx.run("threads", () => listThreads(deps.db, req ?? {})),
    ),
    thread: serviceHandler(
      { input: CONTACT },
      async (ctx: restate.Context, req: { contactId: number }): Promise<Thread> =>
        ctx.run("thread", () => terminal(() => getThread(deps.db, req.contactId))),
    ),
    markRead: serviceHandler(
      { input: CONTACT },
      async (ctx: restate.Context, req: { contactId: number }): Promise<void> => {
        const now = await nowOf(ctx);
        await ctx.run("mark read", () => markRead(deps.db, req.contactId, now));
      },
    ),
    /** Queue a message on a thread; the sender is nudged so it leaves on the next tick. */
    reply: serviceHandler(
      { input: REPLY, effect: "sends" },
      async (
        ctx: restate.Context,
        req: { contactId: number; body?: string | null; subject?: string | null },
      ): Promise<{ messageId: number }> => {
        const now = await nowOf(ctx);
        const msg = await ctx.run("queue", () =>
          terminal(async () => {
            const contact = await contactById(deps.db, req.contactId);
            if (contact.state === "opted_out") throw new ReachRefusal("they asked to stop");
            return queueDraft(deps.db, contact, req.body, req.subject ?? null, now, byOf(req));
          }),
        );
        await ctx.run("mark read", () => markRead(deps.db, req.contactId, now));
        nudge(ctx);
        return { messageId: msg.id };
      },
    ),
  };
}
