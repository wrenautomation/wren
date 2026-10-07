/** defineNiche merges a niche's `recontact` overrides over the lead-recycling defaults. */
import { DEFAULT_RECONTACT, threeEmailSequence } from "@wren/channel-email";
import { describe, expect, it } from "vitest";
import { agencies, defineNiche, NICHES, templatesDir } from "./index.js";

const spec = {
  name: "t",
  factsView: null,
  lander: "/agencies",
  crawlHints: [],
  discoveryGenericWords: [],
  templatesDir: templatesDir("agencies"),
  sequences: [threeEmailSequence("build/opener", "build/followup", "final_followup")],
  plan: [{ sequence: "build-days-0-3-7" }],
  mailsRoleInboxes: true,
  offers: { build: "ops-audit" },
  companyLocation: () => null,
};

describe("niche recontact", () => {
  it("defaults when the spec sets none", () => {
    expect(defineNiche(spec).recontact).toEqual(DEFAULT_RECONTACT);
  });
  it("merges overrides over the defaults", () => {
    const n = defineNiche({
      ...spec,
      recontact: { restDays: { no_reply: 60, not_interested: null }, perYear: 3 },
    });
    expect(n.recontact).toEqual({
      restDays: { ...DEFAULT_RECONTACT.restDays, no_reply: 60, not_interested: null },
      perYear: 3,
    });
  });
  it("names the niche when an override is bad", () => {
    expect(() =>
      defineNiche({
        ...spec,
        recontact: { restDays: { warm: 10 } as unknown as { no_reply: number } },
      }),
    ).toThrow(/niche 't': 'warm' is not a resting outcome/);
    expect(() => defineNiche({ ...spec, recontact: { restDays: { bounced: -1 } } })).toThrow(
      /niche 't': rest for 'bounced' must be whole days/,
    );
    expect(() => defineNiche({ ...spec, recontact: { perYear: 0 } })).toThrow(
      /niche 't': perYear must be a whole number/,
    );
  });
  it("every registered niche carries a checked policy", () => {
    for (const niche of NICHES) {
      expect(niche.recontact.perYear).toBeGreaterThanOrEqual(1);
      expect(Object.keys(niche.recontact.restDays).sort()).toEqual(
        Object.keys(DEFAULT_RECONTACT.restDays).sort(),
      );
    }
    expect(agencies.recontact).toBeDefined();
  });
});
