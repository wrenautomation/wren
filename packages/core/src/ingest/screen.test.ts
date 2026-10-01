import { describe, expect, it } from "vitest";
import {
  type CompanyScreen,
  chainSizes,
  domainCountry,
  publicBodyName,
  type ScreenedCompany,
  screenCompany,
} from "./screen.js";

const firm = (over: Partial<ScreenedCompany> = {}): ScreenedCompany => ({
  id: 1,
  domain: "acme.example",
  name: "Acme Staffing",
  country: "US",
  raw: {},
  ...over,
});
const screen: CompanyScreen = { countries: ["US", "CA"], chainAt: 3 };

describe("publicBodyName", () => {
  it("government offices by name", () => {
    for (const name of [
      "County of Middlesex One-Stop",
      "Vermont Department Of Labor",
      "State of Nevada",
      "Texas State of",
      "Baltimore County",
      "Employment Security Commission of N C",
      "Los Angeles Unified School District",
    ])
      expect(publicBodyName(name), name).toBe(true);
  });

  it("a firm keeps its name: an entity suffix or a staffing word wins", () => {
    for (const name of [
      "City of Presidents Recruiting",
      "County Staffing LLC",
      "Global Recruiters Of Denton County",
      "Big State Staffing",
      "Acme Workforce Solutions",
    ])
      expect(publicBodyName(name), name).toBe(false);
  });
});

describe("domainCountry", () => {
  it("a country ending names its country; generic and global endings name none", () => {
    expect(domainCountry("acme.co.uk")).toBe("GB");
    expect(domainCountry("acme.ca")).toBe("CA");
    expect(domainCountry("acme.io")).toBeNull();
    expect(domainCountry("acme.com")).toBeNull();
  });
});

describe("chainSizes", () => {
  it("firms under one parent, or the most places a source counted", () => {
    const sizes = chainSizes([
      firm({ domain: "a.big.example" }),
      firm({ domain: "b.big.example" }),
      firm({ domain: "solo.example", raw: { places_with_domain: 4 } }),
      firm({ domain: null }),
    ]);
    expect(sizes.get("big.example")).toBe(2);
    expect(sizes.get("solo.example")).toBe(4);
  });
});

describe("screenCompany", () => {
  const chains = new Map([["big.example", 3]]);
  const check = (over: Partial<ScreenedCompany>, s: CompanyScreen = screen) =>
    screenCompany(firm(over), s, chains);

  it("an independent firm at home is in play", () => {
    expect(check({})).toBeNull();
  });

  it("public body by host or by name", () => {
    expect(check({ domain: "twc.texas.gov" })).toBe("public_body");
    expect(check({ name: "Department of Labor" })).toBe("public_body");
    expect(check({ domain: "wit.twc.state.tx.us" })).toBe("public_body");
    expect(check({ domain: "ci.milford.ct.us" })).toBe("public_body");
    expect(check({ domain: "alberta.ca" })).toBe("public_body");
    expect(check({ domain: "acme.us" })).toBeNull();
  });

  it("a job board or applicant-tracking page is no firm's site", () => {
    expect(check({ domain: "acme.applytojob.com" })).toBe("platform_site");
    expect(check({ domain: "butler.wd1.myworkdayjobs.com" })).toBe("platform_site");
    expect(check({ domain: "ziprecruiter.com" })).toBe("platform_site");
  });

  it("foreign by the stored country or the domain's ending; unknown country passes", () => {
    expect(check({ country: "GB" })).toBe("foreign");
    expect(check({ domain: "acme.co.uk" })).toBe("foreign");
    expect(check({ country: null })).toBeNull();
  });

  it("the niche's rule, then chain by parent domain", () => {
    expect(check({ domain: "x.big.example" })).toBe("chain");
    expect(check({ domain: "x.big.example" }, { ...screen, decline: () => "mine" })).toBe("mine");
    expect(check({ domain: null })).toBeNull();
  });
});
