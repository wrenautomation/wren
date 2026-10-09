import { describe, expect, it } from "vitest";
import { codeStep, runCode } from "./code-step.js";
import { codeProblems, logicOf } from "./logic.js";

const e = { subject: "lead:1", kind: "lead" as const, data: { name: "Ada Lovelace" } };
const now = new Date("2026-10-09T12:00:00Z");

describe("code step", () => {
  it("merges the returned fields and leaves by out", async () => {
    const got = await codeStep(
      'const [first] = event.data.name.split(" "); return { first, now };',
      e,
      now,
    );
    expect(got).toEqual([
      {
        port: "out",
        event: { ...e, data: { name: "Ada Lovelace", first: "Ada", now: now.toISOString() } },
      },
    ]);
  });

  it("leaves by skip on null, false or nothing", async () => {
    for (const code of ["return null", "return false", "const x = 1;"])
      expect((await codeStep(code, e, now))[0]?.port).toBe("skip");
  });

  it("can't change the event it was handed", async () => {
    const got = await codeStep("event.data.name = 'x'; return {}", e, now);
    expect(got[0]?.event.data.name).toBe("Ada Lovelace");
  });

  it("has no fetch, timers or require", async () => {
    for (const code of ["fetch('https://example.com')", "setTimeout(() => 1)", "require('fs')"])
      await expect(runCode(code, e, now)).rejects.toThrow(/not defined/);
  });

  it("stops a loop at a second", async () => {
    await expect(runCode("while (true) {}", e, now)).rejects.toThrow(/ran past/);
  });

  it("refuses a result that isn't fields", async () => {
    await expect(runCode("return [1]", e, now)).rejects.toThrow(/object of fields/);
    await expect(runCode("throw new Error('nope')", e, now)).rejects.toThrow("Error: nope");
  });
});

describe("code node", () => {
  it("checks the code parses", () => {
    expect(codeProblems("")).toEqual(["Code needs a few lines"]);
    expect(codeProblems("return {")[0]).toMatch(/doesn't parse/);
    expect(codeProblems("return { a: 1 }")).toEqual([]);
    expect(codeProblems("x".repeat(10_001))[0]).toMatch(/over 10,000/);
  });

  it("says its first line", () => {
    const l = logicOf("logic.code");
    expect(l?.says({ code: "\n// split the name\nreturn {}" })).toBe("// split the name");
    expect(l?.says({})).toBe("Write the code");
  });
});
