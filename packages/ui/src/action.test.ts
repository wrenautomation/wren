import { describe, expect, it } from "vitest";
import { type Action, inputOf } from "./action.js";

const PAUSE: Action = {
  id: "pause",
  label: "Pause",
  handler: "email/pause",
  ask: { field: "reason", label: "Why?" },
};
const STOP: Action = { id: "stop", label: "Stop", handler: "console/stopLoop" };

describe("inputOf", () => {
  it("sends the asked text only when it changed", () => {
    const APPROVE: Action = { ...PAUSE, ask: { field: "body", label: "Reply" } };
    expect(inputOf(PAUSE, { target: "a@x.test" }, "  bounced  ")).toEqual({
      target: "a@x.test",
      reason: "bounced",
    });
    expect(inputOf(PAUSE, { target: "a@x.test" }, " ")).toEqual({ target: "a@x.test" });
    expect(inputOf(APPROVE, { id: 4, body: "Tuesday works." }, "Tuesday works.\n")).toEqual({
      id: 4,
    });
    expect(inputOf(APPROVE, { id: 4, body: "Tuesday works." }, "Wednesday?")).toEqual({
      id: 4,
      body: "Wednesday?",
    });
    expect(inputOf(STOP, { key: "k" }, "")).toEqual({ key: "k" });
  });
});
