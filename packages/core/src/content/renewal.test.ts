import { describe, expect, it } from "vitest";
import { renewalDelay } from "./renewal.js";

const DAY = 86_400_000;
const now = new Date("2026-09-23T00:00:00.000Z");

describe("renewalDelay", () => {
  it("sleeps until 14 days before the next lapse, within a day and a week", () => {
    // LinkedIn's token lapses 2026-11-21: look again in a week, not in 45 days.
    expect(renewalDelay("2026-11-21T23:37:30.000Z", now)).toBe(7 * DAY);
    expect(renewalDelay("2026-10-10T00:00:00.000Z", now)).toBe(3 * DAY);
    // Due now, or already lapsed (a failed renewal): tomorrow, never a busy loop.
    expect(renewalDelay("2026-09-30T00:00:00.000Z", now)).toBe(DAY);
    expect(renewalDelay(null, now)).toBe(7 * DAY);
  });
});
