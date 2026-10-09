import { describe, expect, it } from "vitest";
import { nextRunAt, periodOf, reportText } from "./store.js";
import { changeOf, shown } from "./tiles.js";

const TO = "America/Toronto";

describe("nextRunAt", () => {
  it("is the next Monday at 9:00 in the zone", () => {
    // Friday 2026-10-09 noon in Toronto (EDT, UTC-4).
    expect(nextRunAt("week", TO, new Date("2026-10-09T16:00:00Z")).toISOString()).toBe(
      "2026-10-12T13:00:00.000Z",
    );
  });
  it("on Monday before 9:00 is today; after, next week", () => {
    expect(nextRunAt("week", TO, new Date("2026-10-12T12:59:00Z")).toISOString()).toBe(
      "2026-10-12T13:00:00.000Z",
    );
    expect(nextRunAt("week", TO, new Date("2026-10-12T13:00:00Z")).toISOString()).toBe(
      "2026-10-19T13:00:00.000Z",
    );
  });
  it("monthly is the 1st at 9:00, across the DST change", () => {
    // Oct 1 is EDT (UTC-4); DST ends 2:00 on Nov 1, so its 9:00 is EST (UTC-5).
    expect(nextRunAt("month", TO, new Date("2026-09-09T16:00:00Z")).toISOString()).toBe(
      "2026-10-01T13:00:00.000Z",
    );
    expect(nextRunAt("month", TO, new Date("2026-10-09T16:00:00Z")).toISOString()).toBe(
      "2026-11-01T14:00:00.000Z",
    );
  });
});

describe("periodOf", () => {
  it("a closed week ends at the midnight that started Monday", () => {
    const p = periodOf("week", TO, new Date("2026-10-12T13:00:00Z"), true);
    expect(p.period).toBe(7);
    expect(p.to.toISOString()).toBe("2026-10-12T03:59:59.999Z");
    expect(p.from.toISOString()).toBe("2026-10-05T04:00:00.000Z");
  });
  it("a closed month is the whole month before", () => {
    const p = periodOf("month", TO, new Date("2026-11-01T14:00:00Z"), true);
    expect(p.from.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-11-01T03:59:59.999Z");
  });
  it("run now reads up to now", () => {
    const at = new Date("2026-10-09T16:00:00Z");
    expect(periodOf("month", TO, at, false).to).toEqual(at);
  });
});

describe("the mail", () => {
  it("says each number, its change and the link", () => {
    const m = reportText({
      report: { name: "Weekly numbers", zone: TO },
      client: "Acme Test",
      from: new Date("2026-10-05T04:00:00Z"),
      to: new Date("2026-10-12T03:59:59Z"),
      lines: [
        { tile: "visits", label: "Site visits", value: 1200, prior: 1000, currency: null },
        { tile: "spend", label: "Ad spend", value: 50, prior: 0, currency: "USD" },
      ],
      portal: "https://app.example.test/",
    });
    expect(m.subject).toBe("Weekly numbers, Oct 5 to Oct 11");
    expect(m.text).toContain("Site visits: 1,200 (+20% on the period before)");
    expect(m.text).toContain("Ad spend: $50 (new)");
    expect(m.text).toContain("https://app.example.test/marketing/reports");
  });
  it("changes and shown values", () => {
    expect(changeOf({ value: 5, prior: 5 })).toBe("same");
    expect(changeOf({ value: 0, prior: 0 })).toBeNull();
    expect(changeOf({ value: 3, prior: null })).toBeNull();
    expect(shown({ value: null, currency: null })).toBe("—");
  });
});
