/**
 * Adversarial tests for people who hire at a company, from search results
 * alone (the demo seed's people). A stranger kept as a past employee is the
 * worst outcome: the demo then claims a real person worked somewhere they
 * didn't. Tests state what SHOULD happen; a failing one is a bug.
 */
import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { findContacts, splitName } from "./contacts.js";

type Hit = { title: string; url: string; snippet: string | null };
function search(hits: Hit[]): SiteClient & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async call(_site, _method, _path, input = {}) {
      queries.push(String((input as { q: string }).q));
      return { hits, via: "ddg" } as never;
    },
    async via() {
      return "api";
    },
  };
}
const li = (v: string) => `https://www.linkedin.com/in/${v}`;
const firm = { name: "Umbrella Health", domain: "umbrellahealth.example" };

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

describe("findContacts: people who never worked at the firm", () => {
  // Was a bug: any mention of the firm in the snippet counts as having worked there, so an outside agency recruiter who places people AT the firm is kept as someone who left it.
  it("a recruiter elsewhere who names the firm only as a client is not kept", async () => {
    const s = search([
      {
        title: "Sam Fox - Senior Recruiter - Brightpath Staffing | LinkedIn",
        url: li("samfox"),
        snippet: "Placing nurses with hospitals like Umbrella Health since 2019.",
      },
    ]);
    expect(await findContacts(s, firm)).toEqual([]);
  });
});

describe("findContacts: people who hire, dropped", () => {
  // Was a bug: HIRING_ROLES needs a word after "people", so "Head of People" and "VP of People", the people who own hiring, are never kept.
  it("Head of People is a hiring role", async () => {
    const s = search([
      {
        title: "Ann Park - Head of People - Umbrella Health | LinkedIn",
        url: li("annpark"),
        snippet: null,
      },
      {
        title: "Raj Iyer - VP of People - Umbrella Health | LinkedIn",
        url: li("rajiyer"),
        snippet: null,
      },
    ]);
    expect((await findContacts(s, firm, { max: 5 })).map((c) => c.fullName)).toEqual([
      "Ann Park",
      "Raj Iyer",
    ]);
  });

  // Was a bug: the query quotes the name as the page wrote it, legal form and all; profiles say "Globex", so an exact-phrase search for "Globex Corporation, Inc." finds almost nobody.
  it("the search leaves the legal form out of the quoted name", async () => {
    const s = search([]);
    await findContacts(s, { name: "Globex Corporation, Inc.", domain: null });
    expect(s.queries[0]).toContain('"Globex"');
  });
});

describe("findContacts: caps", () => {
  // Was a bug: the cap is checked after the push, so max 0 still returns one person.
  it("max 0 finds nobody", async () => {
    const s = search([
      {
        title: "Ann Lee - Recruiter - Umbrella Health | LinkedIn",
        url: li("annlee"),
        snippet: null,
      },
    ]);
    expect(await findContacts(s, firm, { max: 0 })).toEqual([]);
  });

  it("holds: one profile under www, country host, case and query variants is one person", async () => {
    const title = "Ann Lee - Recruiter - Umbrella Health | LinkedIn";
    const s = search([
      { title, url: "https://ca.linkedin.com/in/AnnLee", snippet: null },
      { title, url: "https://www.linkedin.com/in/annlee/?trk=public", snippet: null },
      { title, url: "https://linkedin.com/in/annlee/details/experience/", snippet: null },
    ]);
    const found = await findContacts(s, firm, { max: 5 });
    expect(found.map((c) => c.linkedin)).toEqual(["https://www.linkedin.com/in/annlee/"]);
  });
});
