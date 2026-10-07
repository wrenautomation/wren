import { describe, expect, it } from "vitest";
import { calendarSettingsSchema, parseHours, rulesOf } from "./rules.js";
import { dayOn, isOpen, openHours, openSlots } from "./slots.js";

const iso = (ds: Date[]) => ds.map((d) => d.toISOString());
const TORONTO = rulesOf({});
const none = { busy: [], calls: [] };

describe("parseHours", () => {
  it("reads stretches, sorted, and blank as closed", () => {
    expect(parseHours("13:00-17:00, 9:30-12:00")).toEqual([
      { from: 570, to: 720 },
      { from: 780, to: 1020 },
    ]);
    expect(parseHours("")).toEqual([]);
    expect(parseHours("00:00-24:00")).toEqual([{ from: 0, to: 1440 }]);
  });

  it("refuses bad clocks, backwards stretches and overlaps", () => {
    for (const bad of ["10-12", "10:00-09:00", "10:00-12:00, 11:00-13:00", "25:00-26:00", "x"])
      expect(parseHours(bad), bad).toBeNull();
  });

  it("the settings take {} and refuse a zone that isn't one", () => {
    expect(calendarSettingsSchema.safeParse({}).success).toBe(true);
    expect(calendarSettingsSchema.safeParse({ zone: "Mars/Olympus" }).success).toBe(false);
    expect(calendarSettingsSchema.safeParse({ hours: { mon: "nine to five" } }).success).toBe(
      false,
    );
  });
});

describe("openSlots", () => {
  it("offers Mon to Fri, 10 to 5 Toronto, every 30 minutes, after the notice", () => {
    // Tue 2026-10-06 09:00 EDT (13:00Z); 2h notice → 11:00 is the first.
    const now = new Date("2026-10-06T13:00:00Z");
    const slots = openSlots(TORONTO, {
      ...none,
      now,
      from: now,
      to: new Date("2026-10-07T04:00:00Z"),
    });
    expect(slots[0]?.toISOString()).toBe("2026-10-06T15:00:00.000Z");
    expect(slots.at(-1)?.toISOString()).toBe("2026-10-06T20:30:00.000Z"); // 16:30 EDT, ends 17:00
    expect(slots).toHaveLength(12);
  });

  it("skips the weekend", () => {
    const now = new Date("2026-10-09T22:00:00Z"); // Fri evening
    const slots = openSlots(TORONTO, {
      ...none,
      now,
      from: now,
      to: new Date("2026-10-13T04:00:00Z"),
    });
    expect(new Set(slots.map((s) => dayOn("America/Toronto", s)))).toEqual(new Set(["2026-10-12"]));
  });

  it("keeps 10:00 local across fall back: 14:00Z before, 15:00Z after", () => {
    // DST ends in Toronto on Sun 2026-11-01.
    const now = new Date("2026-10-29T12:00:00Z");
    const slots = openSlots(TORONTO, {
      ...none,
      now,
      from: now,
      to: new Date("2026-11-04T04:00:00Z"),
    });
    const firsts = new Map<string, string>();
    for (const s of slots) {
      const d = dayOn("America/Toronto", s);
      if (!firsts.has(d)) firsts.set(d, s.toISOString());
    }
    expect(firsts.get("2026-10-30")).toBe("2026-10-30T14:00:00.000Z");
    expect(firsts.get("2026-11-02")).toBe("2026-11-02T15:00:00.000Z");
  });

  it("never offers a wall time that spring forward skips, and offers fall back's once", () => {
    const night = rulesOf({ hours: { sun: "01:00-04:00" }, notice: 0, buffer: 0 });
    // 2026-03-08: 02:00 to 03:00 doesn't happen in Toronto.
    const spring = openSlots(night, {
      ...none,
      now: new Date("2026-03-07T12:00:00Z"),
      from: new Date("2026-03-08T00:00:00Z"),
      to: new Date("2026-03-09T00:00:00Z"),
    });
    expect(iso(spring)).toEqual([
      "2026-03-08T06:00:00.000Z", // 01:00 EST
      "2026-03-08T06:30:00.000Z", // 01:30 EST
      "2026-03-08T07:00:00.000Z", // 03:00 EDT
      "2026-03-08T07:30:00.000Z", // 03:30 EDT
    ]);
    // 2026-11-01: 01:00 to 02:00 happens twice; each start once, on its first reading.
    const fall = openSlots(night, {
      ...none,
      now: new Date("2026-10-31T12:00:00Z"),
      from: new Date("2026-11-01T00:00:00Z"),
      to: new Date("2026-11-02T00:00:00Z"),
    });
    expect(iso(fall)).toEqual([
      "2026-11-01T05:00:00.000Z", // 01:00 EDT
      "2026-11-01T05:30:00.000Z", // 01:30 EDT
      "2026-11-01T07:00:00.000Z", // 02:00 EST
      "2026-11-01T07:30:00.000Z",
      "2026-11-01T08:00:00.000Z",
      "2026-11-01T08:30:00.000Z", // 03:30 EST, ends 04:00
    ]);
  });

  it("reads hours on the owner's clock in a half-hour zone", () => {
    const kolkata = rulesOf({ zone: "Asia/Kolkata", notice: 0, hours: { mon: "09:00-10:00" } });
    const slots = openSlots(kolkata, {
      ...none,
      now: new Date("2026-10-04T00:00:00Z"),
      from: new Date("2026-10-04T00:00:00Z"),
      to: new Date("2026-10-06T00:00:00Z"),
    });
    expect(iso(slots)).toEqual(["2026-10-05T03:30:00.000Z", "2026-10-05T04:00:00.000Z"]);
  });

  it("keeps the buffer clear of busy times and our calls, and stops a day at its cap", () => {
    const now = new Date("2026-10-05T12:00:00Z");
    const rules = rulesOf({ notice: 0, buffer: 15, perDay: 3 });
    const at = (h: string) => new Date(`2026-10-06T${h}:00.000Z`);
    const busy = [{ start: at("15:00"), end: at("16:00") }]; // 11:00 to 12:00 EDT
    const day = { now, from: at("14:00"), to: at("21:00") };
    const free = openSlots(rules, { ...day, busy, calls: [] });
    // 10:30 would end at 11:00, inside 11:00's buffer; 12:00 starts inside the busy end's buffer.
    expect(iso(free).slice(0, 3)).toEqual([
      "2026-10-06T14:00:00.000Z",
      "2026-10-06T16:30:00.000Z",
      "2026-10-06T17:00:00.000Z",
    ]);
    const calls = [
      { start: at("17:00"), end: at("17:30") },
      { start: at("18:00"), end: at("18:30") },
    ];
    expect(openSlots(rules, { ...day, busy, calls }).length).toBeGreaterThan(0);
    calls.push({ start: at("19:00"), end: at("19:30") });
    expect(openSlots(rules, { ...day, busy, calls })).toEqual([]);
  });

  it("books no further out than its days", () => {
    const rules = rulesOf({ days: 2, notice: 0 });
    const now = new Date("2026-10-05T12:00:00Z"); // Mon
    const slots = openSlots(rules, {
      ...none,
      now,
      from: now,
      to: new Date("2026-10-20T00:00:00Z"),
    });
    expect(new Set(slots.map((s) => dayOn("America/Toronto", s)))).toEqual(
      new Set(["2026-10-05", "2026-10-06", "2026-10-07"]),
    );
  });

  it("isOpen agrees with the list", () => {
    const now = new Date("2026-10-06T13:00:00Z");
    expect(isOpen(TORONTO, new Date("2026-10-06T15:00:00Z"), { now, ...none })).toBe(true);
    expect(isOpen(TORONTO, new Date("2026-10-06T15:10:00Z"), { now, ...none })).toBe(false);
    expect(isOpen(TORONTO, new Date("2026-10-06T14:00:00Z"), { now, ...none })).toBe(false); // notice
  });
});

describe("openHours", () => {
  const spans = (from: string, to: string, rules = TORONTO) =>
    openHours(rules, new Date(from), new Date(to)).map(
      (s) => `${s.start.toISOString()} ${s.end.toISOString()}`,
    );

  it("gives each weekday's hours as instants, none on the weekend", () => {
    // Fri 2026-10-09 to Mon 2026-10-12, Toronto days.
    expect(spans("2026-10-09T04:00:00Z", "2026-10-13T04:00:00Z")).toEqual([
      "2026-10-09T14:00:00.000Z 2026-10-09T21:00:00.000Z",
      "2026-10-12T14:00:00.000Z 2026-10-12T21:00:00.000Z",
    ]);
  });

  it("keeps 10 to 5 on the owner's clock across fall back", () => {
    // Fri 2026-10-30 (EDT) and Mon 2026-11-02 (EST).
    expect(spans("2026-10-30T04:00:00Z", "2026-11-03T05:00:00Z")).toEqual([
      "2026-10-30T14:00:00.000Z 2026-10-30T21:00:00.000Z",
      "2026-11-02T15:00:00.000Z 2026-11-02T22:00:00.000Z",
    ]);
  });

  it("clips to the range and ends 24:00 at the next midnight", () => {
    const allDay = rulesOf({ zone: "UTC", hours: { sat: "20:00-24:00" } });
    expect(spans("2026-10-10T21:00:00Z", "2026-10-11T12:00:00Z", allDay)).toEqual([
      "2026-10-10T21:00:00.000Z 2026-10-11T00:00:00.000Z",
    ]);
    expect(spans("2026-10-09T15:00:00Z", "2026-10-09T16:00:00Z")).toEqual([
      "2026-10-09T15:00:00.000Z 2026-10-09T16:00:00.000Z",
    ]);
  });
});
