import { loadSettings } from "@wren/config";
import { describe, expect, it } from "vitest";
import { PlainDate } from "../send/dates.js";
import { SendPolicy } from "../send/policy.js";
import { nextDigestAt, rampSummary } from "./digest-scheduler.js";

const NY = SendPolicy.fromSettings(
  loadSettings({ WREN_DATABASE_URL: "postgresql://x", WREN_SEND_TIMEZONE: "America/New_York" }),
);

describe("nextDigestAt", () => {
  it("is 07:00 today when now is before it, tomorrow otherwise (fleet clock)", () => {
    expect(nextDigestAt(NY, new Date("2026-09-21T09:30:00Z")).toISOString()).toBe(
      "2026-09-21T11:00:00.000Z",
    );
    expect(nextDigestAt(NY, new Date("2026-09-21T11:00:00Z")).toISOString()).toBe(
      "2026-09-22T11:00:00.000Z",
    );
  });
});

describe("rampSummary", () => {
  // Tuesday 2026-09-15, 11:00 New York: a@ is on send day 2 (cap 5), b@ on day 1 (cap 2).
  const NOW = new Date("2026-09-15T15:00:00Z");
  const ramp = (start: string) => ({
    start: PlainDate.fromIso(start),
    from: 2,
    step: 3,
    ceiling: 10,
  });
  it("one line for the whole fleet: sending, summed cap, starting later", () =>
    expect(
      rampSummary(
        NY,
        {
          "a@x.com": ramp("2026-09-14"),
          "b@x.com": ramp("2026-09-15"),
          "c@x.com": ramp("2026-09-21"),
        },
        NOW,
      ),
    ).toBe("inboxes: 2 sending, 7/day today, 1 start later"));
  it("no ramped inboxes, no line", () => expect(rampSummary(NY, {}, NOW)).toBeNull());
});
