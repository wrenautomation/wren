/** A firm's own site from a stated link or its name, proven by the ownership gate. */
import { describe, expect, it } from "vitest";
import { findHomepage, siteName } from "./find.js";
import type { HomepageFetcher } from "./service.js";

const pages: Record<string, { title: string; text: string }> = {
  "umbrella.com": { title: "Umbrella", text: "Umbrella Health cares" },
  "umbrellahealth.com": { title: "Umbrella Health", text: "Welcome to Umbrella Health" },
  "wrong.com": { title: "Parked", text: "This domain is for sale" },
};
function fetchHomepage(asked: string[]): HomepageFetcher {
  return async (d) => {
    asked.push(d);
    const p = pages[d];
    return p ? { url: `https://${d}/`, ...p } : null;
  };
}
const resolves = async (d: string) => d in pages;

describe("findHomepage", () => {
  it("a stated site that speaks for the firm wins, no DNS asked", async () => {
    const asked: string[] = [];
    const dns: string[] = [];
    const r = await findHomepage("Umbrella Health", "https://www.umbrellahealth.com/about", {
      fetchHomepage: fetchHomepage(asked),
      resolves: async (d) => {
        dns.push(d);
        return true;
      },
    });
    expect(r).toMatchObject({ domain: "umbrellahealth.com", how: "stated" });
    expect(asked).toEqual(["umbrellahealth.com"]);
    expect(dns).toEqual([]);
  });

  it("a stated site that doesn't speak for the firm falls back to guesses", async () => {
    const asked: string[] = [];
    const r = await findHomepage("Umbrella Health", "wrong.com", {
      fetchHomepage: fetchHomepage(asked),
      resolves,
    });
    expect(r).toMatchObject({ domain: "umbrellahealth.com", how: "guessed" });
    expect(asked).toEqual(["wrong.com", "umbrellahealth.com"]);
  });

  it("no site proves itself: null", async () => {
    expect(
      await findHomepage("Massive Dynamic", null, { fetchHomepage: fetchHomepage([]), resolves }),
    ).toBeNull();
  });
});

describe("siteName", () => {
  it("the declared site name wins, whatever the attribute order", () => {
    expect(
      siteName(
        `<title>Recruiting for Startups</title><meta content="Smith &amp; Co" property="og:site_name">`,
        "smithco.com",
      ),
    ).toBe("Smith & Co");
  });
  it("else the title part that matches the domain; a tagline names nobody", () => {
    expect(
      siteName("<title>Recruiting in Toronto | Northside Talent</title>", "northsidetalent.ca"),
    ).toBe("Northside Talent");
    expect(
      siteName("<title>Recruitment Agency for Startups</title>", "northside.example"),
    ).toBeNull();
  });
});
