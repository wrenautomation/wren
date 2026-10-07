import { describe, expect, it } from "vitest";
import { directCall, directRefusal, unitsOfRead } from "./vendor-direct.js";

const KEY = "synthetic-own-key-1234ABCD";

function fake(body: unknown, status = 200) {
  const seen: { url: string; headers: Headers; body: unknown }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    seen.push({
      url,
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify(body), { status });
  };
  return { seen, fetch };
}

describe("directCall", () => {
  it("Exa: the key in a header, the answer in autobrowse's shape", async () => {
    const f = fake({ results: [{ title: "A", url: "https://a.test", score: 1 }] });
    const a = await directCall(
      "exa",
      KEY,
      "web",
      "/search",
      { q: "plumbers", n: 3, via: "exa" },
      f.fetch,
    );
    expect(a.body).toEqual({
      query: "plumbers",
      hits: [
        {
          title: "A",
          url: "https://a.test",
          snippet: null,
          raw: { title: "A", url: "https://a.test", score: 1 },
        },
      ],
      via: "exa",
      tried: [],
    });
    expect(f.seen[0]?.url).toBe("https://api.exa.ai/search");
    expect(f.seen[0]?.headers.get("x-api-key")).toBe(KEY);
    expect(f.seen[0]?.body).toEqual({ query: "plumbers", numResults: 3, type: "auto" });
  });

  it("X: bearer header, query in the URL, never the key", async () => {
    const f = fake({ data: [{ id: "1" }, { id: "2" }] });
    const a = await directCall(
      "x",
      KEY,
      "x",
      "/2/tweets/search/recent",
      { query: "wren" },
      f.fetch,
    );
    expect(a.ok).toBe(true);
    expect(f.seen[0]?.url).toBe("https://api.x.com/2/tweets/search/recent?query=wren");
    expect(f.seen[0]?.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(f.seen[0]?.url).not.toContain(KEY);
    expect(unitsOfRead("x", "/2/tweets/search/recent", a.body)).toBe(2);
  });

  it("YouTube: API key header, units by call", async () => {
    const f = fake({ items: [] });
    await directCall("youtube", KEY, "youtube", "/youtube/v3/channels", { id: "UC1" }, f.fetch);
    expect(f.seen[0]?.url).toBe("https://www.googleapis.com/youtube/v3/channels?id=UC1");
    expect(f.seen[0]?.headers.get("x-goog-api-key")).toBe(KEY);
    expect(unitsOfRead("youtube", "/youtube/v3/search", null)).toBe(100);
    expect(unitsOfRead("youtube", "/youtube/v3/videos", null)).toBe(1);
  });

  it("anything else is refused, never sent", async () => {
    const f = fake({});
    expect(directRefusal("x", "x", "POST", "/2/tweets")).toContain("only reads");
    expect(directRefusal("exa", "web", "GET", "/linkedin/posts")).toContain("doesn't run");
    const a = await directCall("exa", KEY, "web", "/people", {}, f.fetch);
    expect([a.ok, a.status, f.seen.length]).toEqual([false, 409, 0]);
  });
});
