import { describe, expect, it } from "vitest";
import { type Pace, sendSlots } from "./pacing.js";

const pace: Pace = { gapMinutes: 60, perDay: 3, from: 9, to: 20, zone: "America/Toronto" };
const hourIn = (d: Date) =>
  Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: pace.zone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(d),
  );
const dayIn = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: pace.zone }).format(d);

describe("sendSlots", () => {
  // 2026-03-02 07:00 in Toronto (EST, UTC-5).
  const now = new Date("2026-03-02T12:00:00Z");

  it("spaces slots by the gap, inside the hours, under the day's cap", () => {
    const slots = sendSlots(5, { now, taken: [], pace, rand: () => 0 });
    expect(slots).toHaveLength(5);
    for (const s of slots) expect(hourIn(s)).toBeGreaterThanOrEqual(9);
    for (const s of slots) expect(hourIn(s)).toBeLessThan(20);
    for (let i = 1; i < slots.length; i++)
      expect(slots[i].getTime() - slots[i - 1].getTime()).toBeGreaterThanOrEqual(3_600_000);
    const days = slots.map(dayIn);
    expect(days.filter((d) => d === days[0])).toHaveLength(3);
    expect(slots[0].toISOString()).toBe("2026-03-02T14:10:00.000Z");
  });

  it("keeps the gap from what is already taken and counts it toward the day", () => {
    const taken = [new Date("2026-03-02T14:30:00Z"), new Date("2026-03-02T16:00:00Z")];
    const slots = sendSlots(2, { now, taken, pace, rand: () => 0 });
    for (const s of slots)
      for (const t of taken)
        expect(Math.abs(s.getTime() - t.getTime())).toBeGreaterThanOrEqual(3_600_000);
    expect(slots.map(dayIn)).toEqual(["2026-03-02", "2026-03-03"]);
  });

  it("jitters within half a gap and never on top of another", () => {
    const slots = sendSlots(3, { now, taken: [], pace, rand: () => 0.99 });
    expect(slots[0].getTime()).toBeLessThan(new Date("2026-03-02T14:40:00Z").getTime());
    expect(slots[1].getTime() - slots[0].getTime()).toBeGreaterThanOrEqual(3_600_000);
  });

  it("gives none on a lane with no room", () => {
    expect(sendSlots(2, { now, taken: [], pace: { ...pace, perDay: 0 }, rand: () => 0 })).toEqual(
      [],
    );
  });
});
