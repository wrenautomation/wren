import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { redditContent } from "./content.js";

describe("reddit post fields", () => {
  it("sends replies-to-inbox off when it's off, and no flair it can't pick", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const sites: SiteClient = {
      call: async (_s, _m, path, input) => {
        calls.push([path, input]);
        return { json: { errors: [], data: { id: "a1", name: "t3_a1" } } } as never;
      },
      via: async () => "browser",
    };
    await redditContent(sites).publish({
      text: "body",
      extra: { subreddit: "startups", title: "t", sendReplies: false, flairId: "old" },
    });
    const sent = calls.find(([p]) => p === "/api/submit")?.[1];
    expect(sent).toMatchObject({ sr: "startups", title: "t", kind: "self", sendreplies: false });
    expect(sent).not.toHaveProperty("flair_id");
  });
});
