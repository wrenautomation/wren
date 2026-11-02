import { PLATFORMS } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { ctx, metroShape } from "../test/fixtures.js";
import { checkMetro, type MetroBody } from "./metro.js";
import {
  CAMPAIGN_CHANNELS,
  CAMPAIGN_STATUSES,
  type CampaignFields,
  CTA_ACTIONS,
  campaignOfStation,
  campaignsOf,
  DEFAULT_CAMPAIGN,
  liveCampaigns,
} from "./metro-campaigns.js";
import { ACTIONS } from "./model.js";

/** `metroShape()` plus campaign `spring` (book, prep, docs) and `late` inside it (held). */
const withCampaigns = (spring: CampaignFields = {}, late?: CampaignFields): MetroBody => {
  const b = metroShape();
  b.groups.push(
    {
      id: "spring",
      label: "Spring",
      line: "growth",
      stations: ["book", "docs", "prep"],
      campaign: spring,
    },
    {
      id: "late",
      label: "Late",
      line: "growth",
      parent: "spring",
      stations: ["held"],
      ...(late ? { campaign: late } : {}),
    },
  );
  return b;
};
const says = (b: MetroBody): string[] => checkMetro(b, ctx());

const FULL: CampaignFields = {
  offer: "offer-a",
  audience: { segment: "7", lines: ["social", "cold"] },
  ctas: [
    { label: "Get the guide", station: "docs" },
    { label: "Book a call", station: "book" },
  ],
  accounts: { linkedin: "william", email: "hello" },
  caps: { "linkedin.comment": 20, "email.opener": 50 },
  from: "2026-11-01",
  until: "2026-12-31",
  status: "live",
};

describe("campaign words", () => {
  it("are the ones the design names", () => {
    expect(CAMPAIGN_STATUSES).toEqual(["live", "paused", "ended"]);
    expect(CTA_ACTIONS.every((a) => (ACTIONS as readonly string[]).includes(a))).toBe(true);
    expect(DEFAULT_CAMPAIGN).toBe("default");
    expect([...CAMPAIGN_CHANNELS].sort()).toEqual([...PLATFORMS, "email", "sms"].sort());
  });
});

describe("campaign rules", () => {
  it("passes a full campaign and a bare one", () => {
    expect(says(withCampaigns(FULL, {}))).toEqual([]);
    expect(says(withCampaigns())).toEqual([]);
  });

  it("reserves the id default for any group", () => {
    const b = metroShape();
    b.groups.push({ id: "default", label: "Mine", line: "growth", stations: ["prep"] });
    expect(says(b)).toEqual(['Group id "default" is reserved for the default campaign.']);
  });

  it("refuses fields it does not know and a bad status", () => {
    const bad = { offer: "", status: "done", budget: 5 } as unknown as CampaignFields;
    expect(says(withCampaigns(bad))).toEqual([
      'Campaign "spring": budget is not a campaign field.',
      'Campaign "spring" names no offer.',
      'Campaign "spring" has status "done". Use live, paused, ended.',
    ]);
  });

  it("checks the audience against segments and out lines", () => {
    expect(says(withCampaigns({ audience: {} }))).toEqual([
      'Campaign "spring" needs an audience with a segment or lines.',
    ]);
    expect(says(withCampaigns({ audience: { segment: "8" } }))).toEqual([
      'Campaign "spring" names segment 8, which is archived. Restore it first.',
    ]);
    expect(says(withCampaigns({ audience: { segment: "x" } }))).toEqual([
      'Campaign "spring" names segment "x", which is not a group\'s number.',
    ]);
    expect(says(withCampaigns({ audience: { lines: ["nurture", "gone"] } }))).toEqual([
      'Campaign "spring" names audience line "nurture", which is not an out line.',
      'Campaign "spring" names audience line "gone", which does not exist.',
    ]);
  });

  it("takes a CTA only on a CTA station inside the campaign, once", () => {
    const ctas = [
      { label: "Prep", station: "prep" },
      { label: "Pay", station: "reply" },
      { label: "", station: "book" },
      { label: "Again", station: "book" },
      { label: "Ghost", station: "nowhere" },
    ];
    expect(says(withCampaigns({ ctas }))).toEqual([
      'Campaign "spring" CTA 1 names station "prep", whose action is not cta, form, visit, book.',
      'Campaign "spring" CTA 2 names station "reply", which is not inside the campaign.',
      'Campaign "spring" CTA 3 needs a label of 1 to 80 characters.',
      'Campaign "spring" CTA 4 names station "book" twice.',
      'Campaign "spring" CTA 5 names station "nowhere", which is not in the shape.',
    ]);
  });

  it("takes a CTA from a group below the campaign, not above it", () => {
    const b = withCampaigns({ ctas: [{ label: "Held", station: "held" }] }, {});
    const held = b.stations.find((s) => s.id === "held");
    if (held) held.action = "book";
    expect(says(b)).toEqual([]);
    expect(says(withCampaigns({}, { ctas: [{ label: "Book", station: "book" }] }))).toEqual([
      'Campaign "late" CTA 1 names station "book", which is not inside the campaign.',
    ]);
  });

  it("checks accounts, caps and dates", () => {
    const bad = {
      accounts: { myspace: "me", linkedin: "two words" },
      caps: {
        linkedin: 3,
        "myspace.post": 1,
        "x.comment": 2.5,
        "email.opener": 10_001,
        "email.send": 5,
        "linkedin.follow": 1,
        "reddit.post": 1,
        "sms.send": 1,
      },
      from: "2026-13-01",
      until: "soon",
    } as unknown as CampaignFields;
    expect(says(withCampaigns(bad))).toEqual([
      expect.stringContaining('has an account on "myspace"'),
      'Campaign "spring" account on linkedin needs an id of 1 to 120 characters, no spaces.',
      'Campaign "spring" has cap "linkedin". Use <channel>.<act>, as linkedin.comment.',
      expect.stringContaining('caps "myspace"'),
      'Campaign "spring" caps x.comment at 2.5. Use a whole number from 0 to 10000.',
      'Campaign "spring" caps email.opener at 10001. Use a whole number from 0 to 10000.',
      'Campaign "spring" caps email.send. email acts: opener.',
      'Campaign "spring" caps linkedin.follow. linkedin acts: invite, comment, post.',
      'Campaign "spring" caps sms.send. sms acts: opener.',
      'Campaign "spring" has from "2026-13-01". Use a date, YYYY-MM-DD.',
      'Campaign "spring" has until "soon". Use a date, YYYY-MM-DD.',
    ]);
  });

  it("refuses dates out of order, through inheritance too", () => {
    expect(says(withCampaigns({ until: "2026-11-30" }, { from: "2026-12-01" }))).toEqual([
      'Campaign "late" ends (2026-11-30) before it starts (2026-12-01).',
    ]);
  });

  it("keeps a child's cap at or under its parent's", () => {
    expect(
      says(
        withCampaigns({ caps: { "linkedin.comment": 10 } }, { caps: { "linkedin.comment": 12 } }),
      ),
    ).toEqual(['Campaign "late" caps linkedin.comment at 12, over the 10 of campaign "spring".']);
  });
});

describe("campaignsOf", () => {
  it("is one default campaign holding every station when no group is a campaign", () => {
    const b = metroShape();
    const all = campaignsOf(b);
    expect(all.map((c) => [c.id, c.status])).toEqual([["default", "live"]]);
    expect(all[0]?.stations).toEqual(b.stations.map((s) => s.id));
  });

  it("puts each station in its nearest campaign, the rest in the default", () => {
    const b = withCampaigns(FULL, {});
    const [def, spring, late] = campaignsOf(b);
    expect(spring?.stations).toEqual(["book", "prep", "docs"]);
    expect(late?.stations).toEqual(["held"]);
    expect(def?.stations).toContain("proposal");
    expect(def?.stations).toContain("gone");
    expect(campaignOfStation(b, "held")).toBe("late");
    expect(campaignOfStation(b, "reply")).toBe("default");
  });

  it("gives a station in a plain group below a campaign to that campaign", () => {
    const b = withCampaigns({ offer: "offer-a" });
    expect(campaignOfStation(b, "held")).toBe("spring");
    expect(campaignsOf(b).map((c) => c.id)).toEqual(["default", "spring"]);
  });

  it("fills unset fields from above; accounts and caps merge by key", () => {
    const late = campaignsOf(
      withCampaigns(FULL, { accounts: { linkedin: "wren" }, caps: { "linkedin.comment": 5 } }),
    )[2];
    expect(late).toMatchObject({
      parent: "spring",
      offer: "offer-a",
      ctas: FULL.ctas,
      accounts: { linkedin: "wren", email: "hello" },
      caps: { "linkedin.comment": 5, "email.opener": 50 },
      from: "2026-11-01",
      status: "live",
      own: { accounts: { linkedin: "wren" }, caps: { "linkedin.comment": 5 } },
    });
  });

  it("lets a paused or ended parent hold a live child", () => {
    const [, spring, late] = campaignsOf(withCampaigns({ status: "paused" }, { status: "live" }));
    expect(spring?.status).toBe("paused");
    expect(late?.status).toBe("paused");
    const [, , ended] = campaignsOf(withCampaigns({ status: "ended" }, { status: "paused" }));
    expect(ended?.status).toBe("ended");
    const [, , own] = campaignsOf(withCampaigns({ status: "paused" }, { status: "ended" }));
    expect(own?.status).toBe("ended");
  });

  it("survives a parent cycle on an unchecked body", () => {
    const b = withCampaigns({}, {});
    const spring = b.groups.find((g) => g.id === "spring");
    if (spring) spring.parent = "late";
    expect(campaignsOf(b).map((c) => c.id)).toEqual(["default", "spring", "late"]);
  });
});

describe("liveCampaigns", () => {
  it("runs live campaigns inside their dates in body order, never the default", () => {
    const b = withCampaigns({ from: "2026-11-01" }, { until: "2026-11-10" });
    expect(liveCampaigns(b, "2026-11-05").map((c) => c.id)).toEqual(["spring", "late"]);
    expect(liveCampaigns(b, "2026-11-11").map((c) => c.id)).toEqual(["spring"]);
    expect(liveCampaigns(b, "2026-10-31")).toEqual([]);
  });

  it("leaves out a paused campaign and the live ones it holds", () => {
    const b = withCampaigns({ status: "paused" }, { status: "live" });
    expect(liveCampaigns(b, "2026-11-05")).toEqual([]);
  });

  it("is none for a graph shape", () => {
    expect(liveCampaigns(null, "2026-11-05")).toEqual([]);
  });
});
