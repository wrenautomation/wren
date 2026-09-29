/** People who hire at a firm, from search results alone. */
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
const li = (v: string) => `https://ca.linkedin.com/in/${v}`;
const firm = { name: "Umbrella Health", domain: "umbrellahealth.com" };

describe("splitName", () => {
  it("drops credentials and parentheses; refuses an initial for a surname", () => {
    expect(splitName("Jane Doe, SHRM-CP")).toEqual({ first: "Jane", last: "Doe" });
    expect(splitName("Jane (JJ) Mary Doe")).toEqual({ first: "Jane", last: "Doe" });
    expect(splitName("Jane D.")).toBeNull();
    expect(splitName("Jane")).toBeNull();
  });
});

describe("findContacts", () => {
  it("keeps hiring roles that name the firm; says who is there now", async () => {
    const s = search([
      {
        title: "Jane Doe - Talent Acquisition Lead - Umbrella Health | LinkedIn",
        url: li("janedoe"),
        snippet: null,
      },
      {
        title: "Bob Roe - Software Engineer - Umbrella Health | LinkedIn",
        url: li("bobroe"),
        snippet: null,
      },
      {
        title: "Cara Lim - Senior Recruiter | LinkedIn",
        url: li("caralim"),
        snippet: "Experience: Globex · Previously Umbrella Health · Toronto",
      },
      { title: "Dan Wu - HR Manager - Initech | LinkedIn", url: li("danwu"), snippet: "Toronto" },
      {
        title: "Eve Ng - Recruiter - Umbrella Health | LinkedIn",
        url: "https://example.com/eve",
        snippet: null,
      },
      {
        title: "Jane Doe - Talent Acquisition Lead - Umbrella Health",
        url: li("JaneDoe/"),
        snippet: null,
      },
    ]);
    const found = await findContacts(s, firm, { max: 5 });
    expect(s.queries).toEqual([
      'site:linkedin.com/in "Umbrella Health" (talent OR recruiting OR "human resources" OR people)',
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
        title: "Senior Recruiter",
        currentCompany: "Globex",
        current: false,
        linkedin: "https://www.linkedin.com/in/caralim/",
      },
    ]);
  });

  it("stops at max", async () => {
    const hits = ["a", "b", "c"].map((v) => ({
      title: `Ann ${v}son - Recruiter - Umbrella Health | LinkedIn`,
      url: li(`ann-${v}`),
      snippet: null,
    }));
    expect(await findContacts(search(hits), firm, { max: 2 })).toHaveLength(2);
  });

  it("a firm with no usable name asks nothing", async () => {
    const s = search([]);
    expect(await findContacts(s, { name: null, domain: null })).toEqual([]);
    expect(s.queries).toEqual([]);
  });
});
