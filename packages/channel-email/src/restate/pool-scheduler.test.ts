import { describe, expect, it } from "vitest";
import { progressOf, STAGES, stageEnabled } from "./pool-scheduler.js";

describe("stageEnabled", () => {
  it("free groundwork always; model stages by setting; mailboxes only with a free verifier", () => {
    const on = (modelStages: "none" | "pick" | "all", free: boolean) =>
      STAGES.filter((s) => stageEnabled(s, modelStages, free));
    expect(on("none", false)).toEqual(["discover", "verify", "crawl", "render", "scan"]);
    expect(on("pick", false)).toEqual([
      "discover",
      "verify",
      "crawl",
      "render",
      "scan",
      "pick",
      "applyPicks",
    ]);
    expect(on("all", true)).toEqual([...STAGES]);
    expect(on("none", true)).toContain("verifyMailboxes");
  });
});

describe("progressOf.verifyMailboxes", () => {
  it("is the verdict rows written, so an unreachable prober (aborted, 0 rows) idles the chain", () => {
    expect(
      progressOf.verifyMailboxes({
        selected: 10,
        local_invalid: 1,
        local_errors: 2,
        valid: 3,
        invalid: 1,
        risky: 1,
        catch_all: 1,
      }),
    ).toBe(7);
    expect(progressOf.verifyMailboxes({ selected: 10 })).toBe(0);
  });
});
