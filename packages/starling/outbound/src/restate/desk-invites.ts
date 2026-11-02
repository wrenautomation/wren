/** `ReachDesk`'s LinkedIn invites: the pass, the proposed, his yes and no, a withdrawal. */
import * as restate from "@restatedev/restate-sdk";
import { byOf } from "@wren/core/ask";
import { NO_INPUT, serviceHandler } from "@wren/core/restate";
import { z } from "zod";
import { accountById, listAccounts } from "../accounts.js";
import { contactById } from "../contacts.js";
import { NOTE_MAX, recordNote, setInviteNote } from "../invite-notes.js";
import {
  applyWithdraw,
  approveInvites,
  inviteSettings,
  type ProposedInvite,
  proposedInvites,
  skipInvites,
} from "../invites.js";
import { ReachRefusal } from "../refusal.js";
import { channelsFor } from "./deps.js";
import { CONTACT, type DeskContext } from "./desk-context.js";
import { type InvitesPass, invitesAccount, invitesPass } from "./watch.js";

const INVITE_IDS = z.looseObject({
  ids: z.array(z.number().int()).min(1).max(100).describe("contacts with a proposed invite"),
});

const INVITE_APPROVE = INVITE_IDS.extend({
  note: z
    .string()
    .max(NOTE_MAX)
    .nullish()
    .describe("His words for the note, one invite only; empty sends it bare"),
});

export function invitesHandlers(desk: DeskContext) {
  const { deps, terminal, nowOf, nudge } = desk;
  return {
    /** Withdraw one pending LinkedIn invite now. It reads the profile first. */
    withdrawInvite: serviceHandler(
      { input: CONTACT, effect: "sends" },
      async (ctx: restate.Context, req: { contactId: number }): Promise<{ outcome: string }> => {
        const now = await nowOf(ctx);
        const { contact, account, days } = await ctx.run("contact", () =>
          terminal(async () => {
            const contact = await contactById(deps.db, req.contactId);
            if (!contact.accountId) throw new ReachRefusal("never invited");
            const account = await accountById(deps.db, contact.accountId);
            return { contact, account, days: (await inviteSettings(deps.db)).withdrawAfterDays };
          }),
        );
        const ch = channelsFor(deps, ctx)(account);
        if (!ch?.withdraw) throw new restate.TerminalError("this site has no invites");
        const r = await ch.withdraw(contact.handle);
        const outcome = await ctx.run("apply", () =>
          applyWithdraw(deps.db, contact.id, r, days, now),
        );
        return { outcome };
      },
    ),
    /** The invites pass now: accepts, stale withdrawn, tomorrow's proposed for his yes. */
    invites: serviceHandler(
      { input: NO_INPUT, effect: "sends" },
      async (ctx: restate.Context): Promise<InvitesPass | { off: string }> => {
        const now = await nowOf(ctx);
        const settings = await ctx.run("invite settings", () => inviteSettings(deps.db));
        const accounts = await ctx.run("accounts", () => listAccounts(deps.db));
        const a = invitesAccount(accounts, settings);
        if (!a)
          return {
            off: settings.account
              ? `${settings.account} is not an active LinkedIn account in reach`
              : "no account set in Shop → LinkedIn invites",
          };
        return invitesPass(deps, ctx, a, settings, now);
      },
    ),
    /** Invites the sweep proposed, waiting on his yes. */
    proposedInvites: serviceHandler(
      { input: NO_INPUT },
      async (ctx: restate.Context): Promise<ProposedInvite[]> =>
        ctx.run("proposed", () => proposedInvites(deps.db)),
    ),
    /** His yes on proposed invites: queued, sent by the tick under the day's cap and ramp. */
    approveInvites: serviceHandler(
      { input: INVITE_APPROVE, effect: "sends" },
      async (
        ctx: restate.Context,
        req: { ids: number[]; note?: string | null; viewer?: unknown },
      ): Promise<{ approved: number[] }> => {
        const now = await nowOf(ctx);
        const by = byOf(req);
        const approved = await ctx.run("approve", async () => {
          const [one] = req.ids;
          if (typeof req.note === "string" && req.ids.length === 1 && one !== undefined)
            await setInviteNote(deps.db, one, req.note, by);
          const ids = await approveInvites(deps.db, req.ids, now);
          await recordNote(deps.db, ids, "approved", by);
          return ids;
        });
        if (approved.length === 0)
          throw new restate.TerminalError("no proposed invite among these: already answered?", {
            errorCode: 409,
          });
        nudge(ctx);
        return { approved };
      },
    ),
    /** His no: skipped, and the person is never proposed again. */
    skipInvites: serviceHandler(
      { input: INVITE_IDS },
      async (
        ctx: restate.Context,
        req: { ids: number[]; viewer?: unknown },
      ): Promise<{ skipped: number[] }> => {
        const now = await nowOf(ctx);
        return {
          skipped: await ctx.run("skip", async () => {
            const ids = await skipInvites(deps.db, req.ids, now);
            await recordNote(deps.db, ids, "rejected", byOf(req));
            return ids;
          }),
        };
      },
    ),
  };
}
