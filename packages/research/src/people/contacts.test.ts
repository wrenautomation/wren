/** People who hire at a firm, from a people search's profiles. */
import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { findContacts, splitName } from "./contacts.js";

type Role = { title: string; company: string; current: boolean };
type Person = { name: string; url: string; roles: Role[] };
function peopleSearch(people: Person[]): SiteClient & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async call(_site, _method, path, input = {}) {
      if (path !== "/people") throw new Error(`asked ${path}`);
      queries.push(String((input as { q: string }).q));
      return { people, via: "exa" } as never;
    },
    async via() {
      return "api";
    },
  };
}
const li = (v: string) => `https://ca.linkedin.com/in/${v}`;
const firm = { name: "Umbrella Health", domain: "umbrellahealth.com" };
const at = (title: string, company: string, current = true): Role => ({ title, company, current });

describe("splitName", () => {
  it("drops credentials and parentheses; refuses an initial for a surname", () => {
    expect(splitName("Jane Doe, SHRM-CP")).toEqual({ first: "Jane", last: "Doe" });
    expect(splitName("Jane (JJ) Mary Doe")).toEqual({ first: "Jane", last: "Doe" });
    expect(splitName("Jane D.")).toBeNull();
    expect(splitName("Jane")).toBeNull();
  });
});

describe("findContacts", () => {
  it("keeps hiring roles at the firm; says who is there now and where the rest went", async () => {
    const s = peopleSearch([
      {
        name: "Jane Doe",
        url: li("janedoe"),
        roles: [at("Talent Acquisition Lead", "Umbrella Health")],
      },
      { name: "Bob Roe", url: li("bobroe"), roles: [at("Software Engineer", "Umbrella Health")] },
      {
        name: "Cara Lim",
        url: li("caralim"),
        roles: [at("Senior Recruiter", "Globex"), at("Recruiter", "Umbrella Health", false)],
      },
      { name: "Dan Wu", url: li("danwu"), roles: [at("HR Manager", "Initech")] },
      {
        name: "Eve Ng",
        url: "https://example.com/eve",
        roles: [at("Recruiter", "Umbrella Health")],
      },
      {
        name: "Jane Doe",
        url: li("JaneDoe/"),
        roles: [at("Talent Acquisition Lead", "Umbrella Health")],
      },
    ]);
    const found = await findContacts(s, firm, { max: 5 });
    expect(s.queries).toEqual([
      "talent acquisition, recruiting, HR, or people team people who work or worked at Umbrella Health",
    ]);
    expect(found).toEqual([
      {
        fullName: "Jane Doe",
        firstName: "Jane",
        lastName: "Doe",
        title: "Talent Acquisition Lead",
        currentCompany: "Umbrella Health",
        current: true,
        linkedin: "https://www.linkedin.com/in/janedoe/",
      },
      {
        fullName: "Cara Lim",
        firstName: "Cara",
        lastName: "Lim",
        title: "Recruiter",
        currentCompany: "Globex",
        current: false,
        linkedin: "https://www.linkedin.com/in/caralim/",
      },
    ]);
  });

  it("stops at max", async () => {
    const people = ["a", "b", "c"].map((v) => ({
      name: `Ann ${v}son`,
      url: li(`ann-${v}`),
      roles: [at("Recruiter", "Umbrella Health")],
    }));
    expect(await findContacts(peopleSearch(people), firm, { max: 2 })).toHaveLength(2);
  });

  it("a firm with no usable name asks nothing", async () => {
    const s = peopleSearch([]);
    expect(await findContacts(s, { name: null, domain: null })).toEqual([]);
    expect(s.queries).toEqual([]);
  });
});
