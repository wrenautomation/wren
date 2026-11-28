import { describe, expect, it } from "vitest";
import { runLog } from "./jobs.js";

describe("runLog", () => {
  it("keeps the sections of one run, each attempt, last 40 lines each", () => {
    const text = [
      "",
      "== 2026-11-28T03:17:01Z run inv_a attempt 1 tick x",
      "a1",
      "== exit 0 in 49 s",
      "",
      "== 2026-11-28T03:21:48Z run inv_b attempt 1 tick now",
      ...Array.from({ length: 45 }, (_, i) => `b${i}`),
      "== 2026-11-28T03:40:00Z run inv_b attempt 2 tick now",
      "b-two",
    ].join("\n");
    expect(runLog("capture", "inv_a", text)).toEqual([
      "== 2026-11-28T03:17:01Z run inv_a attempt 1 tick x",
      "a1",
      "== exit 0 in 49 s",
    ]);
    const b = runLog("capture", "inv_b", text);
    expect(b[0]).toContain("run inv_b attempt 1");
    expect(b[1]).toBe("b5");
    expect(b.slice(-2)).toEqual(["== 2026-11-28T03:40:00Z run inv_b attempt 2 tick now", "b-two"]);
    expect(runLog("capture", "inv_c", text)).toEqual([]);
  });
});
