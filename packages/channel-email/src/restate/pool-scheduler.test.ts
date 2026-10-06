import { describe, expect, it } from "vitest";
import { progressOf, STAGES, stageEnabled, stagesToRun, type Wired } from "./pool-scheduler.js";

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
          s !== "instagram" &&
          s !== "fbGroups" &&
          s !== "exaSearch" &&
          s !== "signals",
      ),
    );
    const wired = (w: Wired) => STAGES.filter((s) => stageEnabled(s, "none", false, w));
    expect(wired({ youtube: true })).toContain("youtube");
    // Signals go last, on their own switch.
    expect(wired({ signals: true }).at(-1)).toBe("signals");
    // Instagram is its own switch, right after youtube.
    const ig = wired({ youtube: true, instagram: true });
    expect(ig[ig.indexOf("youtube") + 1]).toBe("instagram");
    expect(wired({ youtube: true })).not.toContain("instagram");
    // New firms first, so the same pass discovers and crawls them.
    expect(wired({ adLibrary: true })[0]).toBe("adLibrary");
    // Right after Ad Library, then groups: all three bring firms in before anything reads them,
    // and groups map posts onto the firms the other two just added.
    expect(wired({ adLibrary: true, exaSearch: true, fbGroups: true }).slice(0, 3)).toEqual([
      "adLibrary",
      "exaSearch",
      "fbGroups",
    ]);
    expect(wired({ fbGroups: true })).toEqual(["fbGroups", ...on("none", false)]);
    expect(wired({ exaSearch: true })[0]).toBe("exaSearch");
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

describe("progressOf.instagram", () => {
  it("is accounts written (read or missing); errors and caps leave firms due", () => {
    expect(progressOf.instagram({ read: 2, missing: 1, errors: 4 })).toBe(3);
    expect(progressOf.instagram({ selected: 5, errors: 5 })).toBe(0);
  });
});

describe("the profiles stage", () => {
  it("is off unless asked for, and then runs last, after the addresses it needs are proven", () => {
    expect(STAGES.filter((s) => stageEnabled(s, "all", true))).not.toContain("profiles");
    expect(STAGES.filter((s) => stageEnabled(s, "none", false, { profiles: true })).at(-1)).toBe(
      "profiles",
    );
    expect([...stagesToRun({ stages: ["profiles"] }, "none", false)]).toEqual([]);
    expect([...stagesToRun({ stages: ["profiles"] }, "none", false, { profiles: true })]).toEqual([
      "profiles",
    ]);
  });
  it("progress is people written; errors and caps leave them due", () => {
    expect(progressOf.profiles({ people_matched: 2, people_unresolved: 1, errors: 4 })).toBe(3);
    expect(progressOf.profiles({ selected: 5, errors: 5 })).toBe(0);
  });
});

describe("the team stage", () => {
  it("rides the profiles switch, just before it", () => {
    expect(STAGES.filter((s) => stageEnabled(s, "all", true))).not.toContain("team");
    expect(
      STAGES.filter((s) => stageEnabled(s, "none", false, { profiles: true })).slice(-2),
    ).toEqual(["team", "profiles"]);
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
