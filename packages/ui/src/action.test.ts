import { describe, expect, it } from "vitest";
import { type Action, applies, inputOf, valuesOf } from "./action.js";

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

describe("form actions", () => {
  const ADD: Action = {
    id: "add",
    label: "Add",
    handler: "console/addClient",
    form: [
      { field: "name", label: "Name" },
      { field: "id", label: "Short name", from: ({ name = "" }) => name.toLowerCase() },
    ],
  };
  it("fills a field from the ones before it until it's typed over", () => {
    const form = ADD.form ?? [];
    expect(valuesOf(form, { name: "Acme" })).toEqual({ name: "Acme", id: "acme" });
    expect(valuesOf(form, { name: "Acme", id: "ac" })).toEqual({ name: "Acme", id: "ac" });
    expect(valuesOf(form, {})).toEqual({ name: "", id: "" });
  });
  it("applies to no row, unless asked on each", () => {
    expect(applies(ADD, { id: "x" })).toBe(false);
    expect(applies(STOP, { id: "x" })).toBe(true);
    const SLIP: Action = { ...ADD, each: true, when: { state: ["now"] } };
    expect(applies(SLIP, { state: "now" })).toBe(true);
    expect(applies(SLIP, { state: "done" })).toBe(false);
  });
  it("leaves a file out of the typed values", () => {
    expect(valuesOf([{ field: "file", label: "File", type: "file" }], {})).toEqual({});
  });
});
