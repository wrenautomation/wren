import { describe, expect, it } from "vitest";
import {
  answerOf,
  formatAudience,
  formatTrigger,
  parseAudience,
  parseChoices,
  parseTrigger,
} from "./surveys.js";

describe("survey words", () => {
  it("reads when, and says it back the same", () => {
    expect(parseTrigger("view on /agencies/ after 20s", "site")).toEqual({
      trigger: { on: "view", page: "/agencies", after: 20 },
    });
    expect(parseTrigger("", "site")).toEqual({ trigger: { on: "view" } });
    expect(parseTrigger("booked", "site")).toEqual({ trigger: { on: "booked" } });
    expect(parseTrigger("view after 30d", "portal")).toEqual({
      trigger: { on: "view", after: 30 },
    });
    expect(formatTrigger({ on: "view", page: "/agencies", after: 20 }, "site")).toBe(
      "view on /agencies after 20s",
    );
    expect(formatTrigger({ on: "view", after: 30 }, "portal")).toBe("view after 30d");
    for (const [t, s] of [
      ["soon", "site"],
      ["view after 20", "site"],
      ["exit", "portal"],
      ["view on agencies", "site"],
      ["view after 2s", "portal"],
    ] as const)
      expect(parseTrigger(t, s)).toHaveProperty("error");
  });

  it("reads who per surface; empty is everyone", () => {
    expect(parseAudience("channels email, search\nflag hero b", "site")).toEqual({
      audience: { channels: ["email", "search"], flag: { key: "hero", variant: "b" } },
    });
    expect(parseAudience("clients acme, beta", "portal")).toEqual({
      audience: { clients: ["acme", "beta"] },
    });
    expect(parseAudience("  ", "site")).toEqual({ audience: {} });
    expect(parseAudience("channels mail", "site")).toHaveProperty("error");
    expect(parseAudience("clients acme", "site")).toHaveProperty("error");
    expect(parseAudience("flag hero", "site")).toHaveProperty("error");
    expect(formatAudience({ channels: ["email"], flag: { key: "hero", variant: "b" } })).toBe(
      "channels email\nflag hero b",
    );
  });

  it("checks choices and answers against the kind", () => {
    expect(parseChoices("Yes\nNo, not yet", "choice")).toEqual({
      choices: ["Yes", "No", "not yet"],
    });
    expect(parseChoices("Yes", "choice")).toHaveProperty("error");
    expect(parseChoices("a, a", "choice")).toHaveProperty("error");
    expect(parseChoices("", "scale")).toEqual({ choices: [] });
    expect(parseChoices("1, 2", "scale")).toHaveProperty("error");
    expect(answerOf("choice", ["Yes", "No"], "Yes")).toBe("Yes");
    expect(answerOf("choice", ["Yes", "No"], "Maybe")).toBeNull();
    expect(answerOf("scale", [], 10)).toBe("10");
    expect(answerOf("scale", [], "11")).toBeNull();
    expect(answerOf("text", [], "  fast replies ")).toBe("fast replies");
    expect(answerOf("text", [], "")).toBeNull();
    expect(answerOf("text", [], "x".repeat(501))).toBeNull();
    expect(answerOf("text", [], { no: 1 })).toBeNull();
  });
});
