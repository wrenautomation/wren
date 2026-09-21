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
import { type LaunchSpec, type MetaAds, metaAds, type Tree } from "./ads.js";

export interface AdsDeps {
  /** The site client for one invocation (`restateSites(ctx)` in the worker). */
  sitesFor: (ctx: restate.Context) => SiteClient;
  adAccountId?: string;
  pageId?: string;
  host?: MediaHost;
}

export function makeAds(deps: AdsDeps) {
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
      launch: async (ctx: restate.Context, spec: LaunchSpec) => ads(ctx).launch(spec),
      start: async (ctx: restate.Context, req: Tree & { dailyBudgetUsd: number }) => {
        if (!(req.dailyBudgetUsd > 0))
          throw new restate.TerminalError("start needs dailyBudgetUsd > 0", { errorCode: 400 });
        await ads(ctx).start(req, req.dailyBudgetUsd);
      },
      stop: async (ctx: restate.Context, req: { campaignId: string }) =>
        ads(ctx).stop(req.campaignId),
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
