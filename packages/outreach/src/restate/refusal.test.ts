import * as restate from "@restatedev/restate-sdk";
import { SiteCallError } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { finalRefusal } from "./index.js";

describe("finalRefusal", () => {
  it("makes a site's 4xx terminal and leaves a 5xx, a 408 and other errors to retry", () => {
    const no = finalRefusal(new SiteCallError("reddit", "GET", "/comments/x", 400, "Too big"));
    expect(no).toBeInstanceOf(restate.TerminalError);
    expect((no as restate.TerminalError).code).toBe(400);
    for (const err of [
      new SiteCallError("reddit", "GET", "/comments/x", 503, "down"),
      new SiteCallError("reddit", "GET", "/comments/x", 408, "slow"),
      new Error("socket hang up"),
    ])
      expect(finalRefusal(err)).toBe(err);
  });
});
