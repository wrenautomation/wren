/** Candidate generation and the ownership gate (discovery L1). */
import { describe, expect, it } from "vitest";
import { domainCandidates, nameTokens } from "./candidates.js";
import { gatePage, registryDigits } from "./gate.js";

const GENERIC = new Set(["wealth", "management", "advisors", "capital"]);

describe("nameTokens", () => {
  it("drops legal suffixes and stopwords", () =>
    expect(nameTokens("The Acme Wealth Management, LLC")).toEqual([
      "acme",
      "wealth",
      "management",
    ]));
  it("ampersand reads as 'and' and is dropped", () =>
    expect(nameTokens("Smith & Jones Capital")).toEqual(["smith", "jones", "capital"]));
});

describe("domainCandidates", () => {
  it("most specific first, with generic dropping", () => {
    const c = domainCandidates("Acme Wealth Management LLC", { genericWords: GENERIC });
    expect(c[0]).toBe("acmewealthmanagement.com");
    expect(c).toContain("acmewealth.com");
    expect(c).toContain("acme.com");
    expect(c.length).toBeLessThanOrEqual(6);
    expect(new Set(c).size).toBe(c.length);
  });
  it("empty and junk names", () => {
    expect(domainCandidates("LLC")).toEqual([]);
    expect(domainCandidates("")).toEqual([]);
  });
  it("single-word firm", () =>
    expect(domainCandidates("BlackRock Inc")).toContain("blackrock.com"));
});

describe("ownership gate", () => {
  it("registryDigits", () => {
    expect(registryDigits("crd:105734")).toBe("105734");
    expect(registryDigits("crd:")).toBeNull();
    expect(registryDigits(null)).toBeNull();
    expect(registryDigits("crd:12")).toBeNull(); // too short to be distinctive
  });
  const gate = (text: string, o: { title?: string; name?: string; key?: string } = {}) =>
    gatePage({
      url: "https://acme.example",
      pageTitle: o.title ?? "",
      pageText: text,
      companyName: o.name ?? "Acme Wealth Management LLC",
      sourceKey: o.key ?? "crd:105734",
      genericWords: GENERIC,
    });
  it("full name on page passes", () => {
    const e = gate("Welcome to Acme Wealth Management — fiduciary advice.");
    expect(e?.matched_tokens).toContain("acme");
    expect(e?.matched_registry_key).toBe(false);
  });
  it("distinctive token alone fails when the name has generic words", () =>
    expect(gate("Acme widgets, best prices on acme supplies.")).toBeNull());
  it("registry number alone passes", () =>
    expect(
      gate("Registered investment adviser. CRD 105734. Contact us.")?.matched_registry_key,
    ).toBe(true));
  it("generic-only name needs the registry number", () =>
    expect(
      gate("Wealth management for families.", { name: "Wealth Management Advisors" }),
    ).toBeNull());
  it("title text counts", () =>
    expect(gate("", { title: "Acme Wealth Management | Home" })).not.toBeNull());
  it("substring cannot fake a token", () => expect(gate("acmeco wealth management")).toBeNull());
});
