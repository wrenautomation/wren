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
      a: { state: "idle", handled: 0, found: 0, waiting: 0 },
      b: { state: "idle", handled: 0, found: 0, waiting: 0 },
    });
  });

  it("counts what each step handled and found, as far as shown", () => {
    expect(stepsAt(STEPS, LINES, 3).a).toEqual({
      state: "active",
      handled: 2,
      found: 1,
      waiting: 0,
    });
    expect(stepsAt(STEPS, LINES, 4).a?.state).toBe("done");
  });

  it("a parked subject waits, not handled; the step's own waiting line parks the step", () => {
    expect(stepsAt(STEPS, LINES, 6).b).toEqual({
      state: "active",
      handled: 0,
      found: 0,
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
