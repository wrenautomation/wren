/** `ReachDesk`'s contacts: finds, one added, the list, enrich, enroll, and the sequence templates. */
import * as restate from "@restatedev/restate-sdk";
import type { Found, Profile } from "@wren/core/outreach";
import { NO_INPUT, PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { z } from "zod";
import { accountById, listAccounts, platformOf } from "../accounts.js";
import {
  type AddStats,
  addContact,
  addProspects,
  contactById,
  enrichContact,
  listContacts,
} from "../contacts.js";
import { type EnrollStats, enroll } from "../enroll.js";
import { ReachRefusal } from "../refusal.js";
import {
  CONTACT_STATES,
  type ContactState,
  isReachPlatform,
  type ReachContact,
} from "../schema.js";
import { listTemplates, type SetTemplate, type SlotView, setTemplate } from "../store.js";
import { channelsFor } from "./deps.js";
import { type DeskContext, PLATFORM } from "./desk-context.js";

const NICHE = z.string().nullish();

const FIND = z.looseObject({
  accountId: z.string(),
  query: z.string(),
  limit: z.number().nullish(),
  cursor: z.string().nullish().describe("Where the last page stopped"),
  niche: NICHE,
});

const ADD_CONTACT = z.looseObject({
  platform: PLATFORM,
  handle: z.string().describe("A profile URL or a handle"),
  name: z.string().nullish(),
  niche: NICHE,
});

const CONTACTS = z
  .looseObject({
    platform: PLATFORM.nullish(),
    state: z.enum(CONTACT_STATES).nullish(),
    limit: z.number().nullish(),
  })
  .nullish();

const ENRICH = z.looseObject({
  contactId: z.number(),
  accountId: z.string().nullish().describe("Read as this account; default theirs, else the first"),
});

const ENROLL = z.looseObject({
  sequence: z.string(),
  limit: z.number().nullish(),
  contactIds: z.array(z.number()).nullish(),
  enrichedOnly: z.boolean().nullish(),
  niche: NICHE,
});

const SET_TEMPLATE = z.looseObject({
  key: z.string(),
  body: z.string().nullish().describe("Empty clears it"),
  by: z.string().nullish().describe("Who saved it; from the console, the operator"),
  viewer: PORTAL_FIELDS.viewer,
});

export function contactsHandlers(desk: DeskContext) {
  const { deps, terminal, nowOf, slots, nudge } = desk;
  return {
    /** Search as an account; what it found is kept as `new` contacts. */
    find: serviceHandler(
      { input: FIND },
      async (
        ctx: restate.Context,
        req: {
          accountId: string;
          query: string;
          limit?: number;
          cursor?: string | null;
          niche?: string | null;
        },
      ): Promise<{ found: Found; added: AddStats }> => {
        if (req.niche && deps.heldNiches.includes(req.niche))
          throw new restate.TerminalError(`niche ${req.niche} is held`);
        const a = await ctx.run("account", () =>
          terminal(() => accountById(deps.db, req.accountId)),
        );
        const ch = channelsFor(deps, ctx)(a);
        if (!ch) throw new restate.TerminalError(`no channel for ${a.platform}`);
        const found = await ch.find({
          query: req.query,
          limit: Math.min(req.limit ?? 25, 100),
          cursor: req.cursor ?? null,
        });
        const added = await ctx.run("add prospects", () =>
          addProspects(deps.db, a.platform, found.prospects, { niche: req.niche ?? null }),
        );
        return { found, added };
      },
    ),
    addContact: serviceHandler(
      { input: ADD_CONTACT },
      async (
        ctx: restate.Context,
        req: { platform: string; handle: string; name?: string | null; niche?: string | null },
      ): Promise<ReachContact> =>
        ctx.run("add contact", () =>
          terminal(() => addContact(deps.db, { ...req, platform: platformOf(req.platform) })),
        ),
    ),
    contacts: serviceHandler(
      { input: CONTACTS },
      async (
        ctx: restate.Context,
        req: { platform?: string | null; state?: ContactState | null; limit?: number } = {},
      ): Promise<ReachContact[]> =>
        ctx.run("contacts", () =>
          listContacts(deps.db, {
            platform: req.platform ? platformOf(req.platform) : null,
            state: req.state ?? null,
            limit: req.limit ?? 50,
          }),
        ),
    ),
    /** Read one person's page as an account (any active one on the platform when none is given). */
    enrich: serviceHandler(
      { input: ENRICH },
      async (
        ctx: restate.Context,
        req: { contactId: number; accountId?: string | null },
      ): Promise<Profile> => {
        const now = await nowOf(ctx);
        const c = await ctx.run("contact", () =>
          terminal(() => contactById(deps.db, req.contactId)),
        );
        const a = await ctx.run("account", () =>
          terminal(async () => {
            if (req.accountId) return accountById(deps.db, req.accountId);
            if (c.accountId) return accountById(deps.db, c.accountId);
            if (!isReachPlatform(c.platform))
              throw new ReachRefusal("reads through the client's connected account");
            const [first] = await listAccounts(deps.db, c.platform);
            if (!first) throw new ReachRefusal(`no ${c.platform} account to read with`);
            return first;
          }),
        );
        const ch = channelsFor(deps, ctx)(a);
        if (!ch) throw new restate.TerminalError(`no channel for ${a.platform}`);
        const profile = await ch.enrich(c.handle);
        await ctx.run("store profile", () =>
          enrichContact(deps.db, c, { ...ch, enrich: async () => profile }, now),
        );
        return profile;
      },
    ),
    enroll: serviceHandler(
      { input: ENROLL, effect: "sends" },
      async (
        ctx: restate.Context,
        req: {
          sequence: string;
          limit?: number;
          contactIds?: number[];
          enrichedOnly?: boolean;
          niche?: string | null;
        },
      ): Promise<EnrollStats> => {
        const seq = deps.sequences.get(req.sequence);
        if (!seq) throw new restate.TerminalError(`no sequence ${req.sequence}`);
        if (req.niche && deps.heldNiches.includes(req.niche))
          throw new restate.TerminalError(`niche ${req.niche} is held`);
        const now = await nowOf(ctx);
        const stats = await ctx.run("enroll", () =>
          terminal(() =>
            enroll(deps.db, {
              sequence: seq,
              sender: deps.senderName,
              limit: req.limit ?? 20,
              ...(req.contactIds ? { contactIds: req.contactIds } : {}),
              ...(req.enrichedOnly ? { enrichedOnly: true } : {}),
              now,
            }),
          ),
        );
        if (stats.enrolled > 0) nudge(ctx);
        return stats;
      },
    ),
    templates: serviceHandler(
      { input: NO_INPUT },
      async (ctx: restate.Context): Promise<SlotView[]> =>
        ctx.run("templates", () => listTemplates(deps.db, slots, deps.senderName)),
    ),
    setTemplate: serviceHandler(
      { input: SET_TEMPLATE },
      async (
        ctx: restate.Context,
        req: Omit<SetTemplate, "by"> & { by?: string | null; viewer?: { email?: string } },
      ): Promise<SlotView> => {
        const by = req.by ?? req.viewer?.email ?? "console";
        return ctx.run("set template", () =>
          terminal(() => setTemplate(deps.db, { slots, sender: deps.senderName }, { ...req, by })),
        );
      },
    ),
  };
}
