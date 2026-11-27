import { describe, expect, it } from "vitest";
import { dueTick } from "./schedules.js";

const at = (s: string) => new Date(s);

describe("dueTick", () => {
  // 10:15 Toronto = 15:15Z in winter (EST)
  const cron = "15 10 * * *";
  const tz = "America/Toronto";

  it("is the tick between the last one and now", () => {
    expect(dueTick(cron, tz, at("2026-11-26T15:15:00Z"), at("2026-11-27T15:16:00Z"))).toEqual(
      at("2026-11-27T15:15:00Z"),
    );
  });

  it("is null before the next tick", () => {
    expect(dueTick(cron, tz, at("2026-11-27T15:15:00Z"), at("2026-11-28T15:14:00Z"))).toBeNull();
  });

  it("takes only the newest of many missed ticks", () => {
    expect(dueTick(cron, tz, at("2026-11-20T15:15:00Z"), at("2026-11-27T16:00:00Z"))).toEqual(
      at("2026-11-27T15:15:00Z"),
    );
  });

  it("keeps local time across a clock change", () => {
    // 2026-11-01 ends daylight time: 10:15 EDT = 14:15Z on 10-31, 10:15 EST = 15:15Z on 11-01
    expect(dueTick(cron, tz, at("2026-10-31T14:15:00Z"), at("2026-11-01T16:00:00Z"))).toEqual(
      at("2026-11-01T15:15:00Z"),
    );
  });
});
