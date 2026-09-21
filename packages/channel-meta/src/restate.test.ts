import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { makeAds } from "./restate.js";

describe("Ads service", () => {
  const calls: { path: string; input: Record<string, unknown> }[] = [];
  const sites: SiteClient = {
    async call(_site, _method, path, input = {}) {
      calls.push({ path, input });
      return { id: "x", data: [] } as never;
    },
    async via() {
      return "api";
    },
  };
  const svc = makeAds({ sitesFor: () => sites, adAccountId: "act_1", pageId: "p" });
  const h = (
    svc as unknown as { service: Record<string, (ctx: unknown, req?: unknown) => Promise<unknown>> }
  ).service;
  const ctx = {} as never;

  it("start without a budget is a terminal 400, nothing written", async () => {
    await expect(
      h.start?.(ctx, { campaignId: "c", adsetId: "s", adId: "a", dailyBudgetUsd: 0 }),
    ).rejects.toMatchObject({ name: "TerminalError", message: /dailyBudgetUsd/ });
    expect(calls).toEqual([]);
  });

  it("start and stop write status through the site", async () => {
    await h.start?.(ctx, { campaignId: "c", adsetId: "s", adId: "a", dailyBudgetUsd: 3 });
    expect(calls.map((c) => [c.path, c.input])).toEqual([
      ["/s", { status: "ACTIVE", daily_budget: 300 }],
      ["/c", { status: "ACTIVE" }],
      ["/a", { status: "ACTIVE" }],
    ]);
    await h.stop?.(ctx, { campaignId: "c" });
    expect(calls.at(-1)).toMatchObject({ path: "/c", input: { status: "PAUSED" } });
    expect(await h.campaigns?.(ctx)).toEqual([]);
    expect(calls.at(-1)?.path).toBe("/act_1/campaigns");
  });
});
