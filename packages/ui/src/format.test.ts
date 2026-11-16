import { describe, expect, it } from "vitest";
import {
  ago,
  cx,
  duration,
  ellipsize,
  hostOf,
  initials,
  linkLabel,
  money,
  month,
  num,
  soon,
  waited,
} from "./format.js";

describe("format", () => {
  it("money: cents in a list, whole units in a tile, the code for an unknown currency", () => {
    expect(money(1250, "USD")).toBe("$1,250.00");
    expect(money(1250.5, "USD", true)).toBe("$1,251");
    expect(money(900, "EUR")).toBe("€900.00");
    expect(money(1250, "nope")).toBe("nope 1,250.00");
  });

  it("duration and waited: the way people say them", () => {
    expect(
      [0, 0.2794, 3.977, 9.97, 38, 60, 125, 3600, 3840, 86_400, 266_400].map(duration),
    ).toEqual(["0ms", "279ms", "4.0s", "10s", "38s", "1m", "2m 5s", "1h", "1h 4m", "1d", "3d 2h"]);
    expect([0.33, 0.001, 1, 6, 30, 47.4, 47.6, 50, 100].map(waited)).toEqual([
      "20 minutes",
      "1 minute",
      "1 hour",
      "6 hours",
      "30 hours",
      "47 hours",
      "2 days",
      "2 days",
      "4 days",
    ]);
  });

  it("num: separators from 1000, the minus kept", () => {
    expect([0, 999, 1234567, -1234567].map(num)).toEqual(["0", "999", "1,234,567", "-1,234,567"]);
  });

  it("month: year alone past a bad month; empty for no date", () => {
    const cases: [string | null, string][] = [
      [null, ""],
      ["", ""],
      ["not-a-date", ""],
      ["2025-03-14", "Mar 2025"],
      ["2025-01-01", "Jan 2025"],
      ["2025-12-25", "Dec 2025"],
      ["2025", "2025"],
      ["2025-13-01", "2025"],
    ];
    expect(cases.map(([d]) => month(d))).toEqual(cases.map(([, w]) => w));
  });

  it("ago: calendar months, then years at 12 and 24", () => {
    const now = new Date("2025-06-01T00:00:00Z");
    expect(ago(null)).toBe("never");
    expect(ago("", now)).toBe("never");
    expect(ago("not-a-date", now)).toBe("");
    expect(ago("2025-06-01", now)).toBe("this month");
    expect(ago("2025-06-01", new Date("2025-06-30T00:00:00Z"))).toBe("this month");
    expect(ago("2025-06-01T23:59:59.999Z", now)).toBe("this month");
    expect(ago("2025-05-31", now)).toBe("1 mo ago");
    expect(ago("2025-01-01", new Date("2025-03-01T00:00:00Z"))).toBe("2 mo ago");
    expect(ago("2024-06-01", now)).toBe("1 yr ago");
    expect(ago("2024-06-01", new Date("2026-05-01T00:00:00Z"))).toBe("1 yr ago");
    expect(ago("2024-06-01", new Date("2026-06-01T00:00:00Z"))).toBe("2 yrs ago");
  });

  it("hostOf: lowercase, one www. off; null with no scheme", () => {
    const cases: [string | null, string | null][] = [
      [null, null],
      ["", null],
      ["not a url", null],
      ["acme.com", null],
      ["https://www.acme.com/jobs", "acme.com"],
      ["https://acme.com", "acme.com"],
      ["https://www.www.acme.com", "www.acme.com"],
      ["https://WWW.ACME.COM", "acme.com"],
      ["ftp://ftp.acme.com", "ftp.acme.com"],
    ];
    expect(cases.map(([u]) => hostOf(u))).toEqual(cases.map(([, w]) => w));
  });

  it("initials: the first two words, uppercase, spaces collapsed", () => {
    expect(
      [
        "Sample recruiting firm",
        "Acme",
        "",
        "   ",
        "  Acme   Corp  ",
        "acme corp",
        "One Two Three",
      ].map(initials),
    ).toEqual(["SR", "A", "", "", "AC", "AC", "OT"]);
  });

  it("cx: drops falsy parts with no double space", () => {
    expect(cx()).toBe("");
    expect(cx(false, null, undefined)).toBe("");
    expect(cx("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("ellipsize: whole characters, so an emoji is never split", () => {
    expect(ellipsize("Visits", 20)).toBe("Visits");
    expect(ellipsize("A label that keeps going well past the width", 20)).toBe(
      "A label that keeps …",
    );
    expect(ellipsize("🚀🔥👩🏽‍💻abc", 3)).toBe("🚀🔥…");
  });
});

describe("soon", () => {
  // Local time on both sides, so these hold in any timezone. Wed Sep 30 2026, 10:00.
  const now = new Date(2026, 8, 30, 10, 0);
  const at = (y: number, m: number, d: number, h = 0, min = 0) =>
    new Date(y, m, d, h, min).toISOString();
  // Some ICU builds put a narrow no-break space before AM/PM.
  const said = (s: string | null) => s?.replace(/\s/g, " ") ?? null;

  it("today is the time; tomorrow says so; to 6 days the weekday; then month and day", () => {
    expect(said(soon(at(2026, 8, 30, 10, 1), now))).toBe("10:01 AM");
    expect(said(soon(at(2026, 8, 30, 23, 59), now))).toBe("11:59 PM");
    expect(said(soon(at(2026, 9, 1, 8, 0), now))).toBe("tomorrow 8:00 AM");
    expect(said(soon(at(2026, 9, 1, 0, 1), new Date(2026, 8, 30, 23, 58)))).toBe(
      "tomorrow 12:01 AM",
    );
    expect(said(soon(at(2026, 9, 3, 9, 0), now))).toBe("Sat 9:00 AM");
    expect(said(soon(at(2026, 9, 6, 20, 0), now))).toBe("Tue 8:00 PM");
    expect(soon(at(2026, 9, 7, 8, 0), now)).toBe("Oct 7");
    expect(soon(at(2027, 0, 5, 8, 0), now)).toBe("Jan 5");
  });

  it("crosses month, year and daylight-saving changes by calendar day", () => {
    expect(said(soon(at(2026, 1, 1, 9, 0), new Date(2026, 0, 31, 22, 0)))).toBe("tomorrow 9:00 AM");
    expect(said(soon(at(2027, 0, 1, 7, 0), new Date(2026, 11, 31, 18, 0)))).toBe(
      "tomorrow 7:00 AM",
    );
    const sat = new Date(2026, 2, 7, 12, 0); // US clocks jump forward Sun Mar 8
    expect(said(soon(at(2026, 2, 9, 12, 0), sat))).toBe("Mon 12:00 PM");
    expect(said(soon(at(2026, 2, 13, 12, 0), sat))).toBe("Fri 12:00 PM");
    expect(soon(at(2026, 2, 14, 12, 0), sat)).toBe("Mar 14");
  });

  it("the past, now, and no date are null", () => {
    for (const d of [
      at(2026, 8, 30, 9, 0),
      at(2025, 8, 30, 20, 0),
      now.toISOString(),
      new Date(now.getTime() - 1).toISOString(),
      null,
      "",
      "not-a-date",
      "2026-13-45",
    ])
      expect(soon(d, now), String(d)).toBeNull();
  });
});

describe("linkLabel", () => {
  it.each([
    ["/inbox/replies/12", "Link", "Open"],
    ["tel:+15555550100", "Phone", "Call"],
    ["https://www.linkedin.com/in/jane-doe-4a1b2c", "Profile", "Jane Doe"],
    ["linkedin.com/company/acme-co", "Company", "Acme Co"],
    ["https://www.linkedin.com/feed/update/urn:li:activity:1", "Link", "Open in LinkedIn"],
    ["https://x.com/acme", "Profile", "@acme"],
    ["https://www.youtube.com/@acme", "Channel", "@acme"],
    ["https://wise.com/pay/r/abc", "In Wise", "Open"],
    ["https://www.acme.example/jobs", "Site", "acme.example"],
  ])("%s reads %s", (href, label, want) => expect(linkLabel(href, label)).toBe(want));
});
