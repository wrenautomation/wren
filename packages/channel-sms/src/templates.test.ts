import { describe, expect, it } from "vitest";
import { checkSequence, firstName, render, segments } from "./templates.js";

const fields = { first_name: "Dana", company: "Acme Studio", sender: "William" };

describe("render", () => {
  it("fills fields and falls back when empty", () => {
    expect(render("hi {first_name|there}, {sender} here re {company}", fields)).toBe(
      "hi Dana, William here re Acme Studio",
    );
    expect(render("hi {first_name|there}", { ...fields, first_name: null })).toBe("hi there");
  });
  it("throws on an empty field with no fallback", () => {
    expect(() => render("{company}", { ...fields, company: " " })).toThrow(/no value/);
  });
});

describe("checkSequence", () => {
  const ok = { name: "s", steps: [{ step: 1, afterDays: 0, body: "hi. reply STOP to opt out" }] };
  it("accepts a good one", () => expect(checkSequence(ok)).toBe(ok));
  it("needs STOP in the opener", () => {
    expect(() =>
      checkSequence({ name: "s", steps: [{ step: 1, afterDays: 0, body: "hi" }] }),
    ).toThrow(/stop/);
  });
  it("rejects unknown fields and bad order", () => {
    expect(() =>
      checkSequence({ name: "s", steps: [{ step: 1, afterDays: 0, body: "{nick} STOP" }] }),
    ).toThrow(/unknown field/);
    expect(() =>
      checkSequence({
        name: "s",
        steps: [ok.steps[0] as never, { step: 3, afterDays: 2, body: "x" }],
      }),
    ).toThrow(/order/);
  });
});

describe("segments", () => {
  it("counts GSM-7 and UCS-2 parts", () => {
    expect(segments("a".repeat(160))).toEqual({ encoding: "GSM-7", units: 160, parts: 1 });
    expect(segments("a".repeat(161)).parts).toBe(2);
    expect(segments("[".repeat(80)).units).toBe(160);
    expect(segments("hi 👋").encoding).toBe("UCS-2");
    expect(segments("’".repeat(71)).parts).toBe(2);
  });
});

describe("firstName", () => {
  it("takes a first word that reads as a name", () => {
    expect(firstName("dana smith")).toBe("Dana");
    expect(firstName("J. Smith")).toBeNull();
    expect(firstName(null)).toBeNull();
  });
});
