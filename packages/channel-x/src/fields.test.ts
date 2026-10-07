import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { xContent } from "./content.js";

describe("x post fields", () => {
  it("sends who can reply, the reply and the quote", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const sites: SiteClient = {
      call: async (_s, _m, path, input) => {
        calls.push([path, input]);
        return (
          path === "/2/users/me" ? { data: { id: "1", username: "w" } } : { data: { id: "9" } }
        ) as never;
      },
      via: async () => "api",
    };
    await xContent(sites).publish({
      text: "hi",
      extra: { replySettings: "following", replyTo: "123", quote: "456" },
    });
    expect(calls.find(([p]) => p === "/2/tweets")?.[1]).toEqual({
      text: "hi",
      reply: { in_reply_to_tweet_id: "123" },
      quote_tweet_id: "456",
      reply_settings: "following",
    });
  });
});
