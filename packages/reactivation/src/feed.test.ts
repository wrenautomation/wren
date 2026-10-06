import type { FindingDraft } from "@wren/research";
import type { LookupResult } from "@wren/research/people";
import { describe, expect, it } from "vitest";
import {
  briefLine,
  composeLine,
  type FoundFact,
  failedLine,
  hiringLine,
  lookupLine,
  STAGE_DONE,
  stageDone,
  whereLine,
} from "./feed.js";
import type { CrmStageResult } from "./run.js";

const fact = (kind: string, value: Record<string, unknown>, via = "search"): FoundFact => ({
  kind,
  value,
  via,
  sourceUrl: "https://example.com/p",
});
const draft = (kind: FindingDraft["kind"], value: Record<string, unknown>): FindingDraft => ({
  kind,
  personId: 1,
  factKey: kind,
  value,
  confidence: 0.9,
  via: "linkedin_profile",
  sourceUrl: "https://www.linkedin.com/in/x",
  document: null,
});
const looked = (o: Partial<LookupResult>): LookupResult => ({
  state: "matched",
  profile: null,
  findings: [],
  tried: [],
  retryAt: null,
  cappedBy: null,
  pages: [],
  googleStopped: null,
  ...o,
});
const OCT_1 = new Date("2026-10-01T09:00:00Z");

describe("whereLine", () => {
  it("no finding: couldn't tell, no source", () => {
    expect(whereLine("Cara Lim", null)).toEqual({
      step: "lookup",
      subject: "Cara Lim",
      kind: "did",
      line: "Couldn't tell for sure where Cara Lim is now",
    });
  });

  it("a move names the new firm and title, with its source", () => {
    const e = whereLine("Cara Lim", fact("job_change", { to: "Initech", title: "Recruiter" }));
    expect(e).toMatchObject({ kind: "found", line: "Cara Lim moved to Initech, Recruiter" });
    expect(e.source).toEqual({ label: "Web search", href: "https://example.com/p" });
  });

  it("a move with no firm or a blank title still reads", () => {
    expect(whereLine("Cara", fact("job_change", { title: "  " })).line).toBe(
      "Cara moved to a new company",
    );
  });

  it("left, and left with no firm", () => {
    expect(whereLine("Bob", fact("left", { from: " Globex " })).line).toBe("Bob left Globex");
    expect(whereLine("Bob", fact("left", {})).line).toBe("Bob left their company");
  });

  it("still there is a did, with or without the firm", () => {
    expect(whereLine("Jane", fact("still_there", { company: "Umbrella" }))).toMatchObject({
      kind: "did",
      line: "Jane is still at Umbrella",
    });
    expect(whereLine("Jane", fact("still_there", {})).line).toBe(
      "Jane is still at the same company",
    );
  });

  it("names the source the way the portal does", () => {
    const label = (via: string) => whereLine("X", fact("left", {}, via)).source?.label;
    expect(label("linkedin_profile")).toBe("LinkedIn");
    expect(label("email")).toBe("Email check");
    expect(label("site")).toBe("Company site");
    expect(label("job_board")).toBe("Job board");
  });
});

describe("lookupLine", () => {
  it("capped: waits until the retry day", () => {
    expect(lookupLine("Cara", looked({ state: "capped", retryAt: OCT_1 }))).toEqual({
      step: "lookup",
      subject: "Cara",
      kind: "waiting",
      line: "Cara waits until Oct 1. Today's lookups ran out.",
    });
    expect(lookupLine("Cara", looked({ state: "capped" })).line).toBe(
      "Cara waits. Today's lookups ran out.",
    );
  });

  it("matched: a move beats a departure beats still there, whatever the order", () => {
    const findings = [
      draft("still_there", { company: "Umbrella" }),
      draft("left", { from: "Umbrella" }),
      draft("job_change", { to: "Initech" }),
    ];
    expect(lookupLine("Cara", looked({ findings })).line).toBe("Cara moved to Initech");
    expect(lookupLine("Cara", looked({ findings: findings.slice(0, 2) })).line).toBe(
      "Cara left Umbrella",
    );
  });

  it("matched with no findings, or unresolved: couldn't tell", () => {
    expect(lookupLine("Cara", looked({})).kind).toBe("did");
    const unresolved = looked({ state: "unresolved", findings: [draft("left", {})] });
    expect(lookupLine("Cara", unresolved).line).toBe("Couldn't tell for sure where Cara is now");
  });
});

describe("hiringLine", () => {
  const hiring = (count: unknown) => ({
    state: "hiring" as const,
    finding: fact("hiring", { count }, "job_board"),
    retryAt: null,
  });

  it("hiring: the count, singular or plural, with its source", () => {
    expect(hiringLine("Acme", hiring(2))).toEqual({
      step: "signals",
      subject: "Acme",
      kind: "found",
      line: "Acme is hiring: 2 open roles",
      count: 2,
      source: { label: "Job board", href: "https://example.com/p" },
    });
    expect(hiringLine("Acme", hiring(1)).line).toBe("Acme is hiring: 1 open role");
  });

  it("no openings, capped, unresolved", () => {
    const r = (state: "no_openings" | "capped" | "unresolved", retryAt: Date | null = null) =>
      hiringLine("Acme", { state, finding: null, retryAt });
    expect(r("no_openings")).toMatchObject({ kind: "did", line: "Acme has no open roles" });
    expect(r("capped", OCT_1)).toMatchObject({
      kind: "waiting",
      line: "Acme waits until Oct 1. Today's checks ran out.",
    });
    expect(r("capped").line).toBe("Acme waits. Today's checks ran out.");
    expect(r("unresolved")).toMatchObject({ kind: "did", line: "Couldn't tell if Acme is hiring" });
  });

  it("hiring with no finding: couldn't tell", () => {
    expect(hiringLine("Acme", { state: "hiring", finding: null, retryAt: null }).line).toBe(
      "Couldn't tell if Acme is hiring",
    );
  });
});

describe("briefLine and composeLine", () => {
  it("a written brief says how many sourced lines", () => {
    expect(briefLine("Cara", "written", 1)).toMatchObject({
      kind: "found",
      line: "Wrote a brief on Cara: 1 sourced line",
      count: 1,
    });
    expect(briefLine("Cara", "written", 3).line).toBe("Wrote a brief on Cara: 3 sourced lines");
  });

  it("an empty brief is a did, a failed one a failed", () => {
    expect(briefLine("Cara", "empty", 0).kind).toBe("did");
    expect(briefLine("Cara", "failed", 0)).toMatchObject({
      kind: "failed",
      line: "The brief on Cara didn't pass the fact check",
    });
  });

  it("each compose outcome", () => {
    const c = (o: Parameters<typeof composeLine>[1]) => composeLine("Cara", o);
    expect(c("drafted")).toMatchObject({
      step: "compose",
      kind: "found",
      line: "Drafted an email to Cara: waiting for your OK",
    });
    expect(c("approved").line).toBe("Drafted an email to Cara: approved to send");
    expect(c("suppressed")).toMatchObject({ kind: "did" });
    expect(c("failed")).toMatchObject({ kind: "failed" });
  });
});

describe("failedLine", () => {
  it("says who in the line and why in the detail", () => {
    expect(failedLine("signals", "Acme", new RangeError("429"))).toEqual({
      step: "signals",
      kind: "failed",
      subject: "Acme",
      line: "Couldn't finish Acme; it will be tried again",
      detail: "RangeError: 429",
    });
  });
});

describe("STAGE_DONE", () => {
  it("one and many", () => {
    expect(STAGE_DONE.verify(1, 1, 0)).toBe("Checked 1 address: 1 work, 0 bounce, 0 can't tell");
    expect(STAGE_DONE.lookup(1, 1, 0)).toBe("Looked up 1 person: 1 moved, 0 left");
    expect(STAGE_DONE.lookup(2, 0, 1)).toBe("Looked up 2 people: 0 moved, 1 left");
    expect(STAGE_DONE.signals(1, 0)).toBe("Checked 1 company: 0 hiring");
    expect(STAGE_DONE.movers(3, 2)).toBe("Looked for 3 movers at their new firms: 2 found");
    expect(STAGE_DONE.brief(1)).toBe("Wrote 1 brief");
    expect(STAGE_DONE.compose(2)).toBe("Drafted 2 emails");
  });
});

describe("stageDone", () => {
  const verify = {
    selected: 20,
    valid: 3,
    invalid: 1,
    local_invalid: 2,
    risky: 1,
    catch_all: 1,
    local_errors: 1,
    held: 0,
    aborted: null,
  };
  const lookup = {
    selected: 3,
    matched: 3,
    unresolved: 0,
    capped: 0,
    errors: 0,
    findings: {},
    moved: 0,
    left: 0,
    aborted: null,
  };
  const signals = {
    selected: 4,
    hiring: 1,
    no_openings: 1,
    unresolved: 0,
    capped: 2,
    errors: 0,
    aborted: null,
  };

  it("verify counts the verdicts, not the candidates; bounce is invalid plus local invalid", () => {
    expect(stageDone({ stage: "verify", stats: verify })).toEqual({
      step: "verify",
      kind: "done",
      line: "Checked 9 addresses: 3 work, 3 bounce, 3 can't tell",
      count: 9,
    });
  });

  it("lookup counts people who moved or left, not findings", () => {
    expect(stageDone({ stage: "lookup", stats: lookup })).toMatchObject({
      line: "Looked up 3 people: 0 moved, 0 left",
      count: 3,
    });
    // Three findings on two people: one moved (and left), one left.
    const found = { ...lookup, findings: { job_change: 1, left: 2 }, moved: 1, left: 1 };
    expect(stageDone({ stage: "lookup", stats: found }).line).toBe(
      "Looked up 3 people: 1 moved, 1 left",
    );
  });

  it("score has no count; brief and compose count what they wrote", () => {
    const r = (x: CrmStageResult) => stageDone(x);
    expect(
      r({
        stage: "score",
        stats: {
          selected: 9,
          hiringThere: 0,
          moved: 0,
          stillThere: 0,
          unknown: 0,
          left: 0,
          conflicted: 0,
          keepWarm: 0,
          aborted: null,
        },
      }),
    ).toEqual({
      step: "score",
      kind: "done",
      line: "Ranked everyone by who to call first",
      count: null,
    });
    const brief = {
      selected: 5,
      written: 2,
      empty: 1,
      failed: 1,
      dropped: 0,
      errors: 1,
      aborted: null,
    };
    expect(r({ stage: "brief", stats: brief })).toMatchObject({ line: "Wrote 2 briefs", count: 2 });
    const compose = {
      selected: 5,
      drafted: 1,
      approved: 0,
      failed: 2,
      suppressed: 1,
      raced: 0,
      errors: 1,
      aborted: null,
    };
    expect(r({ stage: "compose", stats: compose })).toMatchObject({
      line: "Drafted 1 email",
      count: 1,
    });
  });

  it("aborted: a waiting line with the why as detail, no count", () => {
    const stats = { ...lookup, aborted: "search capped until 2026-10-01T00:00:00.000Z" };
    expect(stageDone({ stage: "lookup", stats })).toEqual({
      step: "lookup",
      kind: "waiting",
      line: "Stopped here for now",
      detail: "search capped until 2026-10-01T00:00:00.000Z",
    });
  });

  // The replay leaves parked units out of a stage's count, and the Run view
  // tallies them as waiting, not handled: the live done line should agree.
  it("signals: a parked company isn't counted as checked", () => {
    expect(stageDone({ stage: "signals", stats: signals })).toMatchObject({
      line: "Checked 2 companies: 1 hiring",
      count: 2,
    });
  });

  it("lookup: a parked person isn't counted as looked up", () => {
    const parked = { ...lookup, matched: 2, capped: 1 };
    expect(stageDone({ stage: "lookup", stats: parked })).toMatchObject({
      line: "Looked up 2 people: 0 moved, 0 left",
      count: 2,
    });
  });
});
