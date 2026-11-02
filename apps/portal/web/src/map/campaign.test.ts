import type { MetroBody } from "@wren/pipeline/metro";
import { describe, expect, it } from "vitest";
import { type CampaignValues, ctaStations, fieldsOf, valuesOf } from "./campaign-fields.js";
import { campaignSays } from "./model.js";

describe("campaignSays", () => {
  it("says no numbers without a row", () => {
    expect(campaignSays(undefined)).toEqual(["No numbers yet."]);
  });

  it("says people, converted, now, deals, then the acts by name", () => {
    expect(
      campaignSays({
        campaign: "guide",
        label: "Guide",
        status: "live",
        gone: false,
        people: 12,
        converted: 3,
        now: 4,
        deals: 1,
        acts: { "linkedin.invite": 5, "email.opener": 9 },
      }),
    ).toEqual([
      "People in: 12",
      "Converted: 3",
      "Now: 4",
      "Deals: 1",
      "email.opener: 9",
      "linkedin.invite: 5",
    ]);
  });
});

const blank: CampaignValues = {
  status: "",
  from: "",
  until: "",
  offer: "",
  segment: "",
  lines: [],
  ctas: [],
  accounts: [],
  caps: [],
};

describe("valuesOf, fieldsOf", () => {
  it("round-trips a full campaign", () => {
    const own = {
      offer: "starter",
      audience: { segment: "7", lines: ["yt"] },
      ctas: [{ label: "Get the guide", station: "form" }],
      accounts: { linkedin: "william" },
      caps: { "linkedin.comment": 20 },
      from: "2026-11-01",
      until: "2026-12-01",
      status: "paused" as const,
    };
    expect(fieldsOf(valuesOf(own))).toEqual(own);
  });

  it("leaves out empty fields and half-filled rows, so they inherit", () => {
    expect(fieldsOf(blank)).toEqual({});
    expect(
      fieldsOf({
        ...blank,
        segment: "  ",
        ctas: [{ label: "", station: "" }],
        accounts: [{ channel: "x", account: " " }],
        caps: [{ channel: "email", act: "opener", n: "" }],
      }),
    ).toEqual({});
  });

  it("keeps a CTA with no station, so the server says why", () => {
    expect(fieldsOf({ ...blank, ctas: [{ label: "Book", station: "" }] }).ctas).toEqual([
      { label: "Book", station: "" },
    ]);
  });

  it("splits a cap key at its first dot and reads the number", () => {
    const v = valuesOf({ caps: { "email.opener": 40 } });
    expect(v.caps).toEqual([{ channel: "email", act: "opener", n: "40" }]);
    expect(fieldsOf(v).caps).toEqual({ "email.opener": 40 });
  });
});

describe("ctaStations", () => {
  const metro: MetroBody = {
    model: "metro",
    name: "Sample",
    lines: [{ id: "web", label: "Webinar", tier: "front" }],
    stations: [
      { id: "form", label: "Form", kind: "att", line: "web", column: "sales", action: "form" },
      { id: "book", label: "Book", kind: "att", line: "web", column: "sales", action: "book" },
      { id: "wait", label: "Wait", kind: "time", line: "web", column: "sales" },
      { id: "out", label: "Out", kind: "att", line: "web", column: "sales", action: "cta" },
    ],
    tracks: [],
    groups: [
      { id: "top", label: "Top", line: "web", stations: ["form", "wait"], campaign: {} },
      { id: "sub", label: "Sub", line: "web", parent: "top", stations: ["book"] },
      { id: "other", label: "Other", line: "web", stations: ["out"], campaign: {} },
    ],
    frames: [],
  };

  it("takes CTA stations in the group and the groups under it", () => {
    expect(ctaStations(metro, "top").map((s) => s.id)).toEqual(["form", "book"]);
    expect(ctaStations(metro, "sub").map((s) => s.id)).toEqual(["book"]);
  });
});
