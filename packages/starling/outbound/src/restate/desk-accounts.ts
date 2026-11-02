/** `ReachDesk`'s accounts: the list, one added, its state, its health now. */
import * as restate from "@restatedev/restate-sdk";
import { serviceHandler } from "@wren/core/restate";
import { z } from "zod";
import {
  type AccountView,
  accountById,
  addAccount,
  listAccounts,
  platformOf,
  refreshHealth,
  setAccountState,
  viewOf,
} from "../accounts.js";
import { ACCOUNT_STATES, type AccountState } from "../schema.js";
import { channelsFor } from "./deps.js";
import { type DeskContext, PLATFORM } from "./desk-context.js";

const ADD_ACCOUNT = z.looseObject({
  platform: PLATFORM,
  account: z.string().describe("The autobrowse credential, e.g. reddit@alt"),
});

const CLIENT = z.string().nullish().describe("A client's id: its own logins; none: Wren's");

const ACCOUNT_STATE = z.looseObject({
  id: z.string(),
  state: z.enum(ACCOUNT_STATES),
  reason: z.string().nullish(),
  client: CLIENT,
});

export function accountsHandlers(desk: DeskContext) {
  const { deps, terminal, nowOf, dbOf } = desk;
  return {
    accounts: serviceHandler(
      { input: z.looseObject({ client: CLIENT }).nullish() },
      async (
        ctx: restate.Context,
        req?: { client?: string | null } | null,
      ): Promise<AccountView[]> => {
        const now = await nowOf(ctx);
        const db = dbOf(req?.client);
        const rows = await ctx.run("accounts", () => listAccounts(db));
        return rows.map((a) => viewOf(a, deps.policy, now));
      },
    ),
    addAccount: serviceHandler(
      { input: ADD_ACCOUNT },
      async (
        ctx: restate.Context,
        req: { platform: string; account: string },
      ): Promise<AccountView> => {
        const now = await nowOf(ctx);
        const row = await ctx.run("add account", () =>
          terminal(() =>
            addAccount(deps.db, {
              platform: platformOf(req.platform),
              account: req.account,
              now,
            }),
          ),
        );
        return viewOf(row, deps.policy, now);
      },
    ),
    setAccountState: serviceHandler(
      { input: ACCOUNT_STATE },
      async (
        ctx: restate.Context,
        req: { id: string; state: AccountState; reason?: string | null; client?: string | null },
      ): Promise<AccountView> => {
        const now = await nowOf(ctx);
        const db = dbOf(req.client);
        const row = await ctx.run("set state", () =>
          terminal(() =>
            setAccountState(db, req.id, req.state, { reason: req.reason ?? null, now }),
          ),
        );
        return viewOf(row, deps.policy, now);
      },
    ),
    /** One account's health now (platform read, then stored). */
    health: serviceHandler(
      { input: z.looseObject({ id: z.string() }) },
      async (ctx: restate.Context, req: { id: string }): Promise<AccountView> => {
        const now = await nowOf(ctx);
        const a = await ctx.run("account", () => terminal(() => accountById(deps.db, req.id)));
        const ch = channelsFor(deps, ctx)(a);
        if (!ch) throw new restate.TerminalError(`no channel for ${a.platform}`);
        const h = await ch.health();
        await ctx.run("store health", () =>
          refreshHealth(deps.db, [a], () => ({ ...ch, health: async () => h }), now),
        );
        const fresh = await ctx.run("account again", () => accountById(deps.db, req.id));
        return viewOf(fresh, deps.policy, now);
      },
    ),
  };
}
