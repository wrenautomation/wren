import { describe, expect, it } from "vitest";
import { type Pace, sendSlots } from "./pacing.js";
import { overShare, THREAD_PACE } from "./scheduled.js";

const pace: Pace = { gapMinutes: 60, perDay: 3, from: 9, to: 20, zone: "America/Toronto" };
const hourIn = (d: Date) =>
  Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: pace.zone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(d),
  );
const ms = (d: Date | undefined) => d?.getTime() ?? Number.NaN;
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
      expect(ms(slots[i]) - ms(slots[i - 1])).toBeGreaterThanOrEqual(3_600_000);
    const days = slots.map(dayIn);
    expect(days.filter((d) => d === days[0])).toHaveLength(3);
    expect(slots[0]?.toISOString()).toBe("2026-03-02T14:10:00.000Z");
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
    expect(ms(slots[0])).toBeLessThan(new Date("2026-03-02T14:40:00Z").getTime());
    expect(ms(slots[1]) - ms(slots[0])).toBeGreaterThanOrEqual(3_600_000);
  });

  it("gives none on a lane with no room", () => {
    expect(sendSlots(2, { now, taken: [], pace: { ...pace, perDay: 0 }, rand: () => 0 })).toEqual(
      [],
    );
  });
});

describe("reach share on a lane", () => {
  const now = new Date("2026-03-02T12:00:00Z");

  it("a kind's own cap a day sits under the lane's", () => {
    const within = { perDay: 2, taken: [] as Date[] };
    const slots = sendSlots(4, {
      now,
      taken: [],
      pace: { ...pace, perDay: 5, within },
      rand: () => 0,
    });
    expect(slots.map(dayIn)).toEqual(["2026-03-02", "2026-03-02", "2026-03-03", "2026-03-03"]);
  });

  it("the kind's taken count toward its cap and the lane's", () => {
    const taken = [new Date("2026-03-02T14:30:00Z"), new Date("2026-03-02T16:00:00Z")];
    // Two of the lane's three today are the kind's: the kind gets none today.
    const within = { perDay: 2, taken: taken.slice(0, 2) };
    const [first] = sendSlots(1, { now, taken, pace: { ...pace, within }, rand: () => 0 });
    expect(first && dayIn(first)).toBe("2026-03-03");
  });

  it("slots past the share on their day leave, latest first; sent ones stay", () => {
    const at = (iso: string) => new Date(iso);
    const ids = overShare(
      [
        { id: "a", at: at("2026-03-02T15:00:00Z"), sent: false },
        { id: "b", at: at("2026-03-02T17:00:00Z"), sent: false },
        { id: "c", at: at("2026-03-02T19:00:00Z"), sent: false },
        { id: "d", at: at("2026-03-02T21:00:00Z"), sent: true },
        { id: "e", at: at("2026-03-03T15:00:00Z"), sent: false },
      ],
      2,
      pace.zone,
    );
    expect(ids).toEqual(["b", "c"]);
  });
});

describe("Reddit thread hours", () => {
  // Saturday 2026-10-17 in Toronto (EDT, UTC-4).
  const sat = new Date("2026-10-17T11:00:00Z"); // 07:00

  it("go out on weekends, from 8:00", () => {
    const [first] = sendSlots(1, {
      now: sat,
      taken: [],
      pace: { ...THREAD_PACE, perDay: 5 },
      rand: () => 0,
    });
    expect(first?.toISOString()).toBe("2026-10-17T12:10:00.000Z"); // Sat 08:10
  });

  it("end at 22:00 and fit five a day", () => {
    const slots = sendSlots(5, {
      now: sat,
      taken: [],
      pace: { ...THREAD_PACE, perDay: 5 },
      rand: () => 0,
    });
    expect(slots.map(dayIn)).toEqual(Array(5).fill("2026-10-17"));
    for (const s of slots) {
      expect(hourIn(s)).toBeGreaterThanOrEqual(8);
      expect(hourIn(s)).toBeLessThan(22);
    }
    const late = sendSlots(1, {
      now: new Date("2026-10-18T01:55:00Z"), // Sat 21:55
      taken: [],
      pace: { ...THREAD_PACE, perDay: 5 },
      rand: () => 0,
    });
    expect(late.map(dayIn)).toEqual(["2026-10-18"]);
    expect(late[0] && hourIn(late[0])).toBe(8);
  });
});
