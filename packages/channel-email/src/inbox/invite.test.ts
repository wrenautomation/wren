import { describe, expect, it } from "vitest";
import { buildPrompt, ground, type InviteState, localStamp } from "./invite.js";

const ET = "America/New_York";
// Monday 2026-10-05, 9am ET.
const NOW = new Date(Date.UTC(2026, 9, 5, 13));
const TUE_10 = new Date(Date.UTC(2026, 9, 6, 14));
const WED_2 = new Date(Date.UTC(2026, 9, 7, 18));
const THU_1_PT = new Date(Date.UTC(2026, 9, 8, 20));

const state = (reply: string): InviteState => ({
  reply,
  offered: [TUE_10, WED_2],
  zone: ET,
  now: NOW,
});
const OPEN = [TUE_10, WED_2, THU_1_PT];

describe("ground", () => {
  it("books an offered time they took", () => {
    const verdict = ground(
      state("Wednesday works for me."),
      { pick: "offered", start: "2026-10-07T14:00", evidence: "Wednesday works", confidence: 0.9 },
      OPEN,
    );
    expect(verdict).toEqual({ ok: true, start: WED_2, timeZone: ET });
  });

  it("books their own time in the zone they named", () => {
    const verdict = ground(
      state("Can't do those. Thursday 1pm PT?"),
      {
        pick: "own",
        start: "2026-10-08T13:00",
        time_zone: "America/Los_Angeles",
        evidence: "Thursday 1pm PT",
        confidence: 0.8,
      },
      OPEN,
    );
    expect(verdict).toEqual({ ok: true, start: THU_1_PT, timeZone: "America/Los_Angeles" });
  });

  it("hands over a quote that is not theirs, low confidence, or no time", () => {
    const reply = state("Sure, send it over.");
    expect(
      ground(
        reply,
        { pick: "offered", start: "2026-10-07T14:00", evidence: "Wednesday", confidence: 0.9 },
        OPEN,
      ).ok,
    ).toBe(false);
    expect(
      ground(
        state("Wednesday works"),
        {
          pick: "offered",
          start: "2026-10-07T14:00",
          evidence: "Wednesday works",
          confidence: 0.4,
        },
        OPEN,
      ).ok,
    ).toBe(false);
    expect(ground(reply, { pick: "none", evidence: "Sure", confidence: 0.9 }, OPEN)).toEqual({
      ok: false,
      reason: "no time in the reply",
    });
    expect(ground(reply, null, OPEN).ok).toBe(false);
  });

  it("refuses an 'offered' pick we never offered, and a time no longer open", () => {
    const reply = state("Tuesday at 3 works");
    expect(
      ground(
        reply,
        {
          pick: "offered",
          start: "2026-10-06T15:00",
          evidence: "Tuesday at 3 works",
          confidence: 0.9,
        },
        OPEN,
      ),
    ).toEqual({ ok: false, reason: "the picked time is not one we offered" });
    expect(
      ground(
        state("Tuesday works"),
        { pick: "offered", start: "2026-10-06T10:00", evidence: "Tuesday works", confidence: 0.9 },
        [WED_2],
      ),
    ).toEqual({ ok: false, reason: "Tuesday at 10am ET is not open on the calendar" });
  });
});

describe("buildPrompt", () => {
  it("lists the offered times as the stamps a pick must echo", () => {
    const prompt = buildPrompt(state("Wednesday works"));
    expect(prompt).toContain(`- Tuesday at 10am ET = ${localStamp(TUE_10, ET)}`);
    expect(prompt).toContain("- Wednesday at 2pm ET = 2026-10-07T14:00");
    expect(prompt).toContain("Today is Monday 2026-10-05");
  });
});
