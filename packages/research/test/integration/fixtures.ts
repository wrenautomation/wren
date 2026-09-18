/** Shared fakes for the enrichment integration suites: canned pages, no network, no sleeping. */
import type { Company } from "@wren/core";
import { companies } from "@wren/core";
import type { Queryable } from "@wren/db";
import type { Fetcher, FetchResponse } from "../../src/fetch/fetcher.js";

export class FakeFetcher implements Fetcher {
  readonly userAgent = "wren-test/0.1";
  readonly requested: string[] = [];
  constructor(private readonly pages: Record<string, string>) {}
  async get(url: string): Promise<FetchResponse> {
    this.requested.push(url);
    const body = this.pages[url];
    return { status: body === undefined ? 404 : 200, url, text: body ?? "" };
  }
}

export const HOME = `<html><head><title>Verdano Advisors</title></head><body>
<p>Verdano Advisors LLC — advice.</p>
<a href="/team">Our Team</a> <a href="/blog">Blog</a> <a href="/team">Team again</a>
</body></html>`;
export const TEAM = `<html><body><h1>Team</h1><p>Jane Doe, Founder. jane@verdano.example</p></body></html>`;

export const crawlPages = (domain = "verdano.example"): Record<string, string> => ({
  [`https://${domain}`]: HOME,
  [`https://${domain}/team`]: TEAM,
});

export const EXTRACTION_JSON =
  '{"people": [{"full_name": "JANE DOE", "title": "Founder", "email": "jane@verdano.example", "bio_facts": ["CFA charterholder"]}], "generic_emails": ["info@verdano.example"]}';

export async function makeCompany(
  db: Queryable,
  opts: { key?: string | null; domain?: string; name?: string; niche?: string | null } = {},
): Promise<Company> {
  const [row] = await db
    .insert(companies)
    .values({
      sourceKey: opts.key === undefined ? "crd:930001" : opts.key,
      domain: opts.domain ?? "verdano.example",
      name: opts.name ?? "Verdano Advisors LLC",
      niche: opts.niche ?? null,
      raw: {},
    })
    .returning();
  return row as Company;
}
