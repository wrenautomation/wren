import { describe, expect, it } from "vitest";
import { formatOf } from "./feed-format.js";

describe("formatOf", () => {
  // every (platform, kind) pair on prod, 11-16
  it.each([
    ["youtube", "video", "long"],
    ["youtube", "live", "long"],
    ["youtube", "short", "short"],
    ["instagram", "reel", "short"],
    ["tiktok", "video", "short"],
    ["instagram", "photo", "post"],
    ["instagram", "carousel", "post"],
    ["x", "post", "post"],
    ["x", "quote", "post"],
    ["x", "reply", "post"],
    ["linkedin", "post", "post"],
    ["threads", "post", "post"],
  ])("%s %s is %s", (platform, kind, want) => {
    expect(formatOf(platform, kind)).toBe(want);
  });
});
