// Studio's desk calls and video saves, web side: an action's request id rides beside the console
// call (the Worker makes it the idempotency key), and a video edit's answer patches the page.
// Synthetic ids.
import { describe, expect, it, vi } from "vitest";

const calls: [string, Record<string, unknown>][] = [];
vi.mock("../../api.js", async (real) => ({
  ...(await real<typeof import("../../api.js")>()),
  call: async (handler: string, body: Record<string, unknown>) => {
    calls.push([handler, body]);
    return { done: ["1"], answer: null };
  },
}));
vi.stubGlobal("location", new URL("http://localhost:8803/"));
const { contentDesk, deskCall } = await import("./desk.js");
const { callOf } = await import("../../records.js");
const { viewPatch } = await import("./video-patch.js");

describe("request ids on desk calls", () => {
  it("lifts requestId out of the input, beside the call", async () => {
    calls.length = 0;
    await contentDesk("approve", { ids: ["d1"], now: true, requestId: "req-00000001" });
    await deskCall("DraftAsk", "set", { id: "d1", text: "hi", requestId: "req-00000002" });
    expect(calls[0]).toEqual([
      "console/call",
      {
        service: "ContentDesk",
        handler: "approve",
        key: "default",
        input: { ids: ["d1"], now: true },
        requestId: "req-00000001",
      },
    ]);
    expect(calls[1]?.[1]).toMatchObject({ requestId: "req-00000002", input: { id: "d1" } });
    expect(calls[1]?.[1].input).not.toHaveProperty("requestId");
  });

  it("record actions send it beside each call too", async () => {
    calls.length = 0;
    for (const handler of ["marketing/scheduleDraft", "marketing/postNow", "marketing/videoSet"])
      await callOf(null)(handler, {
        ids: ["7"],
        day: "2026-10-20",
        time: "09:00",
        patch: { title: "T" },
        requestId: "req-00000003",
      });
    expect(calls.map(([, b]) => b.requestId)).toEqual([
      "req-00000003",
      "req-00000003",
      "req-00000003",
    ]);
  });
});

describe("a video edit's answer", () => {
  const detail = { video: { title: "Old", words: [], finish: { fps: 30, lines: [], saved: {} } } };
  it("patches the video and its finish, keeping what it doesn't name", () => {
    const view = {
      title: "New",
      finish: { lines: [{ text: "hi" }], saved: { cuts: [] } },
      render: null,
    };
    const got = viewPatch(detail, { done: ["1"], answer: { run: "r1", view } });
    expect(got).toEqual({
      detail: {
        video: {
          title: "New",
          words: [],
          render: null,
          finish: { fps: 30, lines: [{ text: "hi" }], saved: { cuts: [] } },
        },
      },
      row: { render: null, title: "New" },
    });
  });
  it("answers null with no view, so the page reads again", () => {
    expect(viewPatch(detail, { done: ["1"], answer: { run: "r1" } })).toBeNull();
  });
});
