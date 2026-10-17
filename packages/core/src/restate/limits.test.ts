import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import { CallTimeout, LIMITS, limitStage, limitsWith } from "./limits.js";
import { failsThePass } from "./loop.js";

describe("CallTimeout", () => {
  it("is terminal, says the call and its limit, and carries the note", () => {
    const e = new CallTimeout("Content/publish", 900_000, "note text");
    expect(e).toBeInstanceOf(restate.TerminalError);
    expect(e.message).toBe("Content/publish gave no answer in 900 s; note text");
  });
});

describe("limits", () => {
  it("a loop's stage, and its own limits over the usual", () => {
    expect(limitStage("ContentMetrics", "default")).toBe("loop.content-metrics/default");
    expect(limitsWith({ read: 1_000 })).toEqual({ ...LIMITS, read: 1_000 });
  });
});

describe("failsThePass", () => {
  it("terminal and plain errors fail the pass; a cancel and the SDK's signals go through", () => {
    expect(failsThePass(new restate.TerminalError("[429] cap used"))).toBe(true);
    expect(failsThePass(new CallTimeout("Desk/call", 1_000))).toBe(true);
    expect(failsThePass(new Error("replayed"))).toBe(true);
    expect(failsThePass(new restate.CancelledError())).toBe(false);
    expect(failsThePass(new restate.RestateError("suspended", { errorCode: 599 }))).toBe(false);
  });
});
