import { describe, expect, it } from "vitest";
import { pageFollowing, type SiteClient } from "./autobrowse.js";

const sitesAnswering = (body: unknown, calls: unknown[][] = []): SiteClient => ({
  async call<T>(...args: unknown[]) {
    calls.push(args);
    return body as T;
  },
  async via() {
    return "browser";
  },
});

describe("pageFollowing", () => {
  it("maps each listed account to a row with its profile URL and no follow time", async () => {
    const calls: unknown[][] = [];
    const sites = sitesAnswering(
      {
        data: [
          { username: "sam_synth", name: "Sam Synth" },
          { username: "kim.synth" },
          { name: "x" },
        ],
      },
      calls,
    );
    expect(
      await pageFollowing(sites, "tiktok", "/web/following", (h) => `https://t.example/@${h}`),
    ).toEqual([
      { handle: "sam_synth", name: "Sam Synth", url: "https://t.example/@sam_synth", at: null },
      { handle: "kim.synth", name: null, url: "https://t.example/@kim.synth", at: null },
    ]);
    expect(calls).toEqual([["tiktok", "GET", "/web/following", {}]]);
  });

  it("answers an empty list when the page lists nobody", async () => {
    expect(await pageFollowing(sitesAnswering({}), "x", "/f", (h) => h)).toEqual([]);
  });
});
