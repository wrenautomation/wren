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
import { NO_INPUT, serviceHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { z } from "zod";
import {
  type LaunchSpec,
  type LeadFormSpec,
  META_OBJECTIVES,
  type MetaAds,
  metaAds,
  type Tree,
} from "./ads.js";
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

const LEAD_FORM = z.looseObject({
  name: z.string(),
  privacyUrl: z.string().describe("The privacy policy URL"),
  questions: z
    .array(z.looseObject({}))
    .nullish()
    .describe("Meta question objects; default email and full name"),
  followUpUrl: z.string().nullish().describe("Where the thank-you button goes"),
});
const LAUNCH = z.looseObject({
  name: z.string(),
  objective: z.enum(META_OBJECTIVES),
  dailyBudgetUsd: z.number(),
  targeting: z.looseObject({
    countries: z.array(z.string()).describe("Country codes, e.g. US"),
    ageMin: z.number().nullish(),
    ageMax: z.number().nullish(),
    interests: z
      .array(z.looseObject({ id: z.string(), name: z.string().nullish() }))
      .nullish()
      .describe("Interest ids, from interests"),
  }),
  optimizationGoal: z.string().nullish().describe("LINK_CLICKS unless said"),
  creative: z.looseObject({
    message: z.string().describe("The primary text"),
    link: z.string().describe("Where the ad sends people"),
    headline: z.string().nullish(),
    description: z.string().nullish(),
    callToAction: z.string().nullish().describe("LEARN_MORE, SIGN_UP, CONTACT_US"),
    media: z
      .looseObject({ kind: z.string(), source: z.string(), thumbnail: z.string().nullish() })
      .nullish()
      .describe("An image or a video"),
    leadForm: z
      .looseObject({})
      .nullish()
      .describe("An instant form: an existing form's id, or one to make"),
  }),
  status: z
    .enum(["ACTIVE", "PAUSED"])
    .nullish()
    .describe("PAUSED unless said; ACTIVE makes the launch a spend"),
});
const START = z.looseObject({
  campaignId: z.string(),
  adsetId: z.string(),
  adId: z.string(),
  dailyBudgetUsd: z.number(),
});
const STOP = z.looseObject({ campaignId: z.string(), reason: z.string().nullish() });
const INSIGHTS = z
  .looseObject({
    preset: z.string().nullish().describe("today, yesterday, last_7d, last_30d or maximum"),
    level: z.string().nullish().describe("account, campaign, adset or ad"),
    daily: z.boolean().nullish().describe("One row per day"),
  })
  .nullish();

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
      accounts: serviceHandler({ input: NO_INPUT }, async (ctx: restate.Context) =>
        ads(ctx).accounts(),
      ),
      campaigns: serviceHandler({ input: NO_INPUT }, async (ctx: restate.Context) =>
        ads(ctx).campaigns(),
      ),
      launch: serviceHandler(
        { input: LAUNCH, effect: "spends" },
        async (ctx: restate.Context, spec: LaunchSpec) => {
          const a = ads(ctx);
          const launched = await a.launch(spec);
          if (db) {
            const adAccountId = await a.adAccountId();
            await ctx.run("record launch", () => recordLaunch(db, { adAccountId, spec, launched }));
          }
          return launched;
        },
      ),
      start: serviceHandler(
        { input: START, effect: "spends" },
        async (ctx: restate.Context, req: Tree & { dailyBudgetUsd: number }) => {
          if (!(req.dailyBudgetUsd > 0))
            throw new restate.TerminalError("start needs dailyBudgetUsd > 0", { errorCode: 400 });
          await ads(ctx).start(req, req.dailyBudgetUsd);
          if (db)
            await ctx.run("record start", () =>
              markStarted(db, req.campaignId, req.dailyBudgetUsd),
            );
        },
      ),
      stop: serviceHandler(
        { input: STOP },
        async (ctx: restate.Context, req: { campaignId: string; reason?: string }) => {
          await ads(ctx).stop(req.campaignId);
          if (db)
            await ctx.run("record stop", () => markStopped(db, req.campaignId, req.reason ?? null));
        },
      ),
      leadForm: serviceHandler(
        { input: LEAD_FORM },
        async (ctx: restate.Context, req: LeadFormSpec) => ads(ctx).leadForm(req),
      ),
      leadForms: serviceHandler({ input: NO_INPUT }, async (ctx: restate.Context) =>
        ads(ctx).leadForms(),
      ),
      leads: serviceHandler(
        { input: z.looseObject({ formId: z.string(), limit: z.number().nullish() }) },
        async (ctx: restate.Context, req: { formId: string; limit?: number }) =>
          ads(ctx).leads(req.formId, req.limit),
      ),
      interests: serviceHandler(
        { input: z.looseObject({ q: z.string(), limit: z.number().nullish() }) },
        async (ctx: restate.Context, req: { q: string; limit?: number }) =>
          ads(ctx).interests(req.q, req.limit),
      ),
      insights: serviceHandler(
        { input: INSIGHTS },
        async (
          ctx: restate.Context,
          req: {
            preset?: string;
            level?: "account" | "campaign" | "adset" | "ad";
            daily?: boolean;
          } = {},
        ) => ads(ctx).insights(req),
      ),
    },
  });
}

export type AdsService = ReturnType<typeof makeAds>;

export * from "./watch.js";
