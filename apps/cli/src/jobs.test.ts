import { describe, expect, it } from "vitest";
import { eventLine, runLog, sseData } from "./jobs.js";

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

describe("sseData", () => {
  it("yields each event's data across chunk splits; skips pings", async () => {
    const parts = [
      ": open\n\n",
      'id: 7\ndata: {"a"',
      ":1}\n\n: ping\n\n",
      "id: 8\r\ndata: x\r\n\r\n",
    ];
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(enc.encode(p));
        c.close();
      },
    });
    const got: string[] = [];
    for await (const d of sseData(body)) got.push(d);
    expect(got).toEqual(['{"a":1}', "x"]);
  });
});

describe("eventLine", () => {
  it("names the run, its move and the failure", () => {
    const e = {
      seq: 1,
      invocation_id: "inv_x",
      service: "CommandRun",
      handler: "run",
      key: "capture",
      status: "paused",
      attempt: 3,
      failures: 3,
      failure: { message: "boom" },
      lease_until: null,
      build: null,
      at: "2026-11-28T10:15:00.000Z",
    };
    expect(eventLine(e)).toBe("2026-11-28 10:15:00  CommandRun/capture/run  paused#3  inv_x  boom");
  });
});
