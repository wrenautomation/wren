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

  it("posts a thread as a chain of replies, the fields on the first", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    let n = 0;
    const sites: SiteClient = {
      call: async (_s, _m, path, input) => {
        calls.push([path, input]);
        if (path === "/2/users/me") return { data: { id: "1", username: "w" } } as never;
        n++;
        return { data: { id: String(100 + n) } } as never;
      },
      via: async () => "api",
    };
    const out = await xContent(sites).publish({
      text: "One.\n\n---\n\nTwo.\n\n---\n\nThree.\n\nhttps://example.com/go/x",
      extra: { kind: "thread", replySettings: "following" },
    });
    const tweets = calls.filter(([p]) => p === "/2/tweets").map(([, b]) => b);
    expect(tweets).toEqual([
      { text: "One.", reply_settings: "following" },
      { text: "Two.", reply: { in_reply_to_tweet_id: "101" } },
      { text: "Three.\n\nhttps://example.com/go/x", reply: { in_reply_to_tweet_id: "102" } },
    ]);
    expect(out).toMatchObject({ id: "101", url: "https://x.com/w/status/101" });
    expect(out.notes).toBeUndefined();
  });

  it("keeps a thread that broke partway, and says where", async () => {
    let n = 0;
    const sites: SiteClient = {
      call: async (_s, _m, path) => {
        if (path === "/2/users/me") return { data: { id: "1", username: "w" } } as never;
        n++;
        if (n === 3) throw new Error("rate limited");
        return { data: { id: String(100 + n) } } as never;
      },
      via: async () => "api",
    };
    const out = await xContent(sites).publish({
      text: "One.\n---\nTwo.\n---\nThree.\n---\nFour.",
      extra: { kind: "thread" },
    });
    expect(out.id).toBe("101");
    expect(out.notes?.[0]).toMatch(/^Posted 2 of 4: post 3 failed \(rate limited\)/);
  });

  it("refuses a thread X would refuse before posting any of it", async () => {
    const sites: SiteClient = {
      call: async () => {
        throw new Error("should not post");
      },
      via: async () => "api",
    };
    await expect(
      xContent(sites).publish({ text: "One.\n---\nTwo.", extra: { kind: "thread" } }),
    ).rejects.toThrow(/3 to 7 posts/);
  });
});
