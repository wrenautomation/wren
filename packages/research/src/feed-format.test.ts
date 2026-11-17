import { describe, expect, it } from "vitest";
import { secondsOf } from "./creators.js";
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

describe("secondsOf", () => {
  it("reads each platform's stored length", () => {
    expect(secondsOf("youtube", "PT1M7S")).toBe(67);
    expect(secondsOf("youtube", "PT1H2M5S")).toBe(3725);
    expect(secondsOf("youtube", "PT50S")).toBe(50);
    expect(secondsOf("tiktok", "34")).toBe(34);
    expect(secondsOf("x", "47280")).toBe(47);
  });
  it("gives null for none, a live's P0D and junk", () => {
    expect(secondsOf("instagram", null)).toBeNull();
    expect(secondsOf("youtube", "P0D")).toBeNull();
    expect(secondsOf("youtube", "soon")).toBeNull();
    expect(secondsOf("tiktok", "0")).toBeNull();
  });
});
