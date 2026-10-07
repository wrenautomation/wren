import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { xContent } from "./content.js";

const sitesOf = (tweet: Record<string, unknown>): SiteClient => ({
  async call() {
    return { data: { id: "t1", ...tweet } } as never;
  },
  async via() {
    return "api";
  },
});

describe("x insights", () => {
  it("bookmarks and the author's clicks on the API leg", async () => {
    const got = await xContent(
      sitesOf({
        public_metrics: {
          impression_count: 900,
          like_count: 9,
          bookmark_count: 3,
          retweet_count: 1,
        },
        non_public_metrics: { url_link_clicks: 7, user_profile_clicks: 2 },
      }),
    ).insights?.({ id: "t1" });
    const of = (m: string) => got?.values.find((v) => v.metric === m)?.value;
    expect(of("views")).toBe(900);
    expect(of("saves")).toBe(3);
    expect(of("link_clicks")).toBe(7);
    expect(of("profile_clicks")).toBe(2);
    expect(got?.gaps).toEqual([]);
  });

  it("the browser leg: clicks are a gap that says why", async () => {
    const got = await xContent(sitesOf({ public_metrics: { impression_count: 5 } })).insights?.({
      id: "t1",
    });
    expect(got?.gaps.map((g) => `${g.metric}:${g.state}`)).toEqual([
      "link_clicks:no_api",
      "profile_clicks:no_api",
    ]);
  });
});
