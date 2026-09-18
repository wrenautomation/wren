import { describe, expect, it } from "vitest";
import { FetchError, type Fetcher, type FetchResponse } from "../fetch/fetcher.js";
import { politeHomepageFetcher } from "./homepage.js";

class Canned implements Fetcher {
  readonly userAgent = "wren/0.1 (t@example.com)";
  readonly requested: string[] = [];
  constructor(private readonly pages: Record<string, string | FetchError>) {}
  async get(url: string): Promise<FetchResponse> {
    this.requested.push(url);
    const body = this.pages[url];
    if (body instanceof FetchError) throw body;
    return { status: body === undefined ? 404 : 200, url, text: body ?? "" };
  }
}

describe("politeHomepageFetcher", () => {
  it("falls through https -> www -> http and reads the page", async () => {
    const f = new Canned({
      "https://a.example": new FetchError("dead"),
      "http://a.example": "<html><head><title>A Co</title></head><body><p>Hello</p></body></html>",
    });
    const page = await politeHomepageFetcher(f)("a.example");
    expect(page).toEqual({ url: "http://a.example", title: "A Co", text: "Hello" });
  });
  it("honors robots and returns null when nothing answers", async () => {
    const f = new Canned({
      "https://b.example/robots.txt": "User-agent: *\nDisallow: /",
      "https://b.example": "<p>secret</p>",
    });
    expect(await politeHomepageFetcher(f)("b.example")).toBeNull();
    expect(f.requested).not.toContain("https://b.example");
  });
});
