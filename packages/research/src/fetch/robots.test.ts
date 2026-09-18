import { describe, expect, it } from "vitest";
import { FetchError, type Fetcher, type FetchResponse } from "./fetcher.js";
import { canFetch, type RobotsCache, RobotsPolicy, robotsFor } from "./robots.js";

class Canned implements Fetcher {
  readonly userAgent = "wren/0.1 (test@example.com)";
  readonly requested: string[] = [];
  constructor(private readonly pages: Record<string, string | FetchError>) {}
  async get(url: string): Promise<FetchResponse> {
    this.requested.push(url);
    const body = this.pages[url];
    if (body instanceof FetchError) throw body;
    return { status: body === undefined ? 404 : 200, url, text: body ?? "" };
  }
}

describe("RobotsPolicy", () => {
  it("first matching rule wins, star group is the fallback", () => {
    const p = RobotsPolicy.parse(
      "User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: wren\nDisallow: /wren-only\n",
    );
    expect(p.canFetch("wren/0.1 (x)", "https://h/wren-only/x")).toBe(false);
    expect(p.canFetch("wren/0.1 (x)", "https://h/private")).toBe(true);
    expect(p.canFetch("other/1", "https://h/private/ok")).toBe(false); // first rule wins (Disallow before Allow)
    expect(p.canFetch("other/1", "https://h/public")).toBe(true);
  });

  it("empty Disallow allows everything; comments ignored", () => {
    const p = RobotsPolicy.parse("# hi\nUser-agent: *\nDisallow: # nothing\n");
    expect(p.canFetch("wren/0.1", "https://h/anything")).toBe(true);
  });

  it("disallow all", () => {
    const p = RobotsPolicy.parse("User-agent: *\nDisallow: /\n");
    expect(p.canFetch("wren/0.1", "https://h/")).toBe(false);
    expect(p.canFetch("wren/0.1", "https://h")).toBe(false);
    expect(RobotsPolicy.disallowAll().canFetch("wren/0.1", "https://h/")).toBe(false);
    expect(RobotsPolicy.allowAll().canFetch("wren/0.1", "https://h/")).toBe(true);
  });
});

describe("robotsFor", () => {
  it("caches per scheme+host and treats 4xx as allow", async () => {
    const f = new Canned({ "https://a.example/robots.txt": "User-agent: *\nDisallow: /" });
    const cache: RobotsCache = new Map();
    expect(await canFetch(f, "https://a.example/x", cache)).toBe(false);
    expect(await canFetch(f, "https://a.example/y", cache)).toBe(false);
    expect(await canFetch(f, "http://a.example/x", cache)).toBe(true); // other scheme: own file (404 -> allow)
    expect(await canFetch(f, "https://www.a.example/x", cache)).toBe(true);
    expect(f.requested.filter((u) => u.endsWith("/robots.txt"))).toHaveLength(3);
  });

  it("5xx means disallow-all, unreachable means allow", async () => {
    const f = new Canned({
      "https://down.example/robots.txt": new FetchError("GET failed", 503),
      "https://dead.example/robots.txt": new FetchError("GET failed", null),
    });
    const cache: RobotsCache = new Map();
    expect(
      (await robotsFor(f, "https://down.example/p", cache)).canFetch(
        f.userAgent,
        "https://down.example/p",
      ),
    ).toBe(false);
    expect(await canFetch(f, "https://dead.example/p", cache)).toBe(true);
  });
});
