import { describe, expect, it } from "vitest";
import { emptyStats } from "../tick.js";
import { reachDelayMs } from "./index.js";

const now = new Date("2026-10-11T12:00:00Z");

describe("reachDelayMs", () => {
  it("the gap while sending, 5 min while due rows are held", () => {
    expect(reachDelayMs({ ...emptyStats(), sent: 1 }, null, 120, now)).toBe(120_000);
    expect(reachDelayMs({ ...emptyStats(), held: { window: 2 } }, null, 120, now)).toBe(300_000);
  });

  it("nothing due: until the next queued row, the 15 min net at most", () => {
    expect(reachDelayMs(emptyStats(), null, 120, now)).toBe(900_000);
    expect(reachDelayMs(emptyStats(), "2026-10-11T12:01:00Z", 120, now)).toBe(60_000);
    expect(reachDelayMs(emptyStats(), "2026-10-13T12:00:00Z", 120, now)).toBe(900_000);
  });
});
