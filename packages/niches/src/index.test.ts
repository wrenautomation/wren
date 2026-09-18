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
  toSource,
  variantCounts,
} from "@wren/channel-email";
import { describe, expect, it } from "vitest";
import {
  agencies,
  crawlHintsFor,
  discoveryWordsFor,
  FACTS_VIEWS,
  NICHES,
  nicheFor,
  requireNiche,
  SEQUENCES_BY_NICHE,
  secRia,
  TEMPLATES_BY_NICHE,
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
  it("covers every registered template and nothing else", () => {
    const ours = NICHES.flatMap((n) => [...n.templates.keys()].map((t) => `${n.name}:${t}`)).sort();
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
    const ours = NICHES.flatMap((n) =>
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
    expect(NICHES.map((n) => n.name)).toEqual(["sec_ria", "agencies"]);
    expect([...FACTS_VIEWS]).toEqual([
      ["sec_ria", "firm_facts"],
      ["agencies", "agency_facts"],
    ]);
    expect(secRia.lander).toBe("/ria");
    expect(agencies.lander).toBe("/agencies");
    expect(TEMPLATES_BY_NICHE.get("agencies")?.size).toBe(5);
    expect(SEQUENCES_BY_NICHE.get("sec_ria")?.size).toBe(4);
  });
  it("requireNiche refuses a typo and passes null", () => {
    expect(requireNiche(null)).toBeNull();
    expect(requireNiche("agencies")).toBe("agencies");
    expect(() => requireNiche("agency")).toThrow(
      /unknown niche 'agency' — registered: agencies, sec_ria/,
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
