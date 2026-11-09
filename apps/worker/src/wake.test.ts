import { afterEach, describe, expect, it, vi } from "vitest";
import { pacedWakes, wakeTarget } from "./wake.js";

describe("wakeTarget", () => {
  it("keys a notice to its database's owner", () => {
    expect(wakeTarget("SmsSend/fleet", null)).toEqual({ service: "SmsSend", key: "fleet" });
    expect(wakeTarget("ReachSend/fleet", "acme")).toEqual({
      service: "ReachSend",
      key: "acme/fleet",
    });
    expect(wakeTarget("TouchToJourney/all", "acme")).toEqual({
      service: "TouchToJourney",
      key: "all",
    });
  });

  it("refuses anything else", () => {
    for (const p of ["", "SmsSend", "SmsSend/", "/fleet", "Sms Sender/fleet", "A/b/c", "A/b?x"])
      expect(wakeTarget(p, null)).toBeNull();
  });
});

describe("pacedWakes", () => {
  afterEach(() => vi.useRealTimers());

  it("folds a burst into one wake, then spaces the next", () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const p = pacedWakes((s, k) => sent.push(`${s}/${k}`), { settleMs: 1000, spaceMs: 15_000 });
    p.wake("SegmentPass", "fleet");
    p.wake("SegmentPass", "fleet");
    p.wake("SmsSend", "fleet");
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual(["SegmentPass/fleet", "SmsSend/fleet"]);
    // A row a second: the second wake waits out the space, and the notices meanwhile are it.
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1000);
      p.wake("SegmentPass", "fleet");
    }
    expect(sent).toHaveLength(2);
    vi.advanceTimersByTime(15_000);
    expect(sent).toEqual(["SegmentPass/fleet", "SmsSend/fleet", "SegmentPass/fleet"]);
    // Quiet past the space: the next notice goes after the settle alone.
    vi.advanceTimersByTime(20_000);
    p.wake("SegmentPass", "fleet");
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(4);
    p.close();
  });
});
