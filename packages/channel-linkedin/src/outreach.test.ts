import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { linkedinOutreach, parseFindQuery } from "./outreach.js";

function fakeSites(answers: Record<string, unknown>) {
  const calls: Array<{ method: string; path: string; input: unknown; account?: string }> = [];
  const sites: SiteClient = {
    async call(_site, method, path, input, account) {
      calls.push({ method, path, input, ...(account ? { account } : {}) });
      const key = `${method} ${path.split("?")[0]}`;
      const hit = Object.entries(answers).find(([k]) => k === key);
      if (!hit) throw new Error(`no answer for ${key}`);
      return hit[1] as never;
    },
    async via() {
      return "browser";
    },
  };
  return { sites, calls };
}

describe("linkedin outreach", () => {
  it("parses a company query", () => {
    expect(parseFindQuery("company/acme founder")).toEqual({ company: "acme", words: "founder" });
    expect(parseFindQuery("founder recruiting")).toEqual({
      company: null,
      words: "founder recruiting",
    });
  });

  it("find pages people search one page at a time", async () => {
    const people = Array.from({ length: 10 }, (_, i) => ({
      name: `P${i}`,
      vanity: `p${i}`,
      url: `https://www.linkedin.com/in/p${i}/`,
      headline: "Founder",
    }));
    const { sites, calls } = fakeSites({ "GET /search/results/people": { people, pages: 1 } });
    const ch = linkedinOutreach(sites, { account: "linkedin@wren" });
    const out = await ch.find({ query: "founder recruiting", limit: 10 });
    expect(out.prospects[0]).toEqual({
      handle: "p0",
      url: "https://www.linkedin.com/in/p0/",
      name: "P0",
      headline: "Founder",
      foundIn: "search:founder recruiting",
    });
    expect(out.cursor).toBe("2");
    expect(calls[0]?.input).toEqual({ keywords: "founder recruiting", page: 1, pages: 1 });
  });

  it("relationship and connect take a handle in any spelling", async () => {
    const { sites, calls } = fakeSites({
      "GET /in/jane-doe/relationship": { relationship: "none" },
      "POST /in/jane-doe/connect": {},
    });
    const ch = linkedinOutreach(sites, { account: "linkedin@wren" });
    expect(await ch.relationship?.("https://www.linkedin.com/in/jane-doe/")).toBe("none");
    await ch.connect?.("in/jane-doe", "hi");
    expect(calls[1]).toMatchObject({
      method: "POST",
      path: "/in/jane-doe/connect",
      input: { note: "hi" },
    });
  });

  it("replies are the unread threads that name a profile", async () => {
    const { sites } = fakeSites({
      "GET /messaging": {
        conversations: [
          {
            url: "/messaging/thread/1/",
            name: "Jane",
            vanity: "jane",
            preview: "sure",
            when: "2h",
            unread: true,
          },
          { url: "/messaging/thread/2/", name: "Group", preview: "x", when: "1d", unread: true },
          {
            url: "/messaging/thread/3/",
            name: "Old",
            vanity: "old",
            preview: "y",
            when: "Sep 1",
            unread: false,
          },
        ],
      },
    });
    const ch = linkedinOutreach(sites, { account: "linkedin@wren" });
    const r = await ch.replies(null);
    expect(r.map((x) => x.handle)).toEqual(["jane"]);
    expect(r[0]?.ref).toBe("/messaging/thread/1/#2h");
  });
});
