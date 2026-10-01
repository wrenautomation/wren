/**
 * Golden parity with the Python port: every real template's content-hash `version`,
 * round-trip source, placeholder render and full variant enumeration must match what
 * emails_gen produced, so stored `messages.template_version` rows stay valid.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  enumerateRenders,
  placeholderFacts,
  render,
  threeEmailSequence,
  toSource,
  twoEmailSequence,
  variantCounts,
} from "@wren/channel-email";
import { OFFER_IDS } from "@wren/offers";
import { describe, expect, it } from "vitest";
import {
  agencies,
  crawlHintsFor,
  defineNiche,
  discoveryWordsFor,
  FACTS_VIEWS,
  NICHES,
  nicheFor,
  recruiting,
  requireNiche,
  SEQUENCES_BY_NICHE,
  SMS_SEQUENCES,
  secRia,
  TEMPLATES_BY_NICHE,
  templatesDir,
} from "./index.js";

interface GoldenTemplate {
  niche: string;
  name: string;
  version: string;
  source: string;
  variant_counts: Record<string, number>;
  placeholder: { subject: string | null; body: string; provenance: Record<string, unknown> };
  enumerated: [Record<string, number>, { subject: string | null; body: string }][];
}
interface GoldenSequence {
  niche: string;
  name: string;
  arm: string | null;
  steps: { template: string; day: number }[];
}
const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("../test/golden.json", import.meta.url)), "utf8"),
) as { templates: GoldenTemplate[]; sequences: GoldenSequence[] };

describe("golden parity with emails_gen", () => {
  // Niches born in TS (recruiting) have no Python golden: nothing stored predates them.
  const ported = new Set(golden.templates.map((g) => g.niche));
  it("covers every registered template of a ported niche and nothing else", () => {
    const ours = NICHES.filter((n) => ported.has(n.name))
      .flatMap((n) => [...n.templates.keys()].map((t) => `${n.name}:${t}`))
      .sort();
    const theirs = golden.templates.map((g) => `${g.niche}:${g.name}`).sort();
    expect(ours).toEqual(theirs);
  });
  for (const g of golden.templates) {
    describe(`${g.niche}/${g.name}`, () => {
      const tpl = () => {
        const t = nicheFor(g.niche).templates.get(g.name);
        if (t === undefined) throw new Error(`missing ${g.name}`);
        return t;
      };
      it("version hash matches Python", () => expect(tpl().version).toBe(g.version));
      it("to_source matches", () => expect(toSource(tpl())).toBe(g.source));
      it("variant counts match", () => expect(variantCounts(tpl())).toEqual(g.variant_counts));
      it("placeholder render matches (subject, body, provenance)", () => {
        const r = render(tpl(), placeholderFacts(tpl()), "person:7");
        expect(r.subject).toBe(g.placeholder.subject);
        expect(r.body).toBe(g.placeholder.body);
        expect(r.provenance).toEqual(g.placeholder.provenance);
      });
      it("every variant combination renders identically", () => {
        const ours = [...enumerateRenders(tpl(), placeholderFacts(tpl()))].map(([c, r]) => [
          c,
          { subject: r.subject, body: r.body },
        ]);
        expect(ours).toEqual(g.enumerated);
      });
    });
  }
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
    expect(TEMPLATES_BY_NICHE.get("agencies")?.size).toBe(5);
    expect(SEQUENCES_BY_NICHE.get("sec_ria")?.size).toBe(4);
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
  it("every opener has a subject and every followup rides the thread", () => {
    for (const n of NICHES) {
      for (const s of n.sequences.values()) {
        const [opener, ...rest] = s.steps;
        expect(n.templates.get(opener?.template ?? "")?.subject).not.toBeNull();
        for (const st of rest) expect(n.templates.get(st.template)?.subject).toBeNull();
      }
    }
  });
});

describe("offers", () => {
  const spec = {
    name: "t",
    factsView: null,
    lander: "/agencies",
    crawlHints: [],
    discoveryGenericWords: [],
    templatesDir: templatesDir(import.meta.url, "agencies"),
    sequences: [threeEmailSequence("build/opener", "build/followup", "final_followup")],
    plan: [{ sequence: "build-days-0-3-7" }],
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
    expect(n.offers.get("build-days-0-3-7")).toBe("ops-audit");
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
  it("refuses a template quoting an offer.* key its offer does not set", () => {
    expect(() =>
      defineNiche({
        ...spec,
        templatesDir: templatesDir(import.meta.url, "recruiting"),
        sequences: [twoEmailSequence("book-first/opener", "book-first/followup")],
        plan: [{ sequence: "book-first-days-0-5" }],
        offers: { "book-first": "ops-audit" },
      }),
    ).toThrow(/quotes offer\.days, offer\.goal, offer\.slots, which offer 'ops-audit' does not set/);
  });
});

describe("sms sequences", () => {
  it("agencies and site applicants text; names are fleet-wide; code holds the shape, never the words", () => {
    expect([...SMS_SEQUENCES.keys()]).toEqual(["form-fit", "form-not-fit", "agencies-sms"]);
    expect(secRia.smsSequences.size).toBe(0);
    const seq = SMS_SEQUENCES.get("agencies-sms");
    expect(seq?.steps).toEqual([
      { step: 1, afterDays: 0 },
      { step: 2, afterDays: 3 },
    ]);
  });
});
