/**
 * Meta ads as one Restate service, `Ads`. Every Graph call underneath is a
 * call to autobrowse's `sites` service, so a launch is a journaled ladder:
 * a retry resumes after the last object made, never making a second
 * campaign. Spend never starts here by accident: `launch` is PAUSED unless
 * the request says ACTIVE, and `start` must name the daily budget. The box's
 * spend gate still asks the person for every ACTIVE write.
 */
import * as restate from "@restatedev/restate-sdk";
import type { MediaHost, SiteClient } from "@wren/core/content";
import type { Db } from "@wren/db";
import { type LaunchSpec, type LeadFormSpec, type MetaAds, metaAds, type Tree } from "./ads.js";
import { markStarted, markStopped, recordLaunch } from "./launches.js";

export interface AdsDeps {
  /** The site client for one invocation (`restateSites(ctx, { caller })` in the worker). */
  sitesFor: (ctx: restate.Context) => SiteClient;
  adAccountId?: string;
  pageId?: string;
  host?: MediaHost;
  /** With a db, every launch/start/stop lands in `ad_launches` (what `AdsWatch` reads). */
  db?: Db;
}

export function makeAds(deps: AdsDeps) {
  const db = deps.db;
  const ads = (ctx: restate.Context): MetaAds =>
    metaAds(deps.sitesFor(ctx), {
      ...(deps.adAccountId ? { adAccountId: deps.adAccountId } : {}),
      ...(deps.pageId ? { pageId: deps.pageId } : {}),
      ...(deps.host ? { host: deps.host } : {}),
    });
  return restate.service({
    name: "Ads",
    handlers: {
      accounts: async (ctx: restate.Context) => ads(ctx).accounts(),
      campaigns: async (ctx: restate.Context) => ads(ctx).campaigns(),
      launch: async (ctx: restate.Context, spec: LaunchSpec) => {
        const a = ads(ctx);
        const launched = await a.launch(spec);
        if (db) {
          const adAccountId = await a.adAccountId();
          await ctx.run("record launch", () => recordLaunch(db, { adAccountId, spec, launched }));
        }
        return launched;
      },
      start: async (ctx: restate.Context, req: Tree & { dailyBudgetUsd: number }) => {
        if (!(req.dailyBudgetUsd > 0))
          throw new restate.TerminalError("start needs dailyBudgetUsd > 0", { errorCode: 400 });
        await ads(ctx).start(req, req.dailyBudgetUsd);
        if (db)
          await ctx.run("record start", () => markStarted(db, req.campaignId, req.dailyBudgetUsd));
      },
      stop: async (ctx: restate.Context, req: { campaignId: string; reason?: string }) => {
        await ads(ctx).stop(req.campaignId);
        if (db)
          await ctx.run("record stop", () => markStopped(db, req.campaignId, req.reason ?? null));
      },
      leadForm: async (ctx: restate.Context, req: LeadFormSpec) => ads(ctx).leadForm(req),
      leadForms: async (ctx: restate.Context) => ads(ctx).leadForms(),
      leads: async (ctx: restate.Context, req: { formId: string; limit?: number }) =>
        ads(ctx).leads(req.formId, req.limit),
      interests: async (ctx: restate.Context, req: { q: string; limit?: number }) =>
        ads(ctx).interests(req.q, req.limit),
      insights: async (
        ctx: restate.Context,
        req: { preset?: string; level?: "account" | "campaign" | "adset" | "ad" } = {},
      ) => ads(ctx).insights(req),
    },
  });
}

export type AdsService = ReturnType<typeof makeAds>;

export * from "./watch.js";
