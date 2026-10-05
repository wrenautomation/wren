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
      "contacts",
      "pick",
      "applyPicks",
    ]);
    expect(on("all", true)).toEqual(
      STAGES.filter(
        (s) =>
          s !== "profiles" &&
          s !== "team" &&
          s !== "youtube" &&
          s !== "adLibrary" &&
          s !== "fbGroups",
      ),
    );
    expect(STAGES.filter((s) => stageEnabled(s, "none", false, false, true))).toContain("youtube");
    // New firms first, so the same pass discovers and crawls them.
    expect(STAGES.filter((s) => stageEnabled(s, "none", false, false, false, true))[0]).toBe(
      "adLibrary",
    );
    // Right after it, then the same pass has the new firms to map posts to.
    expect(STAGES.filter((s) => stageEnabled(s, "none", false, false, false, false, true))).toEqual(
      ["fbGroups", ...on("none", false)],
    );
    expect(STAGES.indexOf("fbGroups")).toBe(STAGES.indexOf("adLibrary") + 1);
    expect(on("none", true)).toEqual(
      expect.arrayContaining(["resolveMailboxes", "verifyMailboxes"]),
    );
  });
});

describe("the fbGroups stage", () => {
  it("progress is searches and page reads, refused ones included; a cap leaves them due", () => {
    expect(progressOf.fbGroups({ searches: 1, abouts: 2, posts: 3, errors: 1 })).toBe(7);
    expect(progressOf.fbGroups({ selected: 4, mapped: 2 })).toBe(0);
  });
});

describe("the profiles stage", () => {
  it("is off unless asked for, and then runs last, after the addresses it needs are proven", () => {
    expect(STAGES.filter((s) => stageEnabled(s, "all", true))).not.toContain("profiles");
    expect(STAGES.filter((s) => stageEnabled(s, "none", false, true)).at(-1)).toBe("profiles");
    expect([...stagesToRun({ stages: ["profiles"] }, "none", false)]).toEqual([]);
    expect([...stagesToRun({ stages: ["profiles"] }, "none", false, true)]).toEqual(["profiles"]);
  });
  it("progress is people written; errors and caps leave them due", () => {
    expect(progressOf.profiles({ people_matched: 2, people_unresolved: 1, errors: 4 })).toBe(3);
    expect(progressOf.profiles({ selected: 5, errors: 5 })).toBe(0);
  });
});

describe("the team stage", () => {
  it("rides the profiles switch, just before it", () => {
    expect(STAGES.filter((s) => stageEnabled(s, "all", true))).not.toContain("team");
    expect(STAGES.filter((s) => stageEnabled(s, "none", false, true)).slice(-2)).toEqual([
      "team",
      "profiles",
    ]);
  });
  it("progress is firms marked; errors and caps leave them due", () => {
    expect(progressOf.team({ firms_matched: 2, firms_unresolved: 1, firms_skipped: 1 })).toBe(4);
    expect(progressOf.team({ selected: 3, errors: 3 })).toBe(0);
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
