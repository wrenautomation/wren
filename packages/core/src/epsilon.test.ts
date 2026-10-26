import { describe, expect, it } from "vitest";
import { nudge, nudgeFixed, seeded } from "./epsilon.js";

describe("nudge", () => {
  it("moves 1 to 9 minutes on, never to :00 or :30", () => {
    const at = new Date("2026-10-27T13:00:00Z");
    const r = seeded("t");
    for (let i = 0; i < 500; i++) {
      const n = nudge(at, r);
      const d = n.getTime() - at.getTime();
      expect(d).toBeGreaterThanOrEqual(60_000);
      expect(d).toBeLessThan(11 * 60_000);
      expect(n.getUTCMinutes() % 30).not.toBe(0);
    }
  });
  it("lands off the half hour when the move would hit it", () => {
    const at = new Date("2026-10-27T13:29:00Z");
    expect(nudge(at, () => 0).toISOString()).toBe("2026-10-27T13:31:00.000Z");
    expect(nudge(at, () => 0.999).getTime() - at.getTime()).toBeLessThan(10 * 60_000);
  });
  it("gives the same slot for the same key", () => {
    const at = new Date("2026-10-27T13:00:00Z");
    expect(nudgeFixed(at, "x")).toEqual(nudgeFixed(at, "x"));
    expect(nudgeFixed(at, "x")).not.toEqual(nudgeFixed(new Date("2026-10-28T13:00:00Z"), "x"));
  });
});
