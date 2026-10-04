// Covers railOf and each step's note. `soon` reads the clock, so the clock is pinned to a local
// time and resume times are built the same way; that keeps the notes timezone-proof.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pipeline, PipelineStep, PipelineStepId, StepState } from "../../api.js";
import { railOf, STEP_NAMES } from "./steps.js";

const IDS: PipelineStepId[] = [
  "list",
  "emails",
  "where",
  "hiring",
  "score",
  "briefs",
  "drafts",
  "approve",
  "sent",
  "replies",
];
const STATES: StepState[] = ["done", "next", "waiting", "yours", "idle"];

/** Wed Sep 30 2026, 10:00 local. */
const NOW = new Date(2026, 8, 30, 10, 0);
const local = (d: number, h: number, min = 0) => new Date(2026, 8, d, h, min).toISOString();

const step = (id: PipelineStepId, o: Partial<PipelineStep> = {}): PipelineStep => ({
  id,
  count: 0,
  of: null,
  state: "idle",
  resumesAt: null,
  parked: 0,
  ...o,
});

const pipeline = (steps: PipelineStep[], sends = true): Pipeline => ({ steps, sends });

/** One step's rail entry, from a pipeline of just that step. */
function railStep(s: PipelineStep, sends = true, demo = false) {
  const found = railOf(pipeline([s], sends), demo)
    .flatMap((g) => g.steps)
    .find((x) => x.id === s.id);
  if (!found) throw new Error(`no ${s.id} on the rail`);
  return found;
}

/** Notes are strings; some ICU builds put a narrow no-break space before AM/PM. */
const noteOf = (s: PipelineStep, sends = true, demo = false) =>
  String(railStep(s, sends, demo).note).replace(/\s/g, " ");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("railOf: shape", () => {
  const all = pipeline(IDS.map((id) => step(id)));

  it("groups the steps into Research, Write, Send", () => {
    expect(railOf(all, false).map((g) => [g.id, g.label])).toEqual([
      ["research", "Research"],
      ["write", "Write"],
      ["send", "Send"],
    ]);
  });

  it("puts every step on the rail once, in order", () => {
    const rail = railOf(all, false);
    expect(rail.map((g) => g.steps.map((s) => s.id))).toEqual([
      ["list", "emails", "where", "hiring", "score"],
      ["briefs", "drafts"],
      ["approve", "sent", "replies"],
    ]);
    expect(rail.flatMap((g) => g.steps.map((s) => s.id))).toEqual(IDS);
  });

  it("keeps rail order when the pipeline comes scrambled", () => {
    const scrambled = pipeline([...IDS].reverse().map((id) => step(id)));
    expect(railOf(scrambled, false).flatMap((g) => g.steps.map((s) => s.id))).toEqual(IDS);
  });

  it("an empty pipeline gives three empty phases", () => {
    expect(railOf(pipeline([]), false)).toEqual([
      { id: "research", label: "Research", steps: [] },
      { id: "write", label: "Write", steps: [] },
      { id: "send", label: "Send", steps: [] },
    ]);
  });

  it("leaves out steps the pipeline lacks, keeping the rest", () => {
    const rail = railOf(pipeline([step("replies"), step("list")]), false);
    expect(rail.map((g) => g.steps.map((s) => s.id))).toEqual([["list"], [], ["replies"]]);
  });

  it("labels each step by its name and passes its state through", () => {
    const rail = railOf(
      pipeline(IDS.map((id, i) => step(id, { state: STATES[i % STATES.length] ?? "idle" }))),
      false,
    ).flatMap((g) => g.steps);
    for (const [i, s] of rail.entries()) {
      expect(s.label).toBe(STEP_NAMES[s.id as PipelineStepId]);
      expect(s.state).toBe(STATES[i % STATES.length]);
    }
  });

  it("every step name is set and distinct", () => {
    const names = IDS.map((id) => STEP_NAMES[id]);
    expect(names.every((n) => n.trim().length > 0)).toBe(true);
    expect(new Set(names).size).toBe(IDS.length);
  });

  it("formats counts with thousands separators, zero included", () => {
    expect(railStep(step("list", { count: 0 })).count).toBe("0");
    expect(railStep(step("list", { count: 1234567, state: "done" })).count).toBe("1,234,567");
  });

  it("links every step into the portal", () => {
    const hrefs = Object.fromEntries(
      railOf(all, false)
        .flatMap((g) => g.steps)
        .map((s) => [s.id, s.href]),
    );
    expect(hrefs).toEqual({
      list: "/reactivation/people",
      emails: "/reactivation/overview",
      where: "/reactivation/people?view=all&now=moved",
      hiring: "/reactivation/people?view=all&now=hiring",
      score: "/reactivation/people",
      briefs: "/reactivation/people",
      drafts: "/reactivation/emails",
      approve: "/reactivation/emails",
      sent: "/reactivation/emails?view=sent",
      replies: "/reactivation/replies?view=all",
    });
  });
});

describe("railOf: waiting notes", () => {
  it("says how many wait and until when, later today", () => {
    const s = step("where", { state: "waiting", parked: 3, resumesAt: local(30, 20) });
    expect(noteOf(s)).toBe("3 wait till 8:00 PM");
  });

  it("says tomorrow", () => {
    const s = step("hiring", { state: "waiting", parked: 2, resumesAt: local(31, 8) });
    // Sep 31 rolls over to Oct 1: tomorrow.
    expect(noteOf(s)).toBe("2 wait till tomorrow 8:00 AM");
  });

  it("formats a large parked count", () => {
    const s = step("where", { state: "waiting", parked: 1500, resumesAt: local(30, 20) });
    expect(noteOf(s)).toBe("1,500 wait till 8:00 PM");
  });

  it("a resume time already past falls back to the next pass", () => {
    const s = step("where", { state: "waiting", parked: 3, resumesAt: local(30, 9) });
    expect(noteOf(s)).toBe("3 wait for the next pass");
  });

  it("a resume time exactly now falls back to the next pass", () => {
    const s = step("where", { state: "waiting", parked: 3, resumesAt: NOW.toISOString() });
    expect(noteOf(s)).toBe("3 wait for the next pass");
  });

  it("no resume time falls back to the next pass", () => {
    const s = step("where", { state: "waiting", parked: 3, resumesAt: null });
    expect(noteOf(s)).toBe("3 wait for the next pass");
  });

  it("an unreadable resume time falls back to the next pass", () => {
    const s = step("where", { state: "waiting", parked: 3, resumesAt: "soon-ish" });
    expect(noteOf(s)).toBe("3 wait for the next pass");
  });
});

describe("railOf: next notes", () => {
  it("says how many are left when the step has a set", () => {
    expect(noteOf(step("emails", { state: "next", count: 8, of: 12 }))).toBe("4 to go");
  });

  it("formats a large count left", () => {
    expect(noteOf(step("where", { state: "next", count: 0, of: 2500 }))).toBe("2,500 to go");
  });

  it("all done out of the set (a rescore) says runs next, not 0 to go", () => {
    expect(noteOf(step("score", { state: "next", count: 21, of: 21 }))).toBe("runs next");
  });

  it("a count above `of` says runs next, not a negative", () => {
    expect(noteOf(step("hiring", { state: "next", count: 14, of: 12 }))).toBe("runs next");
  });

  it("`of` 0 says runs next", () => {
    expect(noteOf(step("emails", { state: "next", count: 0, of: 0 }))).toBe("runs next");
  });

  it("no `of` says runs next", () => {
    expect(noteOf(step("briefs", { state: "next", count: 5, of: null }))).toBe("runs next");
    expect(noteOf(step("sent", { state: "next", count: 10, of: null }))).toBe("runs next");
  });
});

describe("railOf: yours notes", () => {
  it("approve waiting on the client says ready to read", () => {
    expect(noteOf(step("approve", { state: "yours", count: 5 }))).toBe("ready to read");
  });

  it("says ready to read even with 0 awaiting", () => {
    expect(noteOf(step("approve", { state: "yours", count: 0 }))).toBe("ready to read");
  });
});

describe("railOf: done notes", () => {
  const done = (id: PipelineStepId, o: Partial<PipelineStep> = {}) =>
    noteOf(step(id, { state: "done", count: 5, ...o }));

  it("says what finishing looks like for each step", () => {
    expect(done("list")).toBe("from your CRM");
    expect(done("score", { of: 21 })).toBe("by why now");
    expect(done("briefs")).toBe("each with sources");
    expect(done("drafts")).toBe("written");
    expect(done("approve")).toBe("all read");
    expect(done("replies")).toBe("so far");
  });

  it("emails: all checked only when count reaches `of`", () => {
    expect(done("emails", { count: 19, of: 19 })).toBe("all checked");
    expect(done("emails", { count: 18, of: 19 })).toBe("checked");
    expect(done("emails", { count: 5, of: null })).toBe("checked");
  });

  it("where: all looked up only when count reaches `of`", () => {
    expect(done("where", { count: 21, of: 21 })).toBe("all looked up");
    expect(done("where", { count: 18, of: 21 })).toBe("looked up");
    expect(done("where", { count: 5, of: null })).toBe("looked up");
  });

  it("hiring: out of how many companies", () => {
    expect(done("hiring", { count: 12, of: 12 })).toBe("of 12 companies");
    expect(done("hiring", { count: 1200, of: 1234 })).toBe("of 1,234 companies");
    expect(done("hiring", { of: null })).toBe("companies checked");
  });

  it("hiring: one company is singular", () => {
    expect(done("hiring", { count: 1, of: 1 })).toBe("of 1 company");
  });
});

describe("railOf: idle notes", () => {
  it("says not started on any step", () => {
    for (const id of IDS) expect(noteOf(step(id), true, false), id).toBe("not started");
  });

  it("sent with sending off on the demo says so", () => {
    expect(noteOf(step("sent"), false, true)).toBe("never sends");
  });

  it("sent with sending off on a real client says off for now", () => {
    expect(noteOf(step("sent"), false, false)).toBe("off for now");
  });

  it("sent with sending on says not started, demo or not", () => {
    expect(noteOf(step("sent"), true, false)).toBe("not started");
    expect(noteOf(step("sent"), true, true)).toBe("not started");
  });

  it("sending off only changes the sent step's note", () => {
    for (const id of IDS.filter((i) => i !== "sent")) {
      expect(noteOf(step(id), false, true), id).toBe("not started");
      expect(noteOf(step(id), false, false), id).toBe("not started");
    }
  });
});

describe("railOf: every note, every case", () => {
  const counts = [0, 5, 9];
  const ofs = [null, 0, 5];
  const parks = [0, 3];
  const times = [null, local(30, 9), local(30, 20), local(31, 8), "garbage"];
  const cases = IDS.flatMap((id) =>
    STATES.flatMap((state) =>
      counts.flatMap((count) =>
        ofs.flatMap((of) =>
          parks.flatMap((parked) =>
            times.map((resumesAt) => step(id, { state, count, of, parked, resumesAt })),
          ),
        ),
      ),
    ),
  );
  const flags: [boolean, boolean][] = [
    [true, false],
    [false, false],
    [false, true],
    [true, true],
  ];

  it("is a non-empty string with no NaN, undefined, null, 0 to go, or negative", () => {
    const bad: string[] = [];
    for (const s of cases)
      for (const [sends, demo] of flags) {
        const note = railStep(s, sends, demo).note;
        if (
          typeof note !== "string" ||
          note.trim() === "" ||
          /NaN|undefined|null|\b0 to go|-\d/.test(note)
        )
          bad.push(`${s.id}/${s.state}/${s.count}/${s.of}: ${String(note)}`);
      }
    expect(bad).toEqual([]);
  });

  it("never repeats the step's label", () => {
    const bad = new Set<string>();
    for (const s of cases)
      for (const [sends, demo] of flags) {
        const r = railStep(s, sends, demo);
        if (String(r.note).trim().toLowerCase() === r.label.toLowerCase())
          bad.add(`${s.id}/${s.state}: "${r.label}" -> "${String(r.note)}"`);
      }
    expect([...bad]).toEqual([]);
  });
});
