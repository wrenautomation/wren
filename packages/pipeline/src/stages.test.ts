import { describe, expect, it } from "vitest";
import { nextStage } from "./stages.js";

const stages = ["engaged", "talking", "call_booked", "signed"].map((key) => ({ key }));

describe("nextStage", () => {
  it("moves one stage forward", () => {
    expect(nextStage(stages, "engaged", "talking", "open")).toEqual({ to: "talking", skipped: [] });
  });
  it("lists the stages it skips", () => {
    expect(nextStage(stages, "engaged", "signed", "open")).toEqual({
      to: "signed",
      skipped: ["talking", "call_booked"],
    });
  });
  it("refuses a move back", () => {
    expect(nextStage(stages, "call_booked", "engaged", "open")).toBeNull();
  });
  it("refuses the same stage", () => {
    expect(nextStage(stages, "talking", "talking", "open")).toBeNull();
  });
  it("refuses an unknown stage on either side", () => {
    expect(nextStage(stages, "engaged", "nowhere", "open")).toBeNull();
    expect(nextStage(stages, "nowhere", "signed", "open")).toBeNull();
  });
  it("refuses a closed journey", () => {
    expect(nextStage(stages, "engaged", "signed", "done")).toBeNull();
    expect(nextStage(stages, "engaged", "signed", "dropped")).toBeNull();
  });
});
