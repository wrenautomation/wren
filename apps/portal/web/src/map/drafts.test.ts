import type { BlameLine, VersionLine } from "@wren/pipeline/history";
import { describe, expect, it } from "vitest";
import {
  actionsOf,
  blameHow,
  blameMeta,
  blamePick,
  draftIdOf,
  draftRef,
  draftStoreKey,
  fromDraft,
  historyOf,
  LIVE_MOVED,
  liveMoved,
  newestOf,
  openCount,
  pairOf,
  proposalsLine,
  refLabel,
  shortSha,
} from "./drafts.js";

const line = (over: Partial<BlameLine> = {}): BlameLine => ({
  version: 2,
  how: "changed",
  note: "Clearer name.",
  by: "Ada North",
  at: "2026-10-19T15:00:00.000Z",
  ...over,
});

const version = (number: number, parent: number | null): VersionLine => ({
  number,
  parent,
  note: "",
  at: "2026-10-19T15:00:00.000Z",
  by: "Ada North",
  nodes: 5,
  edges: 4,
  draft: null,
  tags: [],
  mirror: null,
});

describe("draft address", () => {
  it("names a draft for the diff route", () => {
    expect(draftRef("d1")).toBe("draft:d1");
  });
  it("reads ?draft= and drops an empty one", () => {
    expect(draftIdOf("d1")).toBe("d1");
    expect(draftIdOf(" d1 ")).toBe("d1");
    expect(draftIdOf("")).toBeNull();
    expect(draftIdOf(null)).toBeNull();
  });
  it("reads ?history=", () => {
    expect(historyOf("drafts")).toBe("drafts");
    expect(historyOf("1")).toBe("versions");
    expect(historyOf("versions")).toBe("versions");
    expect(historyOf("other")).toBeNull();
    expect(historyOf(null)).toBeNull();
  });
});

describe("draftStoreKey", () => {
  it("keeps a draft's edits apart from the live shape's", () => {
    expect(draftStoreKey("wren", null)).toBe("map:draft:wren");
    expect(draftStoreKey("wren", "d1")).toBe("map:draft:wren:d1");
    expect(draftStoreKey("wren", "d1")).not.toBe(draftStoreKey("wren", "d2"));
    expect(draftStoreKey("acme", "d1")).not.toBe(draftStoreKey("wren", "d1"));
  });
});

describe("actionsOf", () => {
  it("lets a draft do everything", () => {
    expect(actionsOf("draft")).toEqual({
      open: true,
      compare: true,
      propose: true,
      apply: true,
      drop: true,
    });
  });
  it("lets a proposed draft be decided, not proposed again", () => {
    const a = actionsOf("proposed");
    expect(a.propose).toBe(false);
    expect([a.open, a.apply, a.drop]).toEqual([true, true, true]);
  });
  it("lets a closed draft only be compared", () => {
    for (const s of ["applied", "dropped"] as const)
      expect(actionsOf(s)).toEqual({
        open: false,
        compare: true,
        propose: false,
        apply: false,
        drop: false,
      });
  });
});

describe("versions", () => {
  it("finds the newest", () => {
    expect(newestOf([version(1, null), version(3, 2), version(2, 1)])).toBe(3);
    expect(newestOf([])).toBe(0);
  });
  it("says when live moved on", () => {
    expect(liveMoved(1, 2)).toBe(true);
    expect(liveMoved(2, 2)).toBe(false);
    expect(LIVE_MOVED).toBe("Live changed since this draft started.");
  });
  it("cuts a sha to seven characters", () => {
    expect(shortSha({ sha: "9f3c2a1b7d0e", url: "https://example.test" })).toBe("9f3c2a1");
    expect(shortSha(null)).toBe("");
  });
  it("names the draft a version came from", () => {
    expect(fromDraft({ draft: "Add a plan" })).toBe("from draft Add a plan");
    expect(fromDraft({ draft: null })).toBeNull();
  });
  it("counts open drafts", () => {
    expect(
      openCount([
        { state: "draft" },
        { state: "proposed" },
        { state: "dropped" },
        { state: "applied" },
      ]),
    ).toBe(2);
  });
});

describe("blame lines", () => {
  it("says what a version did", () => {
    expect(blameHow(line({ how: "added" }))).toBe("Added");
    expect(blameHow(line({ how: "removed" }))).toBe("Removed");
    expect(blameHow(line({ how: "changed" }))).toBe("Changed");
    expect(blameHow(line({ how: "renamed", from: "Joined", to: "Signed" }))).toBe(
      "Renamed Joined to Signed",
    );
    expect(blameHow(line({ how: "renamed" }))).toBe("Renamed");
  });
  it("says who and when", () => {
    expect(blameMeta(line())).toBe("Ada North · Oct 19, 2026");
    expect(blameMeta(line({ by: "", at: "not a time" }))).toBe("");
  });
  it("picks the version and its parent", () => {
    const versions = [version(2, 1), version(1, null)];
    expect(blamePick(line({ version: 2 }), versions)).toEqual([1, 2]);
    expect(blamePick(line({ version: 1 }), versions)).toEqual([1]);
    expect(blamePick(line({ version: 9 }), versions)).toEqual([9]);
  });
});

describe("diff sides", () => {
  it("needs two picks, oldest first", () => {
    expect(pairOf([2, 1])).toEqual([1, 2]);
    expect(pairOf([1])).toBeNull();
    expect(pairOf([])).toBeNull();
  });
  it("labels a version and a draft", () => {
    expect(refLabel(3)).toBe("Version 3");
    expect(refLabel("draft:d1")).toBe("Draft d1");
    expect(refLabel("draft:d1", new Map([["d1", "Add a plan"]]))).toBe("Draft Add a plan");
  });
});

describe("proposalsLine", () => {
  it("says nothing when none wait", () => {
    expect(proposalsLine(0)).toBeNull();
  });
  it("says how many wait", () => {
    expect(proposalsLine(1)).toBe("1 shape proposal waits");
    expect(proposalsLine(3)).toBe("3 shape proposals wait");
  });
});
