import { loadSettings } from "@wren/config";
import { describe, expect, it } from "vitest";
import { SendPolicy } from "../send/policy.js";
import { nextReportAt, untilNextReport } from "./schedule.js";

// Defaults: America/Chicago (CDT in September = UTC-5). Friday 19:00 local = 00:00Z Saturday.
const policy = SendPolicy.fromSettings(loadSettings({ WREN_DATABASE_URL: "postgresql://x" }));
const utc = (d: number, h: number, m = 0) => new Date(Date.UTC(2026, 8, d, h, m));

describe("nextReportAt", () => {
  it("mid-week goes to this Friday 19:00 local", () => {
    expect(nextReportAt(policy, utc(16, 12)).toISOString()).toBe("2026-09-19T00:00:00.000Z");
  });
  it("Friday before 19:00 goes to tonight", () => {
    expect(nextReportAt(policy, utc(18, 23, 59)).toISOString()).toBe("2026-09-19T00:00:00.000Z");
  });
  it("exactly Friday 19:00 goes to next week, never now", () => {
    expect(nextReportAt(policy, utc(19, 0)).toISOString()).toBe("2026-09-26T00:00:00.000Z");
    expect(untilNextReport(policy, utc(19, 0))).toBe(7 * 86_400_000);
  });
  it("Saturday goes to next Friday", () => {
    expect(nextReportAt(policy, utc(19, 15)).toISOString()).toBe("2026-09-26T00:00:00.000Z");
  });
  it("crosses the DST fall-back", () => {
    // Fri 2026-10-30 19:00 CDT = 00:00Z Sat; Fri 2026-11-06 19:00 CST = 01:00Z Sat.
    expect(nextReportAt(policy, new Date("2026-10-31T00:00:00Z")).toISOString()).toBe(
      "2026-11-07T01:00:00.000Z",
    );
  });
});
