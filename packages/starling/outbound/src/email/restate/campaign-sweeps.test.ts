import type { LoopCampaign } from "@wren/starling-core/campaigns";
import { describe, expect, it } from "vitest";
import { campaignSweeps } from "./compose-scheduler.js";

const NICHE = {
  plan: [{ sequence: "a", where: { x: "1" } }, { sequence: "b" }],
  offers: new Map([
    ["a", "offer-a"],
    ["b", "offer-b"],
  ]),
  senders: ["one@mail.test", "two@mail.test"],
};
const campaign = (id: string, over: Partial<LoopCampaign> = {}): LoopCampaign => ({
  id,
  accounts: {},
  caps: {},
  ...over,
});
const ids = (sweeps: ReturnType<typeof campaignSweeps>) =>
  sweeps.map((s) => [
    s.campaign,
    s.senders,
    s.rules.map((r) => `${r.audience}:${r.rule.sequence}`),
  ]);

describe("campaignSweeps", () => {
  it("is the default alone, every sender and rule, when no campaign sends email", () => {
    const sweeps = campaignSweeps([campaign("social", { accounts: { linkedin: "w" } })], NICHE);
    expect(ids(sweeps)).toEqual([
      [null, NICHE.senders, ["first_contact:a", "first_contact:b", "returning:a", "returning:b"]],
    ]);
  });

  it("puts a campaign on its own inbox and its offer's rules, ahead of the default", () => {
    const sweeps = campaignSweeps(
      [
        campaign("spring", {
          offer: "offer-b",
          accounts: { email: "Two@mail.test" },
          audience: { segment: "7" },
          caps: { "email.opener": 4 },
        }),
      ],
      NICHE,
    );
    expect(sweeps[0]).toMatchObject({
      campaign: "spring",
      senders: ["two@mail.test"],
      segment: 7,
      cap: 4,
    });
    expect(ids(sweeps)[0]?.[2]).toEqual(["first_contact:b", "returning:b"]);
    expect(sweeps[1]?.campaign).toBeNull();
  });

  it("leaves out another niche's inbox and an offer no rule pitches", () => {
    const sweeps = campaignSweeps(
      [
        campaign("away", { accounts: { email: "else@mail.test" } }),
        campaign("odd", { offer: "offer-z", accounts: { email: "one@mail.test" } }),
      ],
      NICHE,
    );
    expect(sweeps.map((s) => s.campaign)).toEqual([null]);
  });
});
