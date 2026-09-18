/**
 * The deterministic testimonial classifier: precision over recall. A false
 * positive silently deletes a real founder from the send list, so the staff
 * cases are the important half. Every one is a real title from the agencies pilot.
 */
import { describe, expect, it } from "vitest";
import { classifyTitle, documentUrlFrom, isOwnCompany } from "./testimonials.js";

const STAFF: Array<[string | null, string]> = [
  // Two hats at one company, not an employer after the comma.
  ["Founder, CEO", "Anywhere"],
  ["CEO, Founder", "Anywhere"],
  ["Partner, Strategy", "Anywhere"],
  ["VP, Operations", "Anywhere"],
  ["HEAD OF CREATIVE, FOUNDER", "Anywhere"],
  ["Director, Growth and Strategy", "Anywhere"],
  ["Principal, Creative Director", "Anywhere"],
  ["Founder, Certified Shopify Expert", "Anywhere"],
  ["Founder, Shopify Expert", "Anywhere"],
  // Departments, whimsy and regions read like proper nouns but are not.
  ["VP, Public Relations", "Anywhere"],
  ["Director of User Experience", "Anywhere"],
  ["Senior Designer, Visual Storyteller", "Anywhere"],
  ["International Growth Strategist, Latin America", "Anywhere"],
  ["Executive Assistant - Data Processing", "Anywhere"],
  ["Senior Web Developer | Shopify Expert", "Anywhere"],
  // The agency's own name, written into the title.
  ["President, Big Sea", "Big Sea"],
  ["Partner, MBLM", "MBLM"],
  ["Product Design & UX Leader, Neuron Co-Founder and Senior Advisor", "Neuron"],
  ["CEO at Loona Agency", "Loona Agency"],
  ["Managing Director at DataArt UK", "DataArt"],
  ["Founder of Lifted Websites", "LiftedWebsites.com"],
  // A sub-brand is still the same house.
  ["Director of Operations, Disruptive University", "Disruptive Advertising"],
  [null, "Anywhere"],
  ["   ", "Anywhere"],
];

const TESTIMONIALS: Array<[string, string, string, string]> = [
  ["President, Cordelia Labs", "Big Sea", "Cordelia Labs", "title_org_suffix"],
  ["CEO at Acme Inc", "Verdano", "Acme Inc", "title_org_suffix"],
  ["Marketing Director, Blue Bottle Coffee", "Verdano", "Blue Bottle Coffee", "title_org_suffix"],
  ["Owner of Hillside Dental", "Verdano", "Hillside Dental", "title_org_suffix"],
  ["Founder @ Northwind Traders", "Verdano", "Northwind Traders", "title_org_suffix"],
  ["Owner, Bright Smiles Dental", "Verdano", "Bright Smiles Dental", "title_org_suffix"],
  ["CMO, Axolotl Planet", "Nativz", "Axolotl Planet", "title_proper_noun"],
  ["VP, HEST Investments", "Nativz", "HEST Investments", "title_org_suffix"],
];

describe("classifyTitle", () => {
  it.each(STAFF)("staff title %j is never tagged", (title, companyName) => {
    expect(classifyTitle(title, { companyName })).toBeNull();
  });

  it.each(TESTIMONIALS)(
    "client title %j is tagged with the organization",
    (title, companyName, org, method) => {
      const tag = classifyTitle(title, { companyName });
      expect(tag).not.toBeNull();
      expect([tag?.org, tag?.method, tag?.matched]).toEqual([org, method, org]);
    },
  );

  it("a single-word org needs a client page and never the URL alone", () => {
    // The URL only relaxes the two-word requirement; it cannot rescue a phrase that reads as a role.
    expect(classifyTitle("Founder, CEO @ Roam", { companyName: "Startupr" })).toBeNull();
    const tag = classifyTitle("Founder, CEO @ Roam", {
      companyName: "Startupr",
      documentUrl: "https://startupr.example/client-reviews/",
    });
    expect([tag?.org, tag?.method]).toEqual(["Roam", "title_proper_noun_testimonial_page"]);
    expect(
      classifyTitle("Founder, CEO", {
        companyName: "Startupr",
        documentUrl: "https://startupr.example/client-reviews/",
      }),
    ).toBeNull();
  });

  it("scope separators demand a company suffix", () => {
    expect(classifyTitle("Director of Enterprise Sales", { companyName: "Verdano" })).toBeNull();
    expect(classifyTitle("Head of Northwind", { companyName: "Verdano" })).toBeNull();
    expect(classifyTitle("Owner of Hillside Dental", { companyName: "Verdano" })).not.toBeNull();
  });

  it("the last org-looking phrase wins", () => {
    expect(classifyTitle("Founder, CEO, Cordelia Labs", { companyName: "Big Sea" })?.org).toBe(
      "Cordelia Labs",
    );
  });
});

describe("isOwnCompany", () => {
  it("matches a shared distinctive word or a squashed substring", () => {
    expect(isOwnCompany("Big Sea", "Big Sea Agency")).toBe(true);
    expect(isOwnCompany("Lifted Websites", "LiftedWebsites.com")).toBe(true);
    expect(isOwnCompany("Cordelia Labs", "Big Sea")).toBe(false);
    expect(isOwnCompany("Inc", null)).toBe(true);
  });
});

describe("documentUrlFrom", () => {
  it("reads the origin_ref tail, then raw._document_url", () => {
    expect(documentUrlFrom({ originRef: "enrichment:3 https://x.example/team", raw: {} })).toBe(
      "https://x.example/team",
    );
    expect(
      documentUrlFrom({ originRef: "enrichment:3", raw: { _document_url: "https://y.example" } }),
    ).toBe("https://y.example");
    expect(documentUrlFrom({ originRef: "", raw: null })).toBeNull();
  });
});
