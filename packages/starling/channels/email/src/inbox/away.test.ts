/** Out-of-office return dates, from the shapes real auto-replies take. */
import { describe, expect, it } from "vitest";
import { PlainDate } from "../send/dates.js";
import { awayUntil } from "./away.js";

const DEC_20 = new PlainDate(2026, 12, 20); // a Sunday
const at = (text: string, received = DEC_20) => awayUntil(text, received)?.toString() ?? null;

describe("awayUntil", () => {
  it("reads month names, with or without a year, either order", () => {
    expect(at("I'm out of the office and will be back on Monday, January 4th.")).toBe("2027-01-04");
    expect(at("Out of office until Jan. 4, 2027. For urgent matters call Sam.")).toBe("2027-01-04");
    expect(at("I am on leave, returning 4th of January.")).toBe("2027-01-04");
    expect(at("Back in the office 28 December")).toBe("2026-12-28");
  });
  it("reads numeric and ISO dates, month first", () => {
    expect(at("I will return on 1/4/2027 and reply then.")).toBe("2027-01-04");
    expect(at("Away until 1/4/27")).toBe("2027-01-04");
    expect(at("Out until 12/28")).toBe("2026-12-28");
    expect(at("On vacation, back 2027-01-04")).toBe("2027-01-04");
  });
  it("takes the latest date of a range", () => {
    expect(at("I am away from Dec 22 to Jan 4 with limited access to email.")).toBe("2027-01-04");
    expect(at("Our office is closed December 24 - January 1. Back January 2.")).toBe("2027-01-02");
  });
  it("reads a weekday or tomorrow as the next one", () => {
    expect(at("Travelling this week, back Wednesday.")).toBe("2026-12-23");
    expect(at("Out today, back tomorrow.")).toBe("2026-12-21");
  });
  it("a date without a year rolls to next year once passed", () => {
    expect(at("Back January 4", new PlainDate(2026, 12, 30))).toBe("2027-01-04");
  });
  it("ignores dates with no away word near them", () => {
    expect(at("Thanks for your email. Join our webinar on January 7.")).toBeNull();
    expect(at("Thank you for reaching out. I'll reply soon.")).toBeNull();
  });
  it("ignores stale and far-off dates", () => {
    // A forgotten auto-reply from last summer, and a long leave past the cap.
    expect(at("Out of office until 2026-08-15.")).toBeNull();
    expect(at("On parental leave until June 1, 2027.")).toBeNull();
  });
  it("ignores what is not a day", () => {
    expect(at("Out until 2/30, available 24/7 by phone.")).toBeNull();
    expect(at("Back soon, see https://example.com/12/5 for hours")).toBeNull();
  });
});
