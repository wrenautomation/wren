import { describe, expect, it } from "vitest";
import { linkedinPersonRow } from "./linkedin.js";

const row = (over: Record<string, string>) => ({
  full_name: "Jamie Sarner",
  title: "Founder | Partner",
  company_name: "Austin Birch",
  website: "http://www.austinbirch.com",
  linkedin_url: "https://www.linkedin.com/in/jamie-sarner-7ab9381a/",
  company_linkedin: "https://www.linkedin.com/company/austin-birch/",
  source: "linkedin",
  ...over,
});

describe("linkedin people rows", () => {
  it("company by website domain, person by profile handle", () => {
    expect(linkedinPersonRow(row({}), "f.csv")).toMatchObject({
      kind: "person",
      fullName: "Jamie Sarner",
      firstName: "Jamie",
      lastName: "Sarner",
      title: "Founder | Partner",
      companyDomain: "austinbirch.com",
      companySourceKey: null,
      companyName: "Austin Birch",
      sourceKey: "li:jamie-sarner-7ab9381a",
      origin: "linkedin",
      originRef: "https://www.linkedin.com/in/jamie-sarner-7ab9381a/",
    });
  });

  it("no website, or a platform one: the company's LinkedIn page keys it", () => {
    for (const website of ["", "https://www.facebook.com/austinbirch"])
      expect(linkedinPersonRow(row({ website }), "f.csv")).toMatchObject({
        companyDomain: null,
        companySourceKey: "li-co:austin-birch",
      });
  });

  it("no company at all is an error that keeps the row", () => {
    const r = linkedinPersonRow(row({ website: "", company_linkedin: "" }), "f.csv");
    expect(r).toMatchObject({ kind: "error", raw: { full_name: "Jamie Sarner" } });
  });
});
