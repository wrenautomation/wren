import { describe, expect, it } from "vitest";
import { type OverviewQueue, type QueueRead, rankQueues, sumQueues } from "./overview-queues.js";

const now = new Date("2026-10-21T12:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
const q = (label: string): OverviewQueue => ({
  label,
  record: `x.${label}`,
  view: "waiting",
  href: `#${label}`,
  icon: "chat",
  wait: "at",
  promise: "24h",
});
const queues = ["a", "b", "c", "d"].map(q);

describe("rankQueues", () => {
  it("puts the longest wait first, then the empty ones, then failures", () => {
    const reads: QueueRead[] = [
      { total: 0, oldest: null },
      { total: 3, oldest: ago(6) },
      { error: "down" },
      { total: 1, oldest: ago(50) },
    ];
    const ranked = rankQueues(queues, reads, now);
    expect(ranked.map((r) => r.queue.label)).toEqual(["d", "b", "a", "c"]);
    expect(ranked[3]?.error).toBe("down");
  });

  it("keeps the declared order on a tie", () => {
    const reads: QueueRead[] = [
      { total: 1, oldest: ago(5) },
      { total: 1, oldest: ago(5) },
      { total: 0, oldest: null },
      { total: 0, oldest: null },
    ];
    expect(rankQueues(queues, reads, now).map((r) => r.queue.label)).toEqual(["a", "b", "c", "d"]);
  });

  it("calls a queue late only past its promise", () => {
    const reads: QueueRead[] = [
      { total: 1, oldest: ago(25) },
      { total: 1, oldest: ago(23) },
      { total: 0, oldest: ago(99) },
      { total: 1, oldest: null },
    ];
    expect(rankQueues(queues, reads, now).map((r) => [r.queue.label, r.late])).toEqual([
      ["a", true],
      ["b", false],
      ["d", false],
      ["c", false],
    ]);
  });

  it("leaves out a queue that has no read", () => {
    expect(rankQueues(queues, [{ total: 1, oldest: ago(1) }], now)).toHaveLength(1);
  });
});

describe("sumQueues", () => {
  it("adds the counts, the late queues and the longest wait", () => {
    const reads: QueueRead[] = [
      { total: 4, oldest: ago(50) },
      { total: 4, oldest: ago(30) },
      { total: 5, oldest: ago(6) },
      { total: 0, oldest: null },
    ];
    expect(sumQueues(rankQueues(queues, reads, now))).toEqual({ total: 13, late: 2, hours: 50 });
  });

  it("has no longest wait when nothing waits", () => {
    const reads: QueueRead[] = queues.map(() => ({ total: 0, oldest: null }));
    expect(sumQueues(rankQueues(queues, reads, now))).toEqual({ total: 0, late: 0, hours: null });
  });
});
