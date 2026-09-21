/**
 * Meta ads over autobrowse's `meta` site (Marketing API, graph.facebook.com).
 * One `launch` makes the whole ladder — campaign → ad set → creative → ad —
 * PAUSED, so nothing spends until `setStatus(…, "ACTIVE")`, which autobrowse
 * gates as spend (the ad set's daily budget per day). Reads: accounts,
 * campaigns, insights. Money is in USD minor units on the wire; here it is
 * dollars.
 */
import { type MediaHost, publicUrlOf, type SiteClient } from "@wren/core/content";

export const META_OBJECTIVES = [
  "OUTCOME_AWARENESS",
  "OUTCOME_TRAFFIC",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_APP_PROMOTION",
  "OUTCOME_SALES",
] as const;
export type MetaObjective = (typeof META_OBJECTIVES)[number];
export type AdStatus = "ACTIVE" | "PAUSED";

export interface MetaAdsOptions {
  /** `act_<id>` or the bare id; the first account on the token when absent. */
  adAccountId?: string;
  /** The Page the ads run as; the first Page when absent. */
  pageId?: string;
  host?: MediaHost;
  now?: () => Date;
}

export interface Targeting {
  countries: string[];
  ageMin?: number;
  ageMax?: number;
  /** Interest ids with names, as the Graph API wants them. */
  interests?: { id: string; name?: string }[];
}

export interface LaunchSpec {
  name: string;
  objective: MetaObjective;
  dailyBudgetUsd: number;
  targeting: Targeting;
  /** LINK_CLICKS, LANDING_PAGE_VIEWS, LEAD_GENERATION, REACH … (default LINK_CLICKS). */
  optimizationGoal?: string;
  creative: {
    /** The primary text. */
    message: string;
    /** Where the ad sends people. */
    link: string;
    headline?: string;
    description?: string;
    /** LEARN_MORE, SIGN_UP, CONTACT_US … */
    callToAction?: string;
    /** An image or a video; a local file goes through the media host. */
    media?: { kind: "image" | "video"; source: string; thumbnail?: string };
  };
  /** Everything is PAUSED unless said: ACTIVE makes the launch itself a spend. */
  status?: AdStatus;
}

/** The three objects a launch made; what `start` turns on. */
export interface Tree {
  campaignId: string;
  adsetId: string;
  adId: string;
}

export interface Launched extends Tree {
  creativeId: string;
  status: AdStatus;
  dailyBudgetUsd: number;
}

export interface AdAccount {
  id: string;
  name?: string;
  account_status?: number;
  currency?: string;
}
export interface CampaignRow {
  id: string;
  name: string;
  status: string;
  objective?: string;
  daily_budget?: string;
}
export interface InsightRow {
  date_start?: string;
  date_stop?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  cpc?: string;
  ctr?: string;
  actions?: { action_type: string; value: string }[];
}
export interface Interest {
  id: string;
  name: string;
  audience_size_lower_bound?: number;
  audience_size_upper_bound?: number;
  path?: string[];
}
interface Edge<T> {
  data?: T[];
}
interface Made {
  id: string;
}

export const toMinor = (usd: number): number => Math.round(usd * 100);
export const accountIdOf = (id: string): string => id.replace(/^act_/, "");

export function metaAds(sites: SiteClient, o: MetaAdsOptions = {}) {
  const call = <T>(method: "GET" | "POST", path: string, input: Record<string, unknown> = {}) =>
    sites.call<T>("meta", method, path, input);

  let account: Promise<string> | null = null;
  const adAccountId = () => {
    account ??= o.adAccountId
      ? Promise.resolve(accountIdOf(o.adAccountId))
      : call<Edge<AdAccount>>("GET", "/me/adaccounts", {}).then((r) => {
          const first = r.data?.[0];
          if (!first) throw new Error("meta ads: the token admins no ad account");
          return accountIdOf(first.id);
        });
    return account;
  };
  let page: Promise<string> | null = null;
  const pageId = () => {
    page ??= o.pageId
      ? Promise.resolve(o.pageId)
      : call<Edge<{ id: string }>>("GET", "/me/accounts", {}).then((r) => {
          const first = r.data?.[0];
          if (!first) throw new Error("meta ads: the token admins no Page");
          return first.id;
        });
    return page;
  };

  /** ACTIVE on a campaign, ad set or ad; the site gates it as spend when a budget is on the object. */
  const setStatus = async (
    objectId: string,
    status: AdStatus,
    dailyBudgetUsd?: number,
  ): Promise<void> => {
    await call<{ success?: boolean }>("POST", `/${objectId}`, {
      status,
      ...(dailyBudgetUsd !== undefined ? { daily_budget: toMinor(dailyBudgetUsd) } : {}),
    });
  };

  return {
    accounts: () => call<Edge<AdAccount>>("GET", "/me/adaccounts", {}).then((r) => r.data ?? []),
    async campaigns(): Promise<CampaignRow[]> {
      const r = await call<Edge<CampaignRow>>("GET", `/act_${await adAccountId()}/campaigns`, {
        fields: "id,name,status,objective,daily_budget",
      });
      return r.data ?? [];
    },
    async launch(spec: LaunchSpec): Promise<Launched> {
      if (!(spec.dailyBudgetUsd > 0)) throw new Error("meta ads: dailyBudgetUsd must be > 0");
      if (spec.targeting.countries.length === 0)
        throw new Error("meta ads: targeting needs at least one country");
      const status: AdStatus = spec.status ?? "PAUSED";
      const acct = await adAccountId();
      const pg = await pageId();
      const campaign = await call<Made>("POST", `/act_${acct}/campaigns`, {
        name: spec.name,
        objective: spec.objective,
        status,
        special_ad_categories: [],
      });
      const adset = await call<Made>("POST", `/act_${acct}/adsets`, {
        name: `${spec.name} · set`,
        campaign_id: campaign.id,
        status,
        daily_budget: toMinor(spec.dailyBudgetUsd),
        billing_event: "IMPRESSIONS",
        optimization_goal: spec.optimizationGoal ?? "LINK_CLICKS",
        targeting: {
          geo_locations: { countries: spec.targeting.countries },
          ...(spec.targeting.ageMin ? { age_min: spec.targeting.ageMin } : {}),
          ...(spec.targeting.ageMax ? { age_max: spec.targeting.ageMax } : {}),
          ...(spec.targeting.interests?.length
            ? { flexible_spec: [{ interests: spec.targeting.interests }] }
            : {}),
        },
      });
      const c = spec.creative;
      const cta = c.callToAction
        ? { call_to_action: { type: c.callToAction, value: { link: c.link } } }
        : {};
      let story: Record<string, unknown>;
      if (c.media?.kind === "video") {
        const url = await publicUrlOf(c.media.source, o.host, "meta ads");
        const video = await call<Made>("POST", `/act_${acct}/advideos`, {
          file_url: url,
          title: spec.name,
        });
        const thumb = c.media.thumbnail
          ? await publicUrlOf(c.media.thumbnail, o.host, "meta ads")
          : null;
        story = {
          page_id: pg,
          video_data: {
            video_id: video.id,
            message: c.message,
            ...(c.headline ? { title: c.headline } : {}),
            ...(c.description ? { link_description: c.description } : {}),
            ...(thumb ? { image_url: thumb } : {}),
            ...cta,
          },
        };
      } else {
        let hash: string | null = null;
        if (c.media?.kind === "image") {
          const url = await publicUrlOf(c.media.source, o.host, "meta ads");
          const img = await call<{ images?: Record<string, { hash?: string }> }>(
            "POST",
            `/act_${acct}/adimages`,
            { url },
          );
          hash = Object.values(img.images ?? {})[0]?.hash ?? null;
          if (!hash) throw new Error("meta ads: adimages answered no hash");
        }
        story = {
          page_id: pg,
          link_data: {
            link: c.link,
            message: c.message,
            ...(c.headline ? { name: c.headline } : {}),
            ...(c.description ? { description: c.description } : {}),
            ...(hash ? { image_hash: hash } : {}),
            ...cta,
          },
        };
      }
      const creative = await call<Made>("POST", `/act_${acct}/adcreatives`, {
        name: `${spec.name} · creative`,
        object_story_spec: story,
      });
      const ad = await call<Made>("POST", `/act_${acct}/ads`, {
        name: spec.name,
        adset_id: adset.id,
        creative: { creative_id: creative.id },
        status,
      });
      return {
        campaignId: campaign.id,
        adsetId: adset.id,
        creativeId: creative.id,
        adId: ad.id,
        status,
        dailyBudgetUsd: spec.dailyBudgetUsd,
      };
    },
    setStatus,
    /**
     * Deliver: the ad set ACTIVE with its budget, then the campaign, then the
     * ad (Meta delivers only when all three are on). Three gated writes on the
     * box: the budget is the amount it asks about; the other two carry none.
     */
    async start(ids: Tree, dailyBudgetUsd: number): Promise<void> {
      if (!(dailyBudgetUsd > 0)) throw new Error("meta ads: start needs dailyBudgetUsd > 0");
      await setStatus(ids.adsetId, "ACTIVE", dailyBudgetUsd);
      await setStatus(ids.campaignId, "ACTIVE");
      await setStatus(ids.adId, "ACTIVE");
    },
    /** PAUSED at the campaign stops delivery for everything under it. */
    async stop(campaignId: string): Promise<void> {
      await setStatus(campaignId, "PAUSED");
    },
    /** Interests by words, for a spec's `targeting.interests`. */
    async interests(q: string, limit = 25): Promise<Interest[]> {
      const r = await call<Edge<Interest>>("GET", "/search", { type: "adinterest", q, limit });
      return r.data ?? [];
    },
    /** Results by `level` for a Graph `date_preset` (today, yesterday, last_7d, last_30d, maximum …). */
    async insights(
      q: { preset?: string; level?: "account" | "campaign" | "adset" | "ad" } = {},
    ): Promise<InsightRow[]> {
      const r = await call<Edge<InsightRow>>("GET", `/act_${await adAccountId()}/insights`, {
        level: q.level ?? "campaign",
        date_preset: q.preset ?? "last_7d",
        fields: "campaign_name,spend,impressions,reach,clicks,cpc,ctr,actions",
      });
      return r.data ?? [];
    },
  };
}

export type MetaAds = ReturnType<typeof metaAds>;
