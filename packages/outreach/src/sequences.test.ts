import { describe, expect, it } from "vitest";
import { isOptOut } from "./replies.js";
import {
  CONNECT_NOTE,
  checkBody,
  firstName,
  REACH_SEQUENCES,
  render,
  sampleFields,
  slotsOf,
  stepKey,
  subjectKey,
} from "./sequences.js";

describe("slotsOf", () => {
  it("lists every step, reddit subjects and the invite note once", () => {
    const keys = slotsOf(REACH_SEQUENCES.values()).map((s) => s.key);
    const reddit = REACH_SEQUENCES.get("reddit-dm");
    const li = REACH_SEQUENCES.get("linkedin-connect");
    if (!reddit || !li) throw new Error("sequences missing");
    expect(keys).toContain(stepKey(reddit, 1));
    expect(keys).toContain(subjectKey(reddit, 1));
    expect(keys).toContain(stepKey(li, 2));
    expect(keys.filter((k) => k === CONNECT_NOTE)).toHaveLength(1);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("names each slot in words, never by its sequence's slug", () => {
    const purposes = slotsOf(REACH_SEQUENCES.values()).map((s) => s.purpose);
    expect(purposes).toContain("LinkedIn DM: first message, 1 day after they accept");
    expect(purposes).toContain("Reddit DM: message 2, 5 days after the last");
    for (const name of REACH_SEQUENCES.keys())
      expect(purposes.filter((p) => p.includes(name))).toEqual([]);
  });
});

describe("checkBody", () => {
  const note = slotsOf(REACH_SEQUENCES.values()).find((s) => s.key === CONNECT_NOTE);
  if (!note) throw new Error("no note slot");
  it("keeps a good body, trimmed", () => {
    expect(checkBody(note, "  hi {first_name|there}  ")).toBe("hi {first_name|there}");
  });
  it("refuses unknown fields and long notes", () => {
    expect(() => checkBody(note, "hi {email}")).toThrow(/cannot use/);
    expect(() => checkBody(note, "x".repeat(note.maxLength + 1))).toThrow(/at most/);
  });
  it("empty means empty", () => {
    expect(checkBody(note, "   ")).toBe("");
  });
});

describe("render", () => {
  it("fills fields and fallbacks, squeezes spaces", () => {
    const fields = { ...sampleFields("William"), first_name: null, company: "Acme" };
    expect(render("Hi {first_name|there},  saw {company} in {found_in}", fields)).toMatch(
      /^Hi there, saw Acme in /,
    );
  });
  it("throws on a missing field with no fallback", () => {
    expect(() => render("Hi {first_name}", { ...sampleFields("W"), first_name: null })).toThrow(
      /no value/,
    );
  });
});

describe("firstName", () => {
  it("takes a plausible first word only", () => {
    expect(firstName("Ada Lovelace")).toBe("Ada");
    expect(firstName("ACME Corp")).toBeNull();
    expect(firstName("")).toBeNull();
  });
});

describe("isOptOut", () => {
  it("hears stop", () => {
    expect(isOptOut("please stop messaging me")).toBe(true);
    expect(isOptOut("unsubscribe")).toBe(true);
    expect(isOptOut("sure, tell me more")).toBe(false);
  });
});
