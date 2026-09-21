import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { accountIdOf, metaAds, toMinor } from "./ads.js";

/** Records every call; answers by path. */
function fakeSites() {
  const calls: { method: string; path: string; input: Record<string, unknown> }[] = [];
  let n = 0;
  const sites: SiteClient = {
    async call(_site, method, path, input = {}) {
      calls.push({ method, path, input });
      if (path === "/me/adaccounts") return { data: [{ id: "act_123", name: "Wren" }] } as never;
      if (path === "/me/accounts") return { data: [{ id: "pg1" }] } as never;
      if (path.endsWith("/adimages")) return { images: { "a.png": { hash: "h1" } } } as never;
      if (path.endsWith("/leads"))
        return {
          data: [{ id: "L1", field_data: [{ name: "email", values: ["a@b.co"] }] }],
          paging: { cursors: { after: "x" } },
        } as never;
      if (path.endsWith("/leadgen_forms") && method === "GET")
        return { data: [{ id: "f1", name: "founders", leads_count: 2 }] } as never;
      if (path.endsWith("/insights"))
        return { data: [{ campaign_name: "c", spend: "1.50" }] } as never;
      if (path === "/search")
        return { data: [{ id: "6003", name: "Shopify", audience_size_upper_bound: 5e6 }] } as never;
      if (/^\/[a-z0-9-]+$/.test(path)) return { success: true } as never;
      return { id: `${path.split("/").pop()}-${++n}` } as never;
    },
    async via() {
      return "api";
    },
  };
  return { sites, calls };
}

describe("metaAds", () => {
  it("converts money and ids", () => {
    expect(toMinor(19.99)).toBe(1999);
    expect(accountIdOf("act_123")).toBe("123");
    expect(accountIdOf("123")).toBe("123");
  });

  it("launches the ladder PAUSED, with the first account and Page, an image by hash", async () => {
    const { sites, calls } = fakeSites();
    const ads = metaAds(sites, { host: { host: async (p) => `https://cdn.test/${p}` } });
    const out = await ads.launch({
      name: "Founders",
      objective: "OUTCOME_LEADS",
      dailyBudgetUsd: 20,
      targeting: { countries: ["US"], ageMin: 25, interests: [{ id: "6003", name: "Shopify" }] },
      creative: {
        message: "hi",
        link: "https://wrenautomation.com",
        headline: "Wren",
        callToAction: "LEARN_MORE",
        media: { kind: "image", source: "a.png" },
      },
    });
    expect(out).toMatchObject({ status: "PAUSED", dailyBudgetUsd: 20 });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /me/adaccounts",
      "GET /me/accounts",
      "POST /act_123/campaigns",
      "POST /act_123/adsets",
      "POST /act_123/adimages",
      "POST /act_123/adcreatives",
      "POST /act_123/ads",
    ]);
    const adset = calls[3]?.input;
    expect(adset).toMatchObject({
      status: "PAUSED",
      daily_budget: 2000,
      optimization_goal: "LINK_CLICKS",
      targeting: {
        geo_locations: { countries: ["US"] },
        age_min: 25,
        flexible_spec: [{ interests: [{ id: "6003", name: "Shopify" }] }],
      },
    });
    expect(calls[4]?.input).toMatchObject({ url: "https://cdn.test/a.png" });
    expect(calls[5]?.input).toMatchObject({
      object_story_spec: {
        page_id: "pg1",
        link_data: {
          link: "https://wrenautomation.com",
          image_hash: "h1",
          name: "Wren",
          call_to_action: { type: "LEARN_MORE", value: { link: "https://wrenautomation.com" } },
        },
      },
    });
    expect(calls[6]?.input).toMatchObject({
      adset_id: expect.stringMatching(/^adsets-/),
      status: "PAUSED",
    });
    // Every object is PAUSED: the launch itself cannot spend.
    expect(calls.filter((c) => c.method === "POST").every((c) => c.input.status !== "ACTIVE")).toBe(
      true,
    );
  });

  it("a lead form is made on the Page first and the CTA opens it instead of the link", async () => {
    const { sites, calls } = fakeSites();
    const ads = metaAds(sites, { adAccountId: "act_9", pageId: "pg9" });
    const out = await ads.launch({
      name: "Leads",
      objective: "OUTCOME_LEADS",
      dailyBudgetUsd: 5,
      targeting: { countries: ["US"] },
      optimizationGoal: "LEAD_GENERATION",
      creative: {
        message: "m",
        link: "https://wren.test/thanks",
        leadForm: { name: "founders", privacyUrl: "https://wren.test/privacy" },
      },
    });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /act_9/campaigns",
      "POST /act_9/adsets",
      "POST /pg9/leadgen_forms",
      "POST /act_9/adcreatives",
      "POST /act_9/ads",
    ]);
    expect(calls[2]?.input).toEqual({
      name: "founders",
      questions: [{ type: "EMAIL" }, { type: "FULL_NAME" }],
      privacy_policy: { url: "https://wren.test/privacy" },
      follow_up_action_url: "https://wren.test/thanks",
    });
    expect(out.leadFormId).toMatch(/^leadgen_forms-/);
    expect(calls[3]?.input).toMatchObject({
      object_story_spec: {
        link_data: {
          call_to_action: { type: "SIGN_UP", value: { lead_gen_form_id: out.leadFormId } },
        },
      },
    });
    // An existing form by id makes nothing.
    calls.length = 0;
    await ads.launch({
      name: "Leads 2",
      objective: "OUTCOME_LEADS",
      dailyBudgetUsd: 5,
      targeting: { countries: ["US"] },
      creative: { message: "m", link: "https://wren.test", leadForm: { id: "f1" } },
    });
    expect(calls.some((c) => c.path.endsWith("/leadgen_forms"))).toBe(false);
    expect(await ads.leadForms()).toEqual([{ id: "f1", name: "founders", leads_count: 2 }]);
    // Leads page by cursor until the asked-for count.
    const leads = await ads.leads("f1", 2);
    expect(leads).toHaveLength(2);
    expect(calls.slice(-2).map((c) => c.input)).toEqual([{ limit: 2 }, { limit: 1, after: "x" }]);
  });

  it("a video creative uploads by URL first; ACTIVE carries the budget so the gate can name it", async () => {
    const { sites, calls } = fakeSites();
    const ads = metaAds(sites, { adAccountId: "act_9", pageId: "pg9" });
    await ads.launch({
      name: "Short",
      objective: "OUTCOME_TRAFFIC",
      dailyBudgetUsd: 5,
      targeting: { countries: ["US", "CA"] },
      creative: {
        message: "m",
        link: "https://x.test",
        media: { kind: "video", source: "https://cdn.test/v.mp4" },
      },
    });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /act_9/campaigns",
      "POST /act_9/adsets",
      "POST /act_9/advideos",
      "POST /act_9/adcreatives",
      "POST /act_9/ads",
    ]);
    expect(calls[2]?.input).toMatchObject({ file_url: "https://cdn.test/v.mp4" });
    expect(calls[3]?.input).toMatchObject({
      object_story_spec: {
        page_id: "pg9",
        video_data: { video_id: expect.stringMatching(/^advideos-/), message: "m" },
      },
    });
    await ads.start({ campaignId: "c1", adsetId: "s1", adId: "a1" }, 5);
    expect(calls.slice(-3).map((c) => [c.path, c.input])).toEqual([
      ["/s1", { status: "ACTIVE", daily_budget: 500 }],
      ["/c1", { status: "ACTIVE" }],
      ["/a1", { status: "ACTIVE" }],
    ]);
    await ads.stop("c1");
    expect(calls.at(-1)).toMatchObject({ path: "/c1", input: { status: "PAUSED" } });
    await expect(ads.start({ campaignId: "c1", adsetId: "s1", adId: "a1" }, 0)).rejects.toThrow(
      /dailyBudgetUsd/,
    );
    expect(await ads.insights({ preset: "today" })).toEqual([
      { campaign_name: "c", spend: "1.50" },
    ]);
    expect(calls.at(-1)?.input).toMatchObject({ level: "campaign", date_preset: "today" });
    expect(await ads.interests("shop")).toEqual([
      { id: "6003", name: "Shopify", audience_size_upper_bound: 5e6 },
    ]);
    expect(calls.at(-1)?.input).toEqual({ type: "adinterest", q: "shop", limit: 25 });
    await expect(
      ads.launch({
        name: "n",
        objective: "OUTCOME_LEADS",
        dailyBudgetUsd: 0,
        targeting: { countries: ["US"] },
        creative: { message: "m", link: "https://x" },
      }),
    ).rejects.toThrow(/dailyBudgetUsd/);
  });
});
