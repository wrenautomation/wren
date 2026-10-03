import { describe, expect, it } from "vitest";
import { progressOf, STAGES, stageEnabled, stagesToRun } from "./pool-scheduler.js";

describe("stageEnabled", () => {
  it("free groundwork and the pick always; extraction by setting; mailboxes only with a free verifier", () => {
    const on = (modelStages: "none" | "pick" | "all", free: boolean) =>
      STAGES.filter((s) => stageEnabled(s, modelStages, free));
    expect(on("none", false)).toEqual(on("pick", false));
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
    expect(on("none", true)).toEqual(
      expect.arrayContaining(["resolveMailboxes", "verifyMailboxes"]),
    );
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

describe("stagesToRun", () => {
  it("narrows to the niche's chosen stages, never past what config enables", () => {
    const only = { stages: ["crawl", "extract", "resolveMailboxes"] as const };
    expect([...stagesToRun({ stages: [...only.stages] }, "none", true)]).toEqual([
      "crawl",
      "resolveMailboxes",
    ]);
    expect([...stagesToRun(null, "none", false)]).toEqual(
      STAGES.filter((s) => stageEnabled(s, "none", false)),
    );
  });
});
