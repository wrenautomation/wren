import type { Campaign } from "@wren/pipeline/metro-campaigns";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { campaignLine, campaignLines, campaignNumberLine, registerCampaigns } from "./campaigns.js";

const fallback: Campaign = {
  id: "default",
  label: "Default",
  ctas: [],
  accounts: {},
  caps: {},
  status: "live",
  stations: ["social"],
  own: {},
};
const late: Campaign = {
  id: "late",
  label: "Late",
  parent: "spring",
  offer: "offer-a",
  ctas: [{ label: "Book a call", station: "book" }],
  accounts: { linkedin: "wren", email: "hello" },
  caps: { "linkedin.comment": 5 },
  from: "2026-11-01",
  status: "paused",
  stations: ["held", "book"],
  own: { status: "live", caps: { "linkedin.comment": 5 } },
};

describe("campaign lines", () => {
  it("writes one row a campaign", () => {
    expect(campaignLine(fallback)).toBe("default  live  1 station  Default");
    expect(campaignLine(late)).toBe(
      "late  paused  2 stations  Late  in spring  offer offer-a  2026-11-01 to …",
    );
  });

  it("marks what comes from above, and a status the parent holds", () => {
    expect(campaignLines(late)).toEqual([
      "late  Late",
      "status    paused  (held by spring)",
      "in        spring",
      "offer     offer-a  (from spring)",
      "cta 1     Book a call -> book  (from spring)",
      "accounts  linkedin wren, email hello",
      "caps      linkedin.comment 5 a day",
      "dates     2026-11-01 to …",
      "stations  held, book",
    ]);
    expect(campaignLines(fallback)).toEqual([
      "default  Default",
      "status    live",
      "stations  social",
    ]);
  });

  it("writes one numbers row a campaign", () => {
    const n = { campaign: "spring", label: "Spring", people: 4, converted: 1, now: 2, deals: 1 };
    expect(campaignNumberLine({ ...n, status: "live", gone: false })).toBe(
      "spring  live  4 in  1 converted  2 now  1 deal",
    );
    expect(campaignNumberLine({ ...n, status: "ended", gone: true, deals: 0 })).toBe(
      "spring  gone  4 in  1 converted  2 now  0 deals",
    );
  });

  it("registers list, show and numbers", () => {
    const p = new Command("wren");
    registerCampaigns(p, (async () => {
      throw new Error("no database in this test");
    }) as never);
    expect(p.commands[0]?.commands.map((c) => c.name())).toEqual(["list", "show", "numbers"]);
  });
});
