import { afterEach, describe, expect, it, vi } from "vitest";
import { pacedWakes, wakeTarget } from "./wake.js";

describe("wakeTarget", () => {
  it("keys a notice to its database's owner", () => {
    expect(wakeTarget("SmsSender/fleet", null)).toEqual({ service: "SmsSender", key: "fleet" });
    expect(wakeTarget("ReachSender/fleet", "acme")).toEqual({
      service: "ReachSender",
      key: "acme/fleet",
    });
  });

  it("refuses anything else", () => {
    for (const p of ["", "SmsSender", "SmsSender/", "/fleet", "Sms Sender/fleet", "A/b/c", "A/b?x"])
      expect(wakeTarget(p, null)).toBeNull();
  });
});

describe("pacedWakes", () => {
  afterEach(() => vi.useRealTimers());

  it("folds a burst into one wake, then spaces the next", () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const p = pacedWakes((s, k) => sent.push(`${s}/${k}`), { settleMs: 1000, spaceMs: 15_000 });
    p.wake("Segments", "fleet");
    p.wake("Segments", "fleet");
    p.wake("SmsSender", "fleet");
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual(["Segments/fleet", "SmsSender/fleet"]);
    // A row a second: the second wake waits out the space, and the notices meanwhile are it.
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1000);
      p.wake("Segments", "fleet");
    }
    expect(sent).toHaveLength(2);
    vi.advanceTimersByTime(15_000);
    expect(sent).toEqual(["Segments/fleet", "SmsSender/fleet", "Segments/fleet"]);
    // Quiet past the space: the next notice goes after the settle alone.
    vi.advanceTimersByTime(20_000);
    p.wake("Segments", "fleet");
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(4);
    p.close();
  });
});
