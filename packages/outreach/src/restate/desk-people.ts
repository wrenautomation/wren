/** `ReachDesk`'s People: a person drafted, messaged, followed or invited, and a DM from an Engage row. */
import * as restate from "@restatedev/restate-sdk";
import { byOf } from "@wren/core/ask";
import { errorText, serviceHandler } from "@wren/core/restate";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { draftDm, queueDraft } from "../drafts.js";
import {
  itemPerson,
  markFollowed,
  messageAccount,
  personContact,
  personFollow,
} from "../from-people.js";
import { commentsSettings, followAct } from "../reach-posts.js";
import { reachContacts } from "../schema.js";
import type { DeskContext } from "./desk-context.js";

const PERSON = z.looseObject({
  id: z.string().describe("A People id: li:<people.id>, reddit:<handle> or <platform>:<handle>"),
});

const ITEM_MESSAGE = z.looseObject({
  id: z
    .string()
    .regex(/^(comment|onpost|thread|dm):\S+$/)
    .describe("An Engage row: comment:<n>, onpost:<n>, thread:<id>, dm:<contactId>"),
  body: z.string().min(1).describe("His words"),
});

const PERSON_MESSAGE = PERSON.extend({
  body: z.string().nullish().describe("The words; the console leaves an untouched draft out"),
});

export function peopleHandlers(desk: DeskContext) {
  const { deps, invite, terminal, nowOf, nudge } = desk;
  return {
    /** A person from People: their contact, added when new, with a model draft to edit. */
    draftPerson: serviceHandler(
      { input: PERSON },
      async (
        ctx: restate.Context,
        req: { id: string },
      ): Promise<{ contactId: number; draft: string | null }> => {
        const llm = deps.drafts?.llm;
        if (!llm) throw new restate.TerminalError("no model is set for DM drafts");
        const now = await nowOf(ctx);
        const contact = await ctx.run("contact", () =>
          terminal(async () => {
            const c = await personContact(deps.db, req.id);
            await messageAccount(deps.db, c, now);
            return c;
          }),
        );
        // He is waiting on the box: a failed call says so once, not a retry loop.
        const draft = await ctx.run("draft", async () => {
          try {
            return await draftDm(deps.db, llm, contact.id, {
              sender: deps.senderName,
              ...(deps.drafts?.guide ? { guide: deps.drafts.guide } : {}),
              facts: deps.drafts?.facts ? await deps.drafts.facts() : [],
              now,
            });
          } catch (err) {
            throw new restate.TerminalError(`the draft failed: ${errorText(err)}`);
          }
        });
        return { contactId: contact.id, draft };
      },
    ),
    /** Message a person from People, queued like a reply (its window and caps). */
    messagePerson: serviceHandler(
      { input: PERSON_MESSAGE, effect: "sends" },
      async (
        ctx: restate.Context,
        req: { id: string; body?: string | null },
      ): Promise<{ contactId: number; messageId: number }> => {
        const now = await nowOf(ctx);
        const r = await ctx.run("queue", () =>
          terminal(async () => {
            const c = await personContact(deps.db, req.id);
            const a = await messageAccount(deps.db, c, now);
            if (!c.accountId)
              await deps.db
                .update(reachContacts)
                .set({ accountId: a.id })
                .where(eq(reachContacts.id, c.id));
            const msg = await queueDraft(
              deps.db,
              { ...c, accountId: a.id },
              req.body,
              null,
              now,
              byOf(req),
            );
            return { contactId: c.id, messageId: msg.id };
          }),
        );
        nudge(ctx);
        return r;
      },
    ),
    /** Follow a person from People (LinkedIn, X, Instagram) as that site's comments account. */
    followPerson: serviceHandler(
      { input: PERSON, effect: "sends" },
      async (
        ctx: restate.Context,
        req: { id: string },
      ): Promise<{ platform: string; handle: string }> => {
        const now = await nowOf(ctx);
        const who = await ctx.run("plan", () => terminal(() => personFollow(deps.db, req.id)));
        const settings = await ctx.run("settings", () => commentsSettings(deps.db, who.platform));
        if (!settings.account)
          throw new restate.TerminalError(`no ${who.platform} account is set for comments`, {
            errorCode: 409,
          });
        const account = settings.account;
        const [site, method, path, input] = followAct(who.platform, { handle: who.handle });
        await deps.sitesFor(ctx).call(site, method, path, input, account);
        await ctx.run("follow", () => markFollowed(deps.db, who, { account, at: now }));
        return { platform: who.platform, handle: who.handle };
      },
    ),
    /** Invite a person from People on LinkedIn now: `linkedin-invite`, under the ramp. */
    invitePerson: serviceHandler(
      { input: PERSON, effect: "sends" },
      async (ctx: restate.Context, req: { id: string }): Promise<{ contactId: number }> => {
        const now = await nowOf(ctx);
        const contactId = await ctx.run("enroll", () =>
          terminal(async () => invite(await personContact(deps.db, req.id), now)),
        );
        nudge(ctx);
        return { contactId };
      },
    ),
    /**
     * DM them from an Engage row (a thread, a post, a comment, a DM): his words to the author.
     * Not yet connected on LinkedIn, they get an invite and his words wait as the first DM.
     */
    messageFrom: serviceHandler(
      { input: ITEM_MESSAGE, effect: "sends" },
      async (
        ctx: restate.Context,
        req: { id: string; body: string },
      ): Promise<{ contactId: number; sent: "dm" | "invite" }> => {
        const now = await nowOf(ctx);
        const r = await ctx.run("queue", () =>
          terminal(async () => {
            const c = await personContact(deps.db, await itemPerson(deps.db, req.id));
            if (c.platform === "linkedin" && !c.connectedAt) {
              await invite(c, now);
              await deps.db
                .update(reachContacts)
                .set({ draft: req.body.trim() })
                .where(eq(reachContacts.id, c.id));
              return { contactId: c.id, sent: "invite" as const };
            }
            const a = await messageAccount(deps.db, c, now);
            if (!c.accountId)
              await deps.db
                .update(reachContacts)
                .set({ accountId: a.id })
                .where(eq(reachContacts.id, c.id));
            await queueDraft(deps.db, { ...c, accountId: a.id }, req.body, null, now, byOf(req));
            return { contactId: c.id, sent: "dm" as const };
          }),
        );
        nudge(ctx);
        return r;
      },
    ),
  };
}
