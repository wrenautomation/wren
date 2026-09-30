import { describe, expect, it } from "vitest";
import { ago, cx, hostOf, initials, month, num } from "./format.js";

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
