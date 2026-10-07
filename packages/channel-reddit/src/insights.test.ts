import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { redditContent } from "./content.js";

describe("reddit insights", () => {
  it("score, upvote ratio; views a gap when Reddit hides them", async () => {
    const sites: SiteClient = {
      async call() {
        return {
          data: {
            children: [
              {
                data: { id: "abc", name: "t3_abc", score: 41, upvote_ratio: 0.93, num_comments: 5 },
              },
            ],
          },
        } as never;
      },
      async via() {
        return "api";
      },
    };
    const got = await redditContent(sites).insights?.({ id: "t3_abc" });
    expect(got?.values).toEqual([
      { metric: "likes", value: 41 },
      { metric: "comments", value: 5 },
      { metric: "upvote_ratio", value: 0.93 },
    ]);
    expect(got?.gaps.map((g) => `${g.metric}:${g.state}`)).toEqual(["views:no_api"]);
  });
});
