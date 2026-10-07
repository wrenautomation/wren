import type { AccountRow } from "@wren/core/setup-schema";
import { describe, expect, it } from "vitest";
import type { SearchConsoleClient } from "./console.js";
import { propertyOf, searchConsoleChecks } from "./setups.js";

const property = (ref: string) =>
  ({ id: 1, client: "acme", site: "search_console", ref }) as AccountRow;
const now = new Date(0);

/** Answers the site list from `entries`, or with `status`. */
function fake(entries: unknown[], status = 200) {
  const urls: string[] = [];
  const client: SearchConsoleClient = {
    token: async () => "t",
    fetch: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(status === 200 ? { siteEntry: entries } : {}), { status });
    },
  };
  return { client, urls };
}

describe("search_console.access", () => {
  it("passes when Wren's service account sees the property, said any of three ways", async () => {
    const { client, urls } = fake([
      { siteUrl: "sc-domain:acme.test", permissionLevel: "siteFullUser" },
    ]);
    const check = searchConsoleChecks(() => client)["search_console.access"];
    for (const ref of ["sc-domain:acme.test", "acme.test", "https://acme.test/"])
      expect(await check?.({ account: property(ref), now })).toMatchObject({ ok: true });
    expect(urls[0]).toBe("https://searchconsole.googleapis.com/webmasters/v3/sites");
  });

  it("waits while the property is missing or unverified", async () => {
    const { client } = fake([
      { siteUrl: "https://other.test/", permissionLevel: "siteOwner" },
      { siteUrl: "sc-domain:new.test", permissionLevel: "siteUnverifiedUser" },
    ]);
    const check = searchConsoleChecks(() => client)["search_console.access"];
    expect(await check?.({ account: property("acme.test"), now })).toEqual({
      ok: false,
      why: "Wren's service account doesn't see this property yet",
    });
    expect(await check?.({ account: property("new.test"), now })).toMatchObject({
      ok: false,
      why: "The property isn't verified yet",
    });
  });

  it("waits, never throws, when Google refuses or the key is missing", async () => {
    const refused = searchConsoleChecks(() => fake([], 403).client)["search_console.access"];
    expect(await refused?.({ account: property("acme.test"), now })).toMatchObject({
      ok: false,
      why: expect.stringMatching(/^Couldn't read Search Console/),
    });
    const noKey = searchConsoleChecks(() => {
      throw new Error("no key");
    })["search_console.access"];
    expect(await noKey?.({ account: property("acme.test"), now })).toEqual({
      ok: false,
      why: "Couldn't read Search Console: no key",
    });
  });

  it("prefers the exact property over the same domain", () => {
    const sites = [{ siteUrl: "sc-domain:acme.test" }, { siteUrl: "https://acme.test/" }];
    expect(propertyOf("https://acme.test/", sites)?.siteUrl).toBe("https://acme.test/");
    expect(propertyOf("ACME.test", sites)?.siteUrl).toBe("sc-domain:acme.test");
    expect(propertyOf("beta.test", sites)).toBeNull();
  });
});
