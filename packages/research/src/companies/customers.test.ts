/**
 * The customers a firm's site names: which pages get read, what the model
 * sees, and the gate that keeps only names the pages carry.
 */
import { FakeLlm } from "@wren/llm";
import { describe, expect, it } from "vitest";
import type { Fetcher } from "../fetch/fetcher.js";
import { buildCustomersPrompt, findCustomers, gateCustomers, imageNames } from "./customers.js";

function fetcher(pages: Record<string, string>): Fetcher & { asked: string[] } {
  const asked: string[] = [];
  return {
    userAgent: "test",
    asked,
    async get(url) {
      asked.push(url);
      const p = pages[url];
      return p === undefined ? { status: 404, url, text: "" } : { status: 200, url, text: p };
    },
  };
}

const HOME = `<html><title>Northside Talent | Recruiting</title><body>
  <a href="/about">About</a><a href="/our-clients">Who we work with</a>
  <a href="/case-studies/globex">Globex story</a><a href="/careers">Careers</a>
  <p>Trusted by</p><img src="/img/initech-logo.png" alt=""><img src="/a8f3c2e1.png" alt="Hooli">
</body></html>`;
const CLIENTS = `<html><body><h1>Our clients</h1>
  <p>We placed 40 engineers at Umbrella Health.</p>
  <a href="https://www.umbrellahealth.com/">Umbrella Health</a>
  <a href="https://linkedin.com/company/northside">LinkedIn</a>
</body></html>`;
const CASE = "<html><body><p>Globex Corporation grew its team with us.</p></body></html>";
const site = "https://northside.example";

describe("imageNames", () => {
  it("reads alt, title and file names; skips hashes", () => {
    expect(
      imageNames(
        `<img alt="Acme &amp; Co" src="/x/acme-co_logo.svg?v=2"><IMG title='Beta' src="/1200x630.jpg"><img src="/0f9a8b7c6d5e.png">`,
      ),
    ).toEqual(["Acme & Co", "acme co logo", "Beta"]);
  });
});

describe("findCustomers", () => {
  it("reads the home page and its client pages, then keeps what the pages carry", async () => {
    const f = fetcher({
      "https://northside.example/robots.txt": "",
      [site]: HOME,
      [`${site}/our-clients`]: CLIENTS,
      [`${site}/case-studies/globex`]: CASE,
    });
    let prompt = "";
    const llm = new FakeLlm({
      respond: (p) => {
        prompt = p;
        return JSON.stringify({
          customers: [
            { name: "Umbrella Health", website: "umbrellahealth.com" },
            { name: "Globex Corporation", website: "https://globex.com" },
            { name: "Initech" },
            { name: "Hooli", website: null },
            { name: "Northside Talent" },
            { name: "Massive Dynamic" },
            { name: "umbrella health" },
          ],
        });
      },
    });
    const r = await findCustomers(f, llm, { name: "Northside Talent", site });
    expect(f.asked).not.toContain(`${site}/about`);
    expect(f.asked).not.toContain(`${site}/careers`);
    expect(r.tried.map((t) => t.outcome)).toEqual(["read", "read", "read"]);
    expect(prompt).toContain("IMAGES: initech logo | Hooli");
    expect(prompt).toContain("- https://www.umbrellahealth.com/ (Umbrella Health)");
    expect(prompt).not.toContain("linkedin.com/company");
    expect(r.customers).toEqual([
      {
        name: "Umbrella Health",
        website: "https://www.umbrellahealth.com/",
        seenOn: `${site}/our-clients`,
      },
      // No link to globex.com on the pages: the site is not taken on the model's word.
      // The home page's "Globex story" link names it first ("Corporation" is a legal word).
      { name: "Globex Corporation", website: null, seenOn: site },
      { name: "Initech", website: null, seenOn: site },
      { name: "Hooli", website: null, seenOn: site },
    ]);
    expect(r.dropped).toEqual([
      { name: "Northside Talent", why: "the firm itself" },
      { name: "Massive Dynamic", why: "not on the pages" },
    ]);
  });

  it("a home page it can't read ends the job before the model is asked", async () => {
    let asked = false;
    const llm = new FakeLlm({
      respond: () => {
        asked = true;
        return "{}";
      },
    });
    const r = await findCustomers(fetcher({}), llm, {
      name: "Northside",
      site: "northside.example",
    });
    expect(r).toEqual({
      customers: [],
      dropped: [],
      tried: [{ url: "https://northside.example", outcome: "HTTP 404" }],
    });
    expect(asked).toBe(false);
  });

  it("an answer that doesn't parse finds nobody and says so", async () => {
    const r = await findCustomers(fetcher({ [site]: HOME }), new FakeLlm({ default: "no idea" }), {
      name: "Northside",
      site,
    });
    expect(r.customers).toEqual([]);
    expect(r.tried.at(-1)).toEqual({ url: "-", outcome: "the model's answer did not parse" });
  });
});

describe("gateCustomers", () => {
  const pages = [{ url: site, text: "We work with Acme Staffing Group.", images: [], links: [] }];
  it("a name inside another word is not on the page", () => {
    const g = gateCustomers([{ name: "Acme Staff" }], { name: "Northside", site }, pages);
    expect(g.dropped).toEqual([{ name: "Acme Staff", why: "not on the pages" }]);
  });
  it("blank names are skipped, not dropped", () => {
    expect(gateCustomers([{ name: "  " }], { name: "Northside", site }, pages)).toEqual({
      customers: [],
      dropped: [],
    });
  });
});

describe("buildCustomersPrompt", () => {
  it("caps each page's text", () => {
    const p = buildCustomersPrompt("X", [
      { url: "u", text: "a".repeat(10_000), images: [], links: [] },
    ]);
    expect(p).toContain("a".repeat(6_000));
    expect(p).not.toContain("a".repeat(6_001));
  });
});
