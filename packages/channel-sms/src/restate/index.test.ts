import { describe, expect, it } from "vitest";
import type { TickStats } from "../deliver.js";
import { senderDelayMs } from "./index.js";

const idle = { sent: 0, retried: 0, activeNumbers: 1 } as TickStats;

describe("senderDelayMs", () => {
  it("waits the gap while sending, 5 min idle, 6 h with no active number", () => {
    expect(senderDelayMs({ ...idle, sent: 2 }, 90)).toBe(90_000);
    expect(senderDelayMs(idle, 90)).toBe(5 * 60_000);
    expect(senderDelayMs({ ...idle, activeNumbers: 0 }, 90)).toBe(6 * 3_600_000);
  });
});
