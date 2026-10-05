/**
 * The `exaSearch` stage's pure parts: the search list, how a result becomes a row, and how a site
 * error ends a pass. A 402 (every Exa key spent) and a 429 stop it; neither is retried or paid.
 */
import { IDENTITY_KEY } from "@wren/core";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { describe, expect, it } from "vitest";
import {
  countExaSearchUnit,
  type ExaFirm,
  emptyExaSearchStats,
  exaPageKey,
  exaRef,
  exaRows,
  exaSearches,
  exaSearchUnit,
} from "./exa-search.js";

const firm = (url: string, title: string | null): ExaFirm => ({
  url,
  title,
  domain: new URL(url).hostname,
  raw: { id: url, url, title },
});

describe("exaSearches", () => {
  it("crosses queries with cities, a city's queries together", () => {
    expect(
      exaSearches(["agency in {city}", "firm in {city}"], ["Austin, TX", "Denver, CO"]),
    ).toEqual([
      "agency in Austin, TX",
      "firm in Austin, TX",
      "agency in Denver, CO",
      "firm in Denver, CO",
    ]);
    expect(exaSearches([], ["Austin, TX"])).toEqual([]);
  });

  it("a search's ref carries its text and nothing else", () => {
    expect(exaRef("agency in Austin, TX")).toBe("web/exa/companies?q=agency+in+Austin%2C+TX");
  });
});

describe("exaRows", () => {
  it("a result on its own site is that domain; one on LinkedIn or a directory is keyed by its page", () => {
    const rows = exaRows(
      [
        firm("https://www.northwind-talent.example/about", "Northwind Talent"),
        firm("https://www.linkedin.com/company/Cove-Search/", "Cove Search"),
        firm("https://dir.example/profile/bolt", "Bolt"),
        firm("https://locations.acme-staffing.example/austin", null),
      ],
      "staffing agency in Austin, TX",
      ["dir.example"],
    );
    expect(
      rows.map((r) => [
        r.website,
        (r[IDENTITY_KEY] as { source_key: string } | undefined)?.source_key,
      ]),
    ).toEqual([
      ["northwind-talent.example", undefined],
      ["https://www.linkedin.com/company/Cove-Search/", "li:cove-search"],
      ["https://dir.example/profile/bolt", "exa:dir.example/profile/bolt"],
      ["acme-staffing.example", undefined],
    ]);
    expect(rows[0]).toMatchObject({
      company_name: "Northwind Talent",
      query: "staffing agency in Austin, TX",
      exa: { id: "https://www.northwind-talent.example/about" },
    });
  });

  it("a page key fits the 64-character column", () => {
    expect(exaPageKey(`https://dir.example/${"x".repeat(100)}`)).toHaveLength(64);
    expect(exaPageKey("not a url")).toBe("exa:not a url");
  });
});

describe("exaSearchUnit", () => {
  const failing = (status: number, message: string): SiteClient => ({
    call: async () => {
      throw new SiteCallError("web", "GET", "/exa/companies", status, message);
    },
    via: async () => "api",
  });
  // An error returns before the database is touched.
  const nodb = {} as Queryable;
  const unit = (sites: SiteClient) => exaSearchUnit(nodb, sites, { q: "q", niche: "n" });

  it("a 429 and a 402 stop the pass; a 400 is data; a 5xx is thrown to be retried", async () => {
    const capped = await unit(failing(429, "retry after 3600s"));
    const spent = await unit(
      failing(402, "nothing answered: exa (every EXA key is out of credit)"),
    );
    const refused = await unit(failing(400, "q: required"));
    expect([capped.outcome, spent.outcome, refused.outcome]).toEqual(["capped", "spent", "error"]);
    await expect(unit(failing(502, "nothing answered: exa"))).rejects.toBeInstanceOf(SiteCallError);

    const stats = emptyExaSearchStats();
    expect(countExaSearchUnit(stats, refused)).toBeNull();
    expect(stats.errors).toBe(1);
    expect(countExaSearchUnit(stats, capped)).toMatch(/wait/);
    expect(countExaSearchUnit(stats, spent)).toMatch(/spent/);
  });

  it("asks `web GET /exa/companies` for the search and 25 results", async () => {
    const seen: unknown[][] = [];
    const sites: SiteClient = {
      call: async (...args: unknown[]) => {
        seen.push(args);
        throw new SiteCallError("web", "GET", "/exa/companies", 429, "retry after 60s");
      },
      via: async () => "api",
    };
    await unit(sites);
    expect(seen[0]).toEqual(["web", "GET", "/exa/companies", { q: "q", n: 25 }]);
  });
});
