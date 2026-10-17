import { describe, expect, it } from "vitest";
import {
  currentSendKey,
  type Delivery,
  delivered,
  deliveryOf,
  isDelivery,
  NotSent,
  newSendKey,
  outputOf,
  rechecking,
  type SendTrace,
  SendUnknown,
  SentFound,
  sendAcross,
  terminalOf,
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

  it("a callee that wrote and then failed answers unknown, never a plain failure", async () => {
    const d = await deliveryOf("k", async () => {
      delivered({ kind: "sent", out: 1 });
      throw new Error("the database dropped");
    });
    expect(d).toMatchObject({ kind: "unknown", reason: expect.stringContaining("dropped") });
    // No write answered: the error stands, so the caller may try again.
    await expect(
      deliveryOf("k", async () => {
        throw new Error("no account");
      }),
    ).rejects.toThrow("no account");
    // A not-sent answer leaves nothing out there.
    const clean: SendTrace = { wrote: false };
    const d2 = await deliveryOf(
      "k",
      async () => {
        delivered({ kind: "not_sent", how: "before_submit", reason: "busy", status: null });
      },
      { trace: clean },
    );
    expect(d2.kind).toBe("not_sent");
    expect(clean.wrote).toBe(false);
  });

  it("each typed outcome crosses as a value and comes back as the same error", async () => {
    const at = "2026-10-16T12:00:00.000Z";
    const cases: [Error, Delivery<never>["kind"]][] = [
      [new SentFound("1", "u", at), "found"],
      [new NotSent("refused", "no", 403), "not_sent"],
      [new SendUnknown("lags", at), "unknown"],
    ];
    for (const [err, kind] of cases) {
      const d = await deliveryOf("k", async () => {
        throw err;
      });
      expect(d.kind).toBe(kind);
      expect(() => delivered(d)).toThrow(err.constructor as never);
    }
    const refused = await deliveryOf("k", async () => {
      throw new NotSent("refused", "no", 403);
    });
    expect(refused).toMatchObject({ kind: "not_sent", how: "refused", status: 403 });
  });

  it("isDelivery tells a delivery from an older callee's plain output", () => {
    expect(isDelivery({ kind: "sent", out: 1 })).toBe(true);
    // A void answer loses its `out` on the wire.
    expect(isDelivery({ kind: "sent" })).toBe(true);
    expect(isDelivery({ kind: "found", id: null, url: null, at: "t" })).toBe(true);
    expect(isDelivery({ id: "t1_x" })).toBe(false);
    expect(isDelivery(null)).toBe(false);
    expect(isDelivery("sent")).toBe(false);
  });

  it("recheck and the trace ride the scope", async () => {
    expect(rechecking()).toBe(false);
    expect(currentSendKey()).toBeNull();
    const trace: SendTrace = { wrote: false };
    await withSendKey(
      "k",
      async () => {
        expect(rechecking()).toBe(true);
        expect(currentSendKey()).toBe("k");
        delivered({ kind: "not_sent", how: "before_submit", reason: "busy", status: null });
      },
      { recheck: true, trace },
    ).catch(() => null);
    expect(trace.wrote).toBe(false);
    await withSendKey("k", async () => delivered({ kind: "unknown", reason: "x", since: "t" }), {
      trace,
    }).catch(() => null);
    expect(trace.wrote).toBe(true);
  });

  it("sendAcross hands the callee the key and recheck, and unwraps its delivery", async () => {
    const asked: unknown[] = [];
    const out = await withSendKey(
      "dm:3 k9",
      () =>
        sendAcross<string>(async (k) => {
          asked.push(k);
          return { kind: "sent", out: "t1_ok" };
        }),
      { recheck: true },
    );
    expect(out).toBe("t1_ok");
    expect(asked).toEqual([{ sendKey: "dm:3 k9", recheck: true }]);
    await expect(sendAcross(async () => ({ kind: "sent", out: 1 }))).rejects.toThrow(
      /needs a send key/,
    );
    await expect(
      withSendKey("k", () =>
        sendAcross(async () => ({ kind: "unknown", reason: "lags", since: "t" })),
      ),
    ).rejects.toBeInstanceOf(SendUnknown);
  });

  it("sendAcross takes a callee's plain answer as sent (it ignored the key)", async () => {
    expect(await withSendKey("k", () => sendAcross(async () => ({ id: "old" })))).toEqual({
      id: "old",
    });
    // A void answer too.
    expect(await withSendKey("k", () => sendAcross(async () => undefined))).toBeUndefined();
  });

  it("newSendKey is one per send, named for its item", () => {
    const a = newSendKey("dm:42");
    expect(a).toMatch(/^dm:42 [0-9a-f]{16}$/);
    expect(newSendKey("dm:42")).not.toBe(a);
  });

  it("a long path loses its tail to the cut, never the count", async () => {
    const keys = await withSendKey("k".repeat(150), async () => [
      writeKey("tiktok", "POST", `/${"p".repeat(120)}`),
      writeKey("tiktok", "POST", `/${"p".repeat(120)}`),
    ]);
    expect(keys.map((k) => k?.length)).toEqual([200, 200]);
    expect(keys[1]).toMatch(/ #2$/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("a typed outcome ends a handler terminal: 409, or the refusal's status", () => {
    expect(terminalOf(new SendUnknown("x", "t")).code).toBe(409);
    expect(terminalOf(new NotSent("refused", "no", 403)).code).toBe(403);
    expect(terminalOf(new NotSent("before_submit", "busy")).code).toBe(409);
  });
});
