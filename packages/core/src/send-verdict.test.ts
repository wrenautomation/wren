import { describe, expect, it } from "vitest";
import {
  delivered,
  deliveryOf,
  NotSent,
  outputOf,
  SendUnknown,
  SentFound,
  withSendKey,
  writeKey,
} from "./send-verdict.js";

describe("send verdicts", () => {
  it("a verdict becomes the output or a typed error", () => {
    const at = "2026-10-16T12:00:00.000Z";
    expect(
      outputOf({ verdict: "sent", how: "answer", id: "1", url: null, at, output: { id: "1" } }),
    ).toEqual({ id: "1" });
    expect(() => outputOf({ verdict: "sent", how: "verified", id: "1", url: null, at })).toThrow(
      SentFound,
    );
    expect(() =>
      outputOf({ verdict: "not_sent", how: "refused", reason: "no", status: 403 }),
    ).toThrow(NotSent);
    expect(() => outputOf({ verdict: "unknown", reason: "lags", since: at })).toThrow(SendUnknown);
  });

  it("one key per write in a scope; none outside it", async () => {
    expect(writeKey("reddit", "POST", "/api/comment")).toBeNull();
    const keys = await withSendKey("thread:7 k1", async () => [
      writeKey("tiktok", "POST", "/web/posts"),
      writeKey("tiktok", "POST", "/web/posts"),
    ]);
    expect(keys).toEqual([
      "thread:7 k1 tiktok POST /web/posts",
      "thread:7 k1 tiktok POST /web/posts #2",
    ]);
  });

  it("a delivery crosses a service boundary as a value", async () => {
    const d = await deliveryOf("k", async () => {
      throw new SendUnknown("the list lags", "2026-10-16T12:00:00.000Z");
    });
    expect(d).toEqual({
      kind: "unknown",
      reason: "the list lags",
      since: "2026-10-16T12:00:00.000Z",
    });
    expect(() => delivered(d)).toThrow(SendUnknown);
    expect(delivered(await deliveryOf("k", async () => 5))).toBe(5);
  });
});
