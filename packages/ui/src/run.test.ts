import { describe, expect, it } from "vitest";
import { dwellOf, RUN_DWELL, type RunLine, stepsAt } from "./run.js";

const line = (id: number, step: string, kind: RunLine["kind"], subject?: string): RunLine => ({
  id,
  step,
  kind,
  text: `${kind} ${subject ?? ""}`,
  subject: subject ?? null,
});

const STEPS = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
];
const LINES = [
  line(1, "a", "started"),
  line(2, "a", "found", "Cara L."),
  line(3, "a", "did", "Jane D."),
  line(4, "a", "done"),
  line(5, "b", "started"),
  line(6, "b", "waiting", "Initech"),
  line(7, "b", "waiting"),
];

describe("stepsAt", () => {
  it("nothing shown: every step idle at zero", () => {
    expect(stepsAt(STEPS, LINES, 0)).toEqual({
      a: { state: "idle", handled: 0, found: 0, failed: 0, waiting: 0 },
      b: { state: "idle", handled: 0, found: 0, failed: 0, waiting: 0 },
    });
  });

  it("counts what each step handled and found, as far as shown", () => {
    expect(stepsAt(STEPS, LINES, 3).a).toEqual({
      state: "active",
      handled: 2,
      found: 1,
      failed: 0,
      waiting: 0,
    });
    expect(stepsAt(STEPS, LINES, 4).a?.state).toBe("done");
  });

  it("a parked subject waits, not handled; the step's own waiting line parks the step", () => {
    expect(stepsAt(STEPS, LINES, 6).b).toEqual({
      state: "active",
      handled: 0,
      found: 0,
      failed: 0,
      waiting: 1,
    });
    expect(stepsAt(STEPS, LINES, 7).b?.state).toBe("waiting");
  });

  it("a step with no line per subject takes its total from its last line", () => {
    const done = { ...line(2, "a", "done"), count: 15 };
    expect(stepsAt(STEPS, [line(1, "a", "started"), done], 2).a?.handled).toBe(15);
  });

  it("a line for a step it doesn't draw is left out, not a crash", () => {
    expect(stepsAt(STEPS, [line(1, "zzz", "found", "X")], 1).a?.handled).toBe(0);
  });

  it("each subject counts once, as its latest line says", () => {
    const parkedThenDone = [line(1, "a", "waiting", "Cara L."), line(2, "a", "did", "Cara L.")];
    expect(stepsAt(STEPS, parkedThenDone, 2).a).toMatchObject({ handled: 1, waiting: 0 });
    const failedThenFound = [line(1, "a", "failed", "Cara L."), line(2, "a", "found", "Cara L.")];
    expect(stepsAt(STEPS, failedThenFound, 2).a).toMatchObject({ handled: 1, found: 1, failed: 0 });
  });

  it("a subject line with no started line still marks the step active", () => {
    expect(stepsAt(STEPS, [line(1, "a", "did", "Jane D.")], 1).a?.state).toBe("active");
  });

  it("a total that isn't a number is ignored", () => {
    const done = { ...line(1, "a", "done"), count: Number.POSITIVE_INFINITY };
    expect(stepsAt(STEPS, [done], 1).a?.handled).toBe(0);
  });
});

describe("dwellOf", () => {
  it("a replay always plays at its own pace", () => {
    expect(dwellOf(LINES[1], 50, false)).toBe(RUN_DWELL.found);
  });

  it("a live run that falls behind plays at most twice as fast, never skips", () => {
    expect(dwellOf(LINES[1], 2, true)).toBe(RUN_DWELL.found);
    expect(dwellOf(LINES[1], 40, true)).toBe(RUN_DWELL.found / 2);
  });
});

describe("edge cases", () => {
  it("shown past the end counts every line once", () => {
    expect(stepsAt(STEPS, LINES, 99)).toEqual(stepsAt(STEPS, LINES, LINES.length));
  });

  it("a done count lower than what the lines handled never lowers it", () => {
    const lines = [
      line(1, "a", "started"),
      line(2, "a", "did", "X"),
      line(3, "a", "did", "Y"),
      line(4, "a", "found", "Z"),
      { ...line(5, "a", "done"), count: 2 },
    ];
    expect(stepsAt(STEPS, lines, 5).a).toEqual({
      state: "done",
      handled: 3,
      found: 1,
      failed: 0,
      waiting: 0,
    });
  });

  it("a done line with no count or zero keeps the handled count", () => {
    const lines = [line(1, "a", "did", "X"), { ...line(2, "a", "done"), count: 0 }];
    expect(stepsAt(STEPS, lines, 2).a?.handled).toBe(1);
  });

  it("exactly 3 behind keeps the normal pace; 4 behind speeds up", () => {
    expect(dwellOf(LINES[0], 3, true)).toBe(RUN_DWELL.started);
    expect(dwellOf(LINES[0], 4, true)).toBe(RUN_DWELL.started / 2);
  });

  it("no line to hold: no wait", () => {
    expect(dwellOf(undefined, 10, true)).toBe(0);
  });
});
