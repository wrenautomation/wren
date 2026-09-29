import { describe, expect, it } from "vitest";
import { parseReactivationSettings, reactivationSettingsOf } from "./settings.js";

describe("reactivation settings", () => {
  it("an empty block is everything off, sending off, defaults filled", () => {
    const s = reactivationSettingsOf({});
    expect(s.on).toBe(false);
    expect(s.stages).toEqual({ research: true, compose: true, send: false, handoff: true });
    expect(s.compose.perDay).toBe(20);
    expect(s.sending).toEqual({ perInboxPerDay: null, openersPerDay: null, rampStart: null });
    expect(s.approval).toBe("first");
    expect(s.senders).toEqual([]);
    expect(s.offer).toEqual({ upfront: 1000, perMeeting: 500, cap: 15000 });
  });

  it("a partial block keeps its siblings' defaults", () => {
    const s = parseReactivationSettings({ stages: { send: true } });
    expect(s.stages).toEqual({ research: true, compose: true, send: true, handoff: true });
  });

  it("normalizes sender addresses", () => {
    const s = parseReactivationSettings({
      senders: [{ address: " Jo@Firm.com ", name: "Jo", recruiter: "JO@firm.com" }],
    });
    expect(s.senders[0]).toEqual({
      address: "jo@firm.com",
      name: "Jo",
      recruiter: "jo@firm.com",
      suspended: false,
    });
  });

  it("refuses typos, bad values and duplicate senders, saying where", () => {
    expect(() => parseReactivationSettings({ stagez: {} })).toThrow(/stagez/);
    expect(() => parseReactivationSettings({ compose: { perDay: -1 } })).toThrow(/compose.perDay/);
    expect(() => parseReactivationSettings({ approval: "never" })).toThrow(/approval/);
    expect(() =>
      parseReactivationSettings({
        senders: [
          { address: "a@f.com", name: "A" },
          { address: "A@f.com", name: "B" },
        ],
      }),
    ).toThrow(/twice/);
  });
});
