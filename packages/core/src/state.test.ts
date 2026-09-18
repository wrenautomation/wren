import { describe, expect, it } from "vitest";
import { LEAD_STATUSES, type LeadStatus } from "./schema.js";
import { IllegalTransition, LEAD_TRANSITIONS, sourcesOf, transition } from "./state.js";

const lead = (a: LeadStatus, b: LeadStatus) => transition("lead", LEAD_TRANSITIONS, a, b);

describe("lead transitions", () => {
  it("has a row for every state and only legal pairs pass", () => {
    expect(Object.keys(LEAD_TRANSITIONS).sort()).toEqual([...LEAD_STATUSES].sort());
    for (const a of LEAD_STATUSES) {
      for (const b of LEAD_STATUSES) {
        if (LEAD_TRANSITIONS[a].has(b)) expect(lead(a, b)).toBe(b);
        else expect(() => lead(a, b)).toThrow(IllegalTransition);
      }
    }
  });
  it("suppression can be lifted, only to imported", () => {
    expect(lead("suppressed", "imported")).toBe("imported");
    expect([...LEAD_TRANSITIONS.suppressed]).toEqual(["imported"]);
  });
  it("verified can be suppressed, re-confirmed or found dead, never demoted", () => {
    lead("verified", "suppressed");
    lead("verified", "verified");
    lead("verified", "undeliverable");
    expect(() => lead("verified", "imported")).toThrow(IllegalTransition);
  });
  it("only imported and verified produce verified or undeliverable", () => {
    expect(sourcesOf(LEAD_TRANSITIONS, LEAD_STATUSES, "verified")).toEqual([
      "imported",
      "verified",
    ]);
    expect(sourcesOf(LEAD_TRANSITIONS, LEAD_STATUSES, "undeliverable")).toEqual([
      "imported",
      "verified",
    ]);
  });
  it("undeliverable has one reserved exit", () => {
    expect([...LEAD_TRANSITIONS.undeliverable]).toEqual(["imported"]);
    lead("undeliverable", "imported");
  });
  it("names machine and states in the error", () => {
    expect(() => lead("undeliverable", "verified")).toThrow(
      /lead: illegal transition undeliverable -> verified/,
    );
  });
});
