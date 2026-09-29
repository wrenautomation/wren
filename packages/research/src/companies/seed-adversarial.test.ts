/**
 * Adversarial tests for the demo seed's research half: which customers a
 * firm's site names (the gate), and the firm's own name from its home page.
 * Tests state what SHOULD happen; a failing one is a bug.
 */
import { FakeLlm } from "@wren/llm";
import { describe, expect, it } from "vitest";
import { siteName } from "../discovery/find.js";
import type { Fetcher } from "../fetch/fetcher.js";
import { findCustomers, gateCustomers, imageNames } from "./customers.js";

type Page = { status?: number; url?: string; text: string };
function fetcher(pages: Record<string, Page | string>): Fetcher & { asked: string[] } {
  const asked: string[] = [];
  return {
    userAgent: "test",
    asked,
    async get(url) {
      asked.push(url);
      const p = pages[url];
      if (p === undefined) return { status: 404, url, text: "" };
      if (typeof p === "string") return { status: 200, url, text: p };
      return { status: p.status ?? 200, url: p.url ?? url, text: p.text };
    },
  };
}
const answer = (customers: { name: string; website?: string | null }[]) =>
  new FakeLlm({ default: JSON.stringify({ customers }) });

const site = "https://northside.example";
const firm = { name: "Northside Talent", site };
const page = (over: Partial<Parameters<typeof gateCustomers>[2][number]> = {}) => ({
  url: site,
  text: "",
  images: [] as string[],
  links: [] as { url: string; anchor: string }[],
  ...over,
});

describe("gateCustomers: names the pages don't carry", () => {
  // Was a bug: a website that matches any off-site link lets a made-up name through; the seed then searches people at a company the agency never named.
  it("a made-up name is dropped even when its website is another customer's link", () => {
    const pages = [
      page({
        text: "Our clients",
        links: [{ url: "https://www.umbrellahealth.example/", anchor: "Umbrella Health" }],
      }),
    ];
    const g = gateCustomers(
      [{ name: "Massive Dynamic", website: "umbrellahealth.example" }],
      firm,
      pages,
    );
    expect(g.customers).toEqual([]);
    expect(g.dropped).toEqual([{ name: "Massive Dynamic", why: "not on the pages" }]);
  });
});

describe("gateCustomers: names the pages do carry", () => {
  // Was a bug: isFirm's word-prefix rule reads "Northside Hospital" as "Northside Talent" (domain label "northside"), so a real customer is dropped as the firm itself.
  it("a customer that shares the agency's first word is not the agency", () => {
    const pages = [page({ text: "We staffed the ICU at Northside Hospital." })];
    const g = gateCustomers([{ name: "Northside Hospital" }], firm, pages);
    expect(g.customers.map((c) => c.name)).toEqual(["Northside Hospital"]);
    expect(g.dropped).toEqual([]);
  });

  // Was a bug: firmNames drops phrases under 3 letters, so a two-letter customer the page names word for word never passes.
  it("a two-letter customer the page names is kept", () => {
    const pages = [page({ text: "Trusted by QX and Umbrella Health." })];
    const g = gateCustomers([{ name: "QX" }], firm, pages);
    expect(g.customers.map((c) => c.name)).toEqual(["QX"]);
  });

  // Was a bug: imageNames keeps "UmbrellaHealth" as one word, so a customer shown only by a camelCase logo file is dropped.
  it("a customer shown only by a camelCase logo file is kept", () => {
    const images = imageNames(`<p>Trusted by</p><img src="/logos/UmbrellaHealth.svg" alt="">`);
    const g = gateCustomers([{ name: "Umbrella Health" }], firm, [page({ images })]);
    expect(g.customers.map((c) => c.name)).toEqual(["Umbrella Health"]);
  });
});

describe("imageNames", () => {
  // Was a bug: a lazy-loaded logo's placeholder data URI is read as its file name and the real data-src name is lost, so the logo wall names nobody.
  it("a lazy-loaded logo is read by its real file, not the placeholder", () => {
    const names = imageNames(
      `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" data-src="/logos/umbrella-health.png">`,
    );
    expect(names).toContain("umbrella health");
    expect(names.some((n) => /base64/i.test(n))).toBe(false);
  });
});

describe("findCustomers", () => {
  // Was a bug: the social-link filter matches "x.com" and "linkedin" anywhere in the URL, so a customer's own site (zyntrex.com, or a ?utm_source=linkedin link) is thrown away and its website is lost.
  it("a customer's own link is kept even when its URL contains a social site's name", async () => {
    const f = fetcher({
      [site]: `<title>Northside Talent</title><p>Our clients</p>
        <a href="https://www.zyntrex.com/">Zyntrex</a>
        <a href="https://umbrellahealth.example/?utm_source=linkedin">Umbrella Health</a>`,
    });
    const r = await findCustomers(
      f,
      answer([
        { name: "Zyntrex", website: "zyntrex.com" },
        { name: "Umbrella Health", website: "umbrellahealth.example" },
      ]),
      firm,
    );
    expect(r.customers.map((c) => [c.name, c.website])).toEqual([
      ["Zyntrex", "https://www.zyntrex.com/"],
      ["Umbrella Health", "https://umbrellahealth.example/?utm_source=linkedin"],
    ]);
  });

  // Was a bug: the gate judges "the firm itself" by the site it was given, not where the home page landed, so after a redirect to the agency's brand domain the agency is listed as its own customer.
  it("after a redirect, the agency under its landed domain is still the firm itself", async () => {
    const f = fetcher({
      "https://nst.example": {
        url: "https://northsidetalent.example/",
        text: `<title>Northside Talent</title><p>Northside Talent places engineers at Umbrella Health.</p>`,
      },
    });
    const r = await findCustomers(
      f,
      answer([{ name: "Northside Talent" }, { name: "Umbrella Health" }]),
      // What seedDemo passes when the title doesn't match the domain: the domain as the name.
      { name: "nst.example", site: "https://nst.example" },
    );
    expect(r.customers.map((c) => c.name)).toEqual(["Umbrella Health"]);
    expect(r.dropped).toEqual([{ name: "Northside Talent", why: "the firm itself" }]);
  });

  // Was a bug: "/clients" and "/clients/" are fetched as two pages, spending two of the 8 page slots and showing the model the same page twice.
  it("a client page linked with and without a trailing slash is read once", async () => {
    const clients = "<p>Our clients: Umbrella Health</p>";
    const f = fetcher({
      [site]: `<a href="/clients">Clients</a><a href="/clients/">Our clients</a>`,
      [`${site}/clients`]: clients,
      [`${site}/clients/`]: clients,
    });
    await findCustomers(f, answer([]), firm);
    const reads = f.asked.filter((u) => u.startsWith(`${site}/clients`));
    expect(reads).toHaveLength(1);
  });

  it("holds: a robots.txt that disallows the site ends the job before any page or the model", async () => {
    let asked = false;
    const llm = new FakeLlm({
      respond: () => {
        asked = true;
        return "{}";
      },
    });
    const f = fetcher({
      [`${site}/robots.txt`]: "User-agent: *\nDisallow: /",
      [site]: "<p>Umbrella Health</p>",
    });
    const r = await findCustomers(f, llm, firm);
    expect(f.asked).toEqual([`${site}/robots.txt`]);
    expect(r.tried).toEqual([{ url: site, outcome: "robots.txt disallows" }]);
    expect(asked).toBe(false);
  });
});

describe("siteName", () => {
  // Was a bug: the content regex stops at the first quote of either kind, so "O'Brien Staffing" is read as "O" and the seed calls the agency "O".
  it("a declared site name with an apostrophe is read whole", () => {
    expect(
      siteName(
        `<meta property="og:site_name" content="O'Brien Staffing"><title>Home</title>`,
        "obrienstaffing.example",
      ),
    ).toBe("O'Brien Staffing");
  });

  // Was a bug: a short domain label ("ns") matches inside any title part ("Staffing Solutions"), so the tagline is taken as the firm's name.
  it("a short domain label matches its own part of the title, not letters inside a tagline", () => {
    expect(siteName("<title>Staffing Solutions | NS Talent</title>", "ns.example")).toBe(
      "NS Talent",
    );
  });
});
