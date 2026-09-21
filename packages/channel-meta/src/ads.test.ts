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
      if (path === "/act_{adAccountId}/adimages")
        return { images: { "a.png": { hash: "h1" } } } as never;
      if (path === "/act_{adAccountId}/insights")
        return { data: [{ campaign_name: "c", spend: "1.50" }] } as never;
      if (path === "/{objectId}") return { success: true } as never;
      if (path === "/search")
        return { data: [{ id: "6003", name: "Shopify", audience_size_upper_bound: 5e6 }] } as never;
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
      "POST /act_{adAccountId}/campaigns",
      "POST /act_{adAccountId}/adsets",
      "POST /act_{adAccountId}/adimages",
      "POST /act_{adAccountId}/adcreatives",
      "POST /act_{adAccountId}/ads",
    ]);
    const adset = calls[3]?.input;
    expect(adset).toMatchObject({
      adAccountId: "123",
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
      "POST /act_{adAccountId}/campaigns",
      "POST /act_{adAccountId}/adsets",
      "POST /act_{adAccountId}/advideos",
      "POST /act_{adAccountId}/adcreatives",
      "POST /act_{adAccountId}/ads",
    ]);
    expect(calls[2]?.input).toMatchObject({ adAccountId: "9", file_url: "https://cdn.test/v.mp4" });
    expect(calls[3]?.input).toMatchObject({
      object_story_spec: {
        page_id: "pg9",
        video_data: { video_id: expect.stringMatching(/^advideos-/), message: "m" },
      },
    });
    await ads.setStatus("adset-1", "ACTIVE", 5);
    expect(calls.at(-1)?.input).toEqual({
      objectId: "adset-1",
      status: "ACTIVE",
      daily_budget: 500,
    });
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
