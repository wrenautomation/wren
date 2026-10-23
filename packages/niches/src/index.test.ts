/**
 * The registry, and golden parity with the Python port for each niche's sequences (name, arm,
 * steps and days). A niche carries no copy: the template store holds every word.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { twoEmailSequence } from "@wren/channel-email";
import { OFFER_IDS } from "@wren/offers";
import { describe, expect, it } from "vitest";
import {
  agencies,
  crawlHintsFor,
  defineNiche,
  discoveryWordsFor,
  exaSearchFor,
  FACTS_VIEWS,
  NICHES,
  recruiting,
  requireNiche,
  SEQUENCES_BY_NICHE,
  SMS_SEQUENCES,
  secRia,
} from "./index.js";

interface GoldenSequence {
  niche: string;
  name: string;
  arm: string | null;
  steps: { template: string; day: number }[];
}
const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("../test/golden.json", import.meta.url)), "utf8"),
) as { sequences: GoldenSequence[] };

describe("golden parity with emails_gen", () => {
  // Niches born in TS (recruiting) have no Python golden: nothing stored predates them.
  const ported = new Set(golden.sequences.map((g) => g.niche));
  it("sequences match", () => {
    const ours = NICHES.filter((n) => ported.has(n.name)).flatMap((n) =>
      [...n.sequences.values()].map((s) => ({
        niche: n.name,
        name: s.name,
        arm: s.arm,
        steps: s.steps.map((st) => ({ template: st.template, day: st.day })),
      })),
    );
    const key = (s: { niche: string; name: string }) => `${s.niche}:${s.name}`;
    expect([...ours].sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
      [...golden.sequences].sort((a, b) => key(a).localeCompare(key(b))),
    );
  });
});

describe("registry", () => {
  it("names, views and landers", () => {
    expect(NICHES.map((n) => n.name)).toEqual(["sec_ria", "agencies", "recruiting"]);
    expect([...FACTS_VIEWS]).toEqual([
      ["sec_ria", "firm_facts"],
      ["agencies", "agency_facts"],
      ["recruiting", "recruiting_facts"],
    ]);
    expect(secRia.lander).toBe("/");
    expect(agencies.lander).toBe("/agencies");
    expect(recruiting.lander).toBe("/recruiting/lead-reactivation");
    expect(SEQUENCES_BY_NICHE.get("agencies")?.size).toBe(2);
    expect(SEQUENCES_BY_NICHE.get("sec_ria")?.size).toBe(1);
  });
  it("requireNiche refuses a typo and passes null", () => {
    expect(requireNiche(null)).toBeNull();
    expect(requireNiche("agencies")).toBe("agencies");
    expect(() => requireNiche("agency")).toThrow(
      /unknown niche 'agency' — registered: agencies, recruiting, sec_ria/,
    );
  });
  it("vocabulary unions when unscoped", () => {
    expect(crawlHintsFor("sec_ria").has("advisors")).toBe(true);
    expect(crawlHintsFor("sec_ria").has("crew")).toBe(false);
    expect(crawlHintsFor(null).has("crew")).toBe(true);
    expect(discoveryWordsFor(null).has("wealth")).toBe(true);
    expect(discoveryWordsFor("agencies").has("wealth")).toBe(false);
  });
  it("companyLocation reads the source's own key", () => {
    const company = { raw: { geo: "Boston, MA", Location: "Austin, TX" } } as never;
    expect(secRia.companyLocation(company)).toBe("Boston, MA");
    expect(agencies.companyLocation(company)).toBe("Austin, TX");
    expect(agencies.companyLocation({ raw: { Location: "  " } } as never)).toBeNull();
    expect(agencies.companyLocation({ raw: null } as never)).toBeNull();
  });
});

describe("offers", () => {
  const spec = {
    name: "t",
    label: "T",
    factsView: null,
    lander: "/agencies",
    crawlHints: [],
    discoveryGenericWords: [],
    sequences: [twoEmailSequence("build/opener", "build/followup")],
    plan: [{ sequence: "build-days-0-5" }],
    mailsRoleInboxes: true,
    companyLocation: () => null,
  };
  it("gives every registered sequence a registered offer", () => {
    for (const niche of NICHES) {
      expect([...niche.offers.keys()].sort()).toEqual([...niche.sequences.keys()].sort());
      for (const offer of niche.offers.values()) expect(OFFER_IDS.has(offer)).toBe(true);
    }
  });
  it("maps a sequence to its arm's offer", () => {
    const n = defineNiche({ ...spec, offers: { build: "ops-audit" } });
    expect(n.offers.get("build-days-0-5")).toBe("ops-audit");
  });
  it("refuses an arm with no offer", () => {
    expect(() => defineNiche({ ...spec, offers: {} })).toThrow(/arm 'build' names no offer/);
  });
  it("refuses an offer the registry does not know", () => {
    expect(() => defineNiche({ ...spec, offers: { build: "ghost" } })).toThrow(/unknown offer/);
  });
  it("refuses an offer named for an arm nothing opens in", () => {
    expect(() =>
      defineNiche({ ...spec, offers: { build: "ops-audit", marketing: "ops-audit" } }),
    ).toThrow(/no sequence opens in: marketing/);
  });
  it("refuses a lander no live offer is served on", () => {
    expect(() => defineNiche({ ...spec, lander: "/ria", offers: { build: "ops-audit" } })).toThrow(
      /lander '\/ria' is no live offer's page/,
    );
  });
  it("fills offer.* facts from the arm's offer", () => {
    const facts = recruiting.offerFacts.get("reactivation");
    expect(facts).toMatchObject({
      "offer.days": "90",
      "offer.slots": "3",
      "offer.page": "/recruiting/lead-reactivation",
    });
  });
  it("loads with no copy anywhere: a niche is shape, the words live in the store", () => {
    const n = defineNiche({ ...spec, offers: { build: "ops-audit" } });
    expect([...n.sequences.keys()]).toEqual(["build-days-0-5"]);
    expect(n.plan).toEqual([{ sequence: "build-days-0-5" }]);
    expect("templates" in n).toBe(false);
    // Every registered niche loads the same way: no file read at import.
    expect(NICHES.every((x) => x.sequences.size > 0)).toBe(true);
  });
});

describe("sms sequences", () => {
  it("recruiting firms and site applicants text; names are fleet-wide; code holds the shape, never the words", () => {
    expect([...SMS_SEQUENCES.keys()]).toEqual([
      "form-fit",
      "form-not-fit",
      "speed-to-lead",
      "recruiting-sms",
    ]);
    expect(secRia.smsSequences.size).toBe(0);
    expect(agencies.smsSequences.size).toBe(0);
    const seq = SMS_SEQUENCES.get("recruiting-sms");
    expect(seq?.steps).toEqual([
      { step: 1, afterDays: 0 },
      { step: 2, afterDays: 3 },
    ]);
  });
});

describe("exaSearchFor", () => {
  it("Wren's niches list searches with a city slot and the 25 largest US metros; sec_ria lists none", () => {
    for (const niche of ["recruiting", "agencies"]) {
      const { queries, cities } = exaSearchFor(niche);
      expect(queries.length).toBeGreaterThan(0);
      expect(queries.every((q) => q.includes("{city}"))).toBe(true);
      expect(new Set(cities).size).toBe(25);
    }
    expect(exaSearchFor("sec_ria").queries).toEqual([]);
  });
});
