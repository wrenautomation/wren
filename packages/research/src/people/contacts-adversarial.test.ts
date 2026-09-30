/**
 * Adversarial tests for people who hire at a company (the demo seed's people).
 * A stranger kept as a past employee is the worst outcome: the demo then
 * claims a real person worked somewhere they didn't. Tests state what SHOULD
 * happen; a failing one is a bug.
 */
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
const li = (v: string) => `https://www.linkedin.com/in/${v}`;
const firm = { name: "Umbrella Health", domain: "umbrellahealth.example" };
const at = (title: string, company: string, current = true) => ({ title, company, current });

describe("splitName", () => {
  // Was a bug: "Dr." passes the two-letter check and becomes the first name; the seed then writes "Dr." in the CRM and guesses dr.doe@.
  it("an honorific is not the first name", () => {
    expect(splitName("Dr. Jane Doe")).toEqual({ first: "Jane", last: "Doe" });
  });

  // Was a bug: only credentials after a comma are dropped, so a suffix, a comma-less credential or an emoji becomes the surname (jane.jr@, jane.mba@, or no email at all).
  it("a suffix, credential or emoji after the name is not the surname", () => {
    const raws = ["Jane Doe Jr.", "Jane Doe MBA", "Jane Doe Ph.D.", "Jane Doe 🚀"];
    expect(raws.map((r) => splitName(r)?.last)).toEqual(["Doe", "Doe", "Doe", "Doe"]);
  });
});

describe("findContacts: people who never did this work at the firm", () => {
  it("a recruiter elsewhere who names the firm only in a title is not kept", async () => {
    const s = peopleSearch([
      {
        name: "Sam Fox",
        url: li("samfox"),
        roles: [at("Senior Recruiter, placing nurses at Umbrella Health", "Brightpath Staffing")],
      },
    ]);
    expect(await findContacts(s, firm)).toEqual([]);
  });

  it("someone at the firm in another line of work, recruiting elsewhere before, is not kept", async () => {
    const s = peopleSearch([
      {
        name: "Kim Cho",
        url: li("kimcho"),
        roles: [at("Controller", "Umbrella Health"), at("Recruiter", "Globex", false)],
      },
    ]);
    expect(await findContacts(s, firm)).toEqual([]);
  });

  it("the agency's own recruiters are skipped, though they list the firm before", async () => {
    const agency = { name: "Brightpath Staffing", domain: null };
    const s = peopleSearch([
      {
        name: "Lou Tan",
        url: li("loutan"),
        roles: [at("Recruiter", "Brightpath Staffing"), at("Recruiter", "Umbrella Health", false)],
      },
    ]);
    expect(await findContacts(s, firm, { except: agency })).toEqual([]);
  });

  it("moved within the firm: there now, titled by the hiring role", async () => {
    const s = peopleSearch([
      {
        name: "Ann Park",
        url: li("annpark"),
        roles: [
          at("Operations Lead", "Umbrella Health"),
          at("Recruiter", "Umbrella Health", false),
        ],
      },
    ]);
    expect(await findContacts(s, firm)).toMatchObject([
      { title: "Recruiter", current: true, currentCompany: "Umbrella Health" },
    ]);
  });

  it("a person who lists no current role left, to nowhere known", async () => {
    const s = peopleSearch([
      { name: "Ray Oh", url: li("rayoh"), roles: [at("Recruiter", "Umbrella Health", false)] },
    ]);
    expect(await findContacts(s, firm)).toMatchObject([{ current: false, currentCompany: null }]);
  });
});

describe("findContacts: people who hire, kept", () => {
  // Was a bug: HIRING_ROLES needs a word after "people", so "Head of People" and "VP of People", the people who own hiring, are never kept.
  it("Head of People is a hiring role", async () => {
    const s = peopleSearch([
      { name: "Ann Park", url: li("annpark"), roles: [at("Head of People", "Umbrella Health")] },
      { name: "Raj Iyer", url: li("rajiyer"), roles: [at("VP of People", "Umbrella Health")] },
    ]);
    expect((await findContacts(s, firm, { max: 5 })).map((c) => c.fullName)).toEqual([
      "Ann Park",
      "Raj Iyer",
    ]);
  });

  // Was a bug: the query quoted the name as the page wrote it, legal form and all; profiles say "Globex".
  it("the search leaves the legal form out of the name", async () => {
    const s = peopleSearch([]);
    await findContacts(s, { name: "Globex Corporation, Inc.", domain: null });
    expect(s.queries[0]).toMatch(/at Globex$/);
  });

  it("a profile that says the legal form still matches the firm", async () => {
    const s = peopleSearch([
      { name: "Ann Lee", url: li("annlee"), roles: [at("Recruiter", "Umbrella Health, Inc.")] },
    ]);
    expect(await findContacts(s, firm)).toHaveLength(1);
  });
});

describe("findContacts: caps", () => {
  // Was a bug: the cap is checked after the push, so max 0 still returns one person.
  it("max 0 finds nobody", async () => {
    const s = peopleSearch([
      { name: "Ann Lee", url: li("annlee"), roles: [at("Recruiter", "Umbrella Health")] },
    ]);
    expect(await findContacts(s, firm, { max: 0 })).toEqual([]);
  });

  it("holds: one profile under www, country host, case and query variants is one person", async () => {
    const roles = [at("Recruiter", "Umbrella Health")];
    const s = peopleSearch([
      { name: "Ann Lee", url: "https://ca.linkedin.com/in/AnnLee", roles },
      { name: "Ann Lee", url: "https://www.linkedin.com/in/annlee/?trk=public", roles },
      { name: "Ann Lee", url: "https://linkedin.com/in/annlee/details/experience/", roles },
    ]);
    const found = await findContacts(s, firm, { max: 5 });
    expect(found.map((c) => c.linkedin)).toEqual(["https://www.linkedin.com/in/annlee/"]);
  });
});
