import type { AccountHealth } from "@wren/core/outreach";
import { describe, expect, it } from "vitest";
import { parseFindQuery } from "./outreach.js";
import { warmupOf } from "./warmup.js";

const now = new Date("2026-10-01T12:00:00Z");
const health = (
  ageDays: number,
  karma: number,
  more: Partial<AccountHealth> = {},
): AccountHealth => ({
  handle: "alt",
  createdAt: new Date(now.getTime() - ageDays * 86_400_000).toISOString(),
  karma,
  suspended: false,
  acceptsMessages: true,
  raw: {},
  asOf: now.toISOString(),
  ...more,
});

describe("reddit warmup", () => {
  it("a new account only reads", () => {
    const w = warmupOf(health(0, 0), now);
    expect(w.stage).toBe("lurk");
    expect(w.caps).toEqual({ comments: 0, posts: 0, messages: 0 });
    expect(w.next).toBe("3 more days → comment");
  });

  it("age alone does not reach posting: karma is needed too", () => {
    expect(warmupOf(health(20, 10), now)).toMatchObject({
      stage: "comment",
      next: "40 more karma → post",
    });
    expect(warmupOf(health(20, 60), now).stage).toBe("post");
  });

  it("messages open at 30 days and 150 karma, then grow one a week to five", () => {
    expect(warmupOf(health(30, 150), now).caps.messages).toBe(3);
    expect(warmupOf(health(44, 150), now).caps.messages).toBe(5);
    expect(warmupOf(health(90, 1000), now).caps.messages).toBe(5);
    expect(warmupOf(health(90, 1000), now).next).toBe("");
  });

  it("a suspended account, or one refusing PMs, is frozen whatever its age", () => {
    expect(warmupOf(health(90, 1000, { suspended: true }), now).frozen).toBe("suspended");
    expect(warmupOf(health(90, 1000, { acceptsMessages: false }), now).frozen).toMatch(/refuses/);
  });

  it("no creation date counts as day zero", () => {
    expect(warmupOf(health(90, 1000, { createdAt: null }), now).stage).toBe("lurk");
  });
});

describe("find queries", () => {
  it("splits a subreddit off the words", () => {
    expect(parseFindQuery("r/startups hiring")).toEqual({ sr: "startups", words: "hiring" });
    expect(parseFindQuery("/r/recruiting")).toEqual({ sr: "recruiting", words: "" });
    expect(parseFindQuery("recruiting agency owner")).toEqual({
      sr: null,
      words: "recruiting agency owner",
    });
  });
});
