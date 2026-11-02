import { describe, expect, it } from "vitest";
import { capLeft, type LoopCampaign, sweepsOn } from "./campaigns.js";

describe("capLeft", () => {
  it("is the smaller of the global left and the campaign cap left", () => {
    expect(capLeft(30, undefined, 0)).toBe(30);
    expect(capLeft(30, 10, 4)).toBe(6);
    expect(capLeft(3, 10, 4)).toBe(3);
    expect(capLeft(30, 10, 12)).toBe(0);
    expect(capLeft(-2, 10, 0)).toBe(0);
  });
});

describe("sweepsOn", () => {
  const live: LoopCampaign[] = [
    { id: "top", accounts: { linkedin: "LinkedIn@wren" }, caps: { "linkedin.invite": 5 } },
    { id: "alt", accounts: { linkedin: "linkedin@alt" }, caps: {} },
    { id: "mail", accounts: { email: "a@mail.test" }, caps: {} },
    { id: "seg", accounts: { linkedin: "linkedin@wren" }, audience: { segment: "4" }, caps: {} },
  ];

  it("walks the account's campaigns in body order, then the default", () => {
    expect(sweepsOn(live, "linkedin", "invite", "linkedin@wren")).toEqual([
      { campaign: "top", segment: null, cap: 5 },
      { campaign: "seg", segment: 4 },
      { campaign: null, segment: null },
    ]);
  });

  it("is the default alone when no campaign acts as the account", () => {
    expect(sweepsOn(live, "x", "comment", "x@wren")).toEqual([{ campaign: null, segment: null }]);
  });
});
