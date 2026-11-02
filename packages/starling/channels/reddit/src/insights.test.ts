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

  it("a look reads the post once: insights takes the counts read's numbers", async () => {
    let calls = 0;
    const sites: SiteClient = {
      async call() {
        calls++;
        return {
          data: {
            children: [
              {
                data: {
                  id: "abc",
                  name: "t3_abc",
                  title: "synthetic",
                  score: 41,
                  upvote_ratio: 0.93,
                  num_comments: 5,
                },
              },
            ],
          },
        } as never;
      },
      async via() {
        return "api";
      },
    };
    const ch = redditContent(sites);
    const m = await ch.metrics("t3_abc");
    const got = await ch.insights?.({ id: "t3_abc", read: m.read });
    expect(got?.values.find((v) => v.metric === "upvote_ratio")?.value).toBe(0.93);
    // Before: the counts and insights each read the post (2).
    expect(calls).toBe(1);
    // The post's text is not carried along.
    expect(JSON.stringify(m.read)).not.toContain("synthetic");
  });
});
