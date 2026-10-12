import { describe, expect, it } from "vitest";
import type { TickStats } from "../deliver.js";
import { senderDelayMs } from "./index.js";

const idle = { sent: 0, retried: 0, due: 0, activeNumbers: 1, nextDue: null } as TickStats;
const now = new Date("2026-10-11T12:00:00Z");

describe("senderDelayMs", () => {
  it("waits the gap while sending, 6 h with no active number, 5 min while due texts are held", () => {
    expect(senderDelayMs({ ...idle, sent: 2 }, 90, now)).toBe(90_000);
    expect(senderDelayMs({ ...idle, activeNumbers: 0 }, 90, now)).toBe(6 * 3_600_000);
    expect(senderDelayMs({ ...idle, due: 3 }, 90, now)).toBe(5 * 60_000);
  });

  it("nothing due: sleeps until the next queued text, the 15 min net at most", () => {
    expect(senderDelayMs(idle, 90, now)).toBe(15 * 60_000);
    expect(senderDelayMs({ ...idle, nextDue: "2026-10-11T12:02:00Z" }, 90, now)).toBe(120_000);
    expect(senderDelayMs({ ...idle, nextDue: "2026-10-12T12:00:00Z" }, 90, now)).toBe(15 * 60_000);
    expect(senderDelayMs({ ...idle, nextDue: "2026-10-11T11:59:00Z" }, 90, now)).toBe(1000);
  });
});
