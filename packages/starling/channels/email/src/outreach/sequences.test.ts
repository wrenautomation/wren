/** Cadence as data: sequences are named registry entries. */
import { describe, expect, it } from "vitest";
import {
  armOf,
  sequence,
  sequenceStep,
  threeEmailSequence,
  twoEmailSequence,
} from "./sequences.js";

const shape = (s: { steps: readonly { template: string; day: number }[] }) =>
  s.steps.map((st) => [st.template, st.day]);

describe("sequences", () => {
  it("three-email default shape", () => {
    const seq = threeEmailSequence("opener", "followup", "final_followup");
    expect(seq.name).toBe("3-emails-days-0-3-7");
    expect(shape(seq)).toEqual([
      ["opener", 0],
      ["followup", 3],
      ["final_followup", 7],
    ]);
  });
  it("three-email custom cadence", () => {
    const seq = threeEmailSequence("opener", "followup", "final_followup", {
      name: "fast",
      days: [0, 2, 5],
    });
    expect(seq.name).toBe("fast");
    expect(seq.steps.map((s) => s.day)).toEqual([0, 2, 5]);
  });
  it("default name derives from days", () => {
    expect(
      threeEmailSequence("opener", "followup", "final_followup", { days: [0, 2, 5] }).name,
    ).toBe("3-emails-days-0-2-5");
  });
  it("two-email is one nudge and out", () => {
    const seq = twoEmailSequence("opener", "followup");
    expect(seq.name).toBe("2-emails-days-0-5");
    expect(shape(seq)).toEqual([
      ["opener", 0],
      ["followup", 5],
    ]);
  });
  it("two-email custom cadence names its days", () => {
    expect(twoEmailSequence("opener", "followup", { days: [0, 3] }).name).toBe("2-emails-days-0-3");
    expect(twoEmailSequence("opener", "followup", { name: "slow", days: [0, 10] }).name).toBe(
      "slow",
    );
  });
  it("the arm is the directory the opener lives in", () => {
    expect(armOf("pilot/opener")).toBe("pilot");
    expect(armOf("followup")).toBeNull();
    const seq = threeEmailSequence("pilot/opener", "followup", "final_followup");
    expect(seq.arm).toBe("pilot");
    expect(seq.name).toBe("pilot-days-0-3-7");
    expect(twoEmailSequence("pilot/opener", "pilot/followup").name).toBe("pilot-days-0-5");
    expect(threeEmailSequence("opener", "followup", "final_followup").arm).toBeNull();
  });
  it("never sends from another arm", () => {
    expect(() => twoEmailSequence("pilot/opener", "value/followup")).toThrow(
      /opens in arm 'pilot' but sends from value/,
    );
    expect(() => twoEmailSequence("opener", "pilot/followup")).toThrow(
      /opens on a shared opener but sends from pilot/,
    );
  });
  it("opens on day zero", () => {
    expect(() => sequence("late", [sequenceStep("opener", 1)])).toThrow(/day 0/);
  });
  it("steps must move forward", () => {
    expect(() =>
      sequence("stuck", [sequenceStep("opener", 0), sequenceStep("followup", 0)]),
    ).toThrow(/later/);
  });
  it("refuses an empty sequence", () => {
    expect(() => sequence("empty", [])).toThrow(/step/);
  });
  it("refuses a bad step", () => {
    expect(() => sequenceStep("", 0)).toThrow(/template name/);
    expect(() => sequenceStep("opener", -1)).toThrow(/negative/);
  });
});
