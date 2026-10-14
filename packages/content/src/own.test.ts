import { describe, expect, it } from "vitest";
import { refFrom } from "./own.js";

describe("refFrom", () => {
  it("hangs a post under its video, unique each time", () => {
    const a = refFrom("video:12");
    expect(a).toMatch(/^video:12\/post:[0-9a-f]{8}$/);
    expect(refFrom("video:12")).not.toBe(a);
  });

  it("is null without a from, and refuses anything but a video", () => {
    expect(refFrom(null)).toBeNull();
    expect(refFrom("")).toBeNull();
    expect(() => refFrom("blog:x")).toThrow(/video/);
    expect(() => refFrom("video:12/short:1")).toThrow(/video/);
  });
});
