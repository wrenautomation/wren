import { describe, expect, it } from "vitest";
import { ago, cx, hostOf, initials, money, month, num, soon } from "./format.js";

describe("money", () => {
  it("shows cents in a list and whole units in a tile", () => {
    expect(money(1250, "USD")).toBe("$1,250.00");
    expect(money(1250.5, "USD", true)).toBe("$1,251");
    expect(money(900, "EUR")).toBe("€900.00");
  });
  it("falls back to the code for a currency it can't read", () => {
    expect(money(1250, "nope")).toBe("nope 1,250.00");
  });
});

describe("num", () => {
  it("formats zero", () => {
    expect(num(0)).toBe("0");
  });

  it("keeps the minus sign on negative numbers", () => {
    expect(num(-1234567)).toBe("-1,234,567");
  });

  it("adds thousands separators to large numbers", () => {
    expect(num(1234567)).toBe("1,234,567");
  });

  it("does not add a separator under 1000", () => {
    expect(num(999)).toBe("999");
  });
});

describe("month", () => {
  it("returns empty string for null", () => {
    expect(month(null)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(month("")).toBe("");
  });

  it("formats a normal YYYY-MM-DD day", () => {
    expect(month("2025-03-14")).toBe("Mar 2025");
  });

  it("handles the December boundary (month index 12)", () => {
    expect(month("2025-12-25")).toBe("Dec 2025");
  });

  it("handles the January boundary (month index 1)", () => {
    expect(month("2025-01-01")).toBe("Jan 2025");
  });

  it("shows just the year when there's no month", () => {
    expect(month("2025")).toBe("2025");
  });

  it("shows just the year when the month is out of range", () => {
    expect(month("2025-13-01")).toBe("2025");
  });

  it("returns empty string for a string that isn't a date", () => {
    expect(month("not-a-date")).toBe("");
  });
});

describe("ago", () => {
  const T = (s: string) => new Date(s);

  it("returns 'never' for null", () => {
    expect(ago(null)).toBe("never");
  });

  it("returns 'never' for empty string", () => {
    expect(ago("", T("2025-06-01T00:00:00Z"))).toBe("never");
  });

  it("returns 'this month' for the same day", () => {
    expect(ago("2025-06-01", T("2025-06-01T00:00:00Z"))).toBe("this month");
  });

  it("returns 'this month' for a later day in the same calendar month", () => {
    expect(ago("2025-06-01", T("2025-06-30T00:00:00Z"))).toBe("this month");
  });

  it("counts 1 month after crossing one calendar-month boundary", () => {
    expect(ago("2025-05-31", T("2025-06-01T00:00:00Z"))).toBe("1 mo ago");
  });

  it("pluralizes months below the year boundary", () => {
    expect(ago("2025-01-01", T("2025-03-01T00:00:00Z"))).toBe("2 mo ago");
  });

  it("switches from months to a year at exactly 12 months", () => {
    expect(ago("2024-06-01", T("2025-06-01T00:00:00Z"))).toBe("1 yr ago");
  });

  it("stays singular just under 24 months", () => {
    expect(ago("2024-06-01", T("2026-05-01T00:00:00Z"))).toBe("1 yr ago"); // 23 months
  });

  it("pluralizes at exactly 24 months", () => {
    expect(ago("2024-06-01", T("2026-06-01T00:00:00Z"))).toBe("2 yrs ago");
  });

  it("ignores a time-of-day component beyond the date", () => {
    expect(ago("2025-06-01T23:59:59.999Z", T("2025-06-01T00:00:00Z"))).toBe("this month");
  });

  it("returns empty string for a day it can't read, not NaN", () => {
    expect(ago("not-a-date", T("2025-06-01T00:00:00Z"))).toBe("");
  });
});

describe("hostOf", () => {
  it("returns null for null", () => {
    expect(hostOf(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(hostOf("")).toBeNull();
  });

  it("returns null for a non-URL string", () => {
    expect(hostOf("not a url")).toBeNull();
  });

  it("returns null for a bare domain with no scheme", () => {
    expect(hostOf("acme.com")).toBeNull();
  });

  it("strips a leading www.", () => {
    expect(hostOf("https://www.acme.com/jobs")).toBe("acme.com");
  });

  it("leaves a host with no www. unchanged", () => {
    expect(hostOf("https://acme.com")).toBe("acme.com");
  });

  it("only strips one leading www.", () => {
    expect(hostOf("https://www.www.acme.com")).toBe("www.acme.com");
  });

  it("lowercases a mixed-case host", () => {
    expect(hostOf("https://WWW.ACME.COM")).toBe("acme.com");
  });

  it("works for non-http schemes", () => {
    expect(hostOf("ftp://ftp.acme.com")).toBe("ftp.acme.com");
  });
});

describe("initials", () => {
  it("takes the first letters of the first two words", () => {
    expect(initials("Sample recruiting firm")).toBe("SR");
  });

  it("handles a single word", () => {
    expect(initials("Acme")).toBe("A");
  });

  it("returns empty string for empty string", () => {
    expect(initials("")).toBe("");
  });

  it("returns empty string for whitespace only", () => {
    expect(initials("   ")).toBe("");
  });

  it("collapses extra internal and surrounding spaces", () => {
    expect(initials("  Acme   Corp  ")).toBe("AC");
  });

  it("uppercases lowercase names", () => {
    expect(initials("acme corp")).toBe("AC");
  });

  it("drops words past the second", () => {
    expect(initials("One Two Three")).toBe("OT");
  });
});

describe("cx", () => {
  it("returns empty string for no args", () => {
    expect(cx()).toBe("");
  });

  it("drops false, null and undefined", () => {
    expect(cx("a", false, null, undefined, "b")).toBe("a b");
  });

  it("returns empty string when everything is falsy", () => {
    expect(cx(false, null, undefined)).toBe("");
  });

  it("drops empty strings without leaving a double space", () => {
    expect(cx("a", "", "b")).toBe("a b");
  });
});

describe("soon", () => {
  // Local time on both sides, so these hold in any timezone. Wed Sep 30 2026, 10:00.
  const now = new Date(2026, 8, 30, 10, 0);
  const at = (y: number, m: number, d: number, h = 0, min = 0) =>
    new Date(y, m, d, h, min).toISOString();
  // Some ICU builds put a narrow no-break space before AM/PM.
  const said = (s: string | null) => s?.replace(/\s/g, " ") ?? null;

  it("later today is just the time", () => {
    expect(said(soon(at(2026, 8, 30, 20, 0), now))).toBe("8:00 PM");
  });

  it("a minute from now is just the time", () => {
    expect(said(soon(at(2026, 8, 30, 10, 1), now))).toBe("10:01 AM");
  });

  it("the last minute of today is still today", () => {
    expect(said(soon(at(2026, 8, 30, 23, 59), now))).toBe("11:59 PM");
  });

  it("tomorrow says tomorrow", () => {
    expect(said(soon(at(2026, 9, 1, 8, 0), now))).toBe("tomorrow 8:00 AM");
  });

  it("just past midnight is tomorrow, even minutes away", () => {
    const late = new Date(2026, 8, 30, 23, 58);
    expect(said(soon(at(2026, 9, 1, 0, 1), late))).toBe("tomorrow 12:01 AM");
  });

  it("2 days out is the weekday", () => {
    expect(said(soon(at(2026, 9, 2, 9, 30), now))).toBe("Fri 9:30 AM");
  });

  it("6 days out is still the weekday", () => {
    expect(said(soon(at(2026, 9, 6, 20, 0), now))).toBe("Tue 8:00 PM");
  });

  it("7 days out is month and day, no time", () => {
    expect(soon(at(2026, 9, 7, 8, 0), now)).toBe("Oct 7");
  });

  it("weeks out is month and day", () => {
    expect(soon(at(2026, 9, 30, 8, 0), now)).toBe("Oct 30");
  });

  it("next year drops the year", () => {
    expect(soon(at(2027, 0, 5, 8, 0), now)).toBe("Jan 5");
  });

  it("crosses a month boundary: Jan 31 to Feb 1 is tomorrow", () => {
    expect(said(soon(at(2026, 1, 1, 9, 0), new Date(2026, 0, 31, 22, 0)))).toBe("tomorrow 9:00 AM");
  });

  it("crosses a month boundary: Sep 30 to Oct 3 is the weekday", () => {
    expect(said(soon(at(2026, 9, 3, 9, 0), now))).toBe("Sat 9:00 AM");
  });

  it("crosses a year boundary: Dec 31 to Jan 1 is tomorrow", () => {
    expect(said(soon(at(2027, 0, 1, 7, 0), new Date(2026, 11, 31, 18, 0)))).toBe(
      "tomorrow 7:00 AM",
    );
  });

  it("counts calendar days across a daylight-saving change", () => {
    const sat = new Date(2026, 2, 7, 12, 0); // US clocks jump forward Sun Mar 8
    expect(said(soon(at(2026, 2, 9, 12, 0), sat))).toBe("Mon 12:00 PM");
    expect(said(soon(at(2026, 2, 13, 12, 0), sat))).toBe("Fri 12:00 PM");
    expect(soon(at(2026, 2, 14, 12, 0), sat)).toBe("Mar 14");
  });

  it("the past is null", () => {
    expect(soon(at(2026, 8, 30, 9, 0), now)).toBeNull();
    expect(soon(at(2025, 8, 30, 20, 0), now)).toBeNull();
  });

  it("exactly now is null", () => {
    expect(soon(now.toISOString(), now)).toBeNull();
  });

  it("a millisecond ago is null", () => {
    expect(soon(new Date(now.getTime() - 1).toISOString(), now)).toBeNull();
  });

  it("null is null", () => {
    expect(soon(null, now)).toBeNull();
  });

  it("empty string is null", () => {
    expect(soon("", now)).toBeNull();
  });

  it("garbage is null", () => {
    expect(soon("not-a-date", now)).toBeNull();
    expect(soon("2026-13-45", now)).toBeNull();
  });
});
