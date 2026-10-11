import { describe, expect, it } from "vitest";
import { LinqProvider, parseLinqEvent, serviceOf } from "./linq.js";

type Seen = { url: string; init: RequestInit | undefined }[];

/** Answers each call in turn; every number here is made up. */
function fakeFetch(answers: [number, unknown][], seen: Seen = []) {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    const [status, body] = answers[Math.min(seen.length - 1, answers.length - 1)] ?? [500, null];
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

const req = { from: "+12125550100", to: "+12125550187", text: "hi" };

describe("LinqProvider.send", () => {
  it("opens or reuses the chat and keeps what carried the text", async () => {
    const seen: Seen = [];
    const l = new LinqProvider({
      apiKey: "k",
      fetch: fakeFetch(
        [
          [
            201,
            { chat: { id: "c1", service: "iMessage", message: { id: "m1", service: "iMessage" } } },
          ],
        ],
        seen,
      ),
    });
    expect(await l.send(req)).toEqual({
      ok: true,
      providerId: "m1",
      parts: 1,
      costUsd: null,
      service: "imessage",
    });
    expect(seen[0]?.url).toBe("https://api.linqapp.com/api/partner/v3/chats");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
      from: req.from,
      to: [req.to],
      message: { parts: [{ type: "text", value: "hi" }] },
    });
  });

  it("a link in a first text is refused for good, in words; 429 and 5xx try later", async () => {
    const link = new LinqProvider({
      apiKey: "k",
      fetch: fakeFetch([[400, { error: { status: 400, code: 1005, message: "link" } }]]),
    });
    expect(await link.send(req)).toMatchObject({ ok: false, retry: false, code: "1005" });
    const busy = new LinqProvider({ apiKey: "k", fetch: fakeFetch([[429, {}]]) });
    expect(await busy.send(req)).toMatchObject({ ok: false, retry: true });
    const down = new LinqProvider({ apiKey: "k", fetch: fakeFetch([[503, {}]]) });
    expect(await down.send(req)).toMatchObject({ ok: false, retry: true });
  });
});

describe("LinqProvider.lookup", () => {
  it("iMessage or RCS is a mobile; neither is unknown", async () => {
    const blue = new LinqProvider({ apiKey: "k", fetch: fakeFetch([[200, { available: true }]]) });
    expect(await blue.lookup(req.to)).toMatchObject({ lineType: "mobile", imessage: true });
    const green = new LinqProvider({
      apiKey: "k",
      fetch: fakeFetch([
        [200, { available: false }],
        [200, { available: true }],
      ]),
    });
    expect(await green.lookup(req.to)).toMatchObject({ lineType: "mobile", imessage: false });
    const none = new LinqProvider({ apiKey: "k", fetch: fakeFetch([[200, { available: false }]]) });
    expect(await none.lookup(req.to)).toMatchObject({ lineType: "unknown", imessage: false });
  });
});

const envelope = (event_type: string, data: unknown) => ({
  api_version: "v3",
  webhook_version: "2026-02-03",
  event_type,
  event_id: "e1",
  created_at: "2026-10-11T12:00:00Z",
  trace_id: "t",
  partner_id: "p",
  data,
});

describe("parseLinqEvent", () => {
  it("reads an inbound text with its service", () => {
    expect(
      parseLinqEvent(
        envelope("message.received", {
          id: "m2",
          direction: "inbound",
          service: "SMS",
          sender_handle: { handle: req.to },
          chat: { id: "c1", owner_handle: { handle: req.from } },
          parts: [
            { type: "text", value: "yes" },
            { type: "media", url: "x" },
          ],
          sent_at: "2026-10-11T11:59:00Z",
        }),
      ),
    ).toEqual({
      kind: "inbound",
      eventId: "e1",
      type: "message.received",
      messageId: "m2",
      from: req.to,
      to: req.from,
      text: "yes",
      at: new Date("2026-10-11T11:59:00Z"),
      service: "sms",
    });
  });

  it("reads sent, delivered, read and failed as our states", () => {
    const out = { id: "m1", direction: "outbound", service: "iMessage" };
    expect(parseLinqEvent(envelope("message.sent", out))).toMatchObject({ status: "sent" });
    expect(parseLinqEvent(envelope("message.read", out))).toMatchObject({
      status: "delivered",
      service: "imessage",
    });
    expect(
      parseLinqEvent(
        envelope("message.failed", {
          message_id: "m1",
          code: 4001,
          reason: "no route",
          service: null,
        }),
      ),
    ).toMatchObject({ kind: "status", status: "failed", code: "4001", detail: "no route" });
    expect(parseLinqEvent(envelope("reaction.added", out))).toMatchObject({ kind: "ignored" });
  });

  it("refuses the old payload version, and reads a Telnyx call as Telnyx", () => {
    expect(() =>
      parseLinqEvent({ ...envelope("message.sent", {}), webhook_version: "2025-01-01" }),
    ).toThrow(/2026-02-03/);
    expect(
      parseLinqEvent({
        data: {
          id: "t1",
          event_type: "call.initiated",
          occurred_at: "2026-10-11T12:00:00Z",
          payload: { call_session_id: "s1", direction: "incoming", from: req.to, to: req.from },
        },
      }),
    ).toMatchObject({ kind: "call", stage: "ringing" });
  });

  it("names services ours", () => {
    expect([serviceOf("iMessage"), serviceOf("RCS"), serviceOf("SMS"), serviceOf("x")]).toEqual([
      "imessage",
      "rcs",
      "sms",
      null,
    ]);
  });
});
