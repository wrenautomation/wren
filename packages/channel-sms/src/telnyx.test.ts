import { describe, expect, it } from "vitest";
import {
  assignmentOf,
  campaignOf,
  lineTypeOf,
  parseTelnyxEvent,
  TelnyxProvider,
} from "./telnyx.js";

function fakeFetch(
  status: number,
  body: unknown,
  seen: { url: string; init: RequestInit | undefined }[] = [],
) {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

describe("TelnyxProvider.send", () => {
  it("posts the message under the profile and reads id, parts, cost", async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const t = new TelnyxProvider({
      apiKey: "k",
      messagingProfileId: "mp",
      fetch: fakeFetch(
        200,
        { data: { id: "m1", parts: 1, cost: { amount: "0.0040", currency: "USD" } } },
        seen,
      ),
    });
    expect(await t.send({ from: "+12125550100", to: "+12125550187", text: "hi" })).toEqual({
      ok: true,
      providerId: "m1",
      parts: 1,
      costUsd: 0.004,
    });
    expect(seen[0]?.url).toBe("https://api.telnyx.com/v2/messages");
    expect(JSON.parse(String(seen[0]?.init?.body))).toMatchObject({
      messaging_profile_id: "mp",
      text: "hi",
    });
    expect((seen[0]?.init?.headers as Record<string, string> | undefined)?.authorization).toBe(
      "Bearer k",
    );
  });
  it("splits permanent refusals, STOP blocks and try-later", async () => {
    const stop = new TelnyxProvider({
      apiKey: "k",
      fetch: fakeFetch(400, { errors: [{ code: "40300", title: "Blocked due to STOP message" }] }),
    });
    expect(await stop.send({ from: "a", to: "b", text: "c" })).toMatchObject({
      ok: false,
      retry: false,
      optedOut: true,
      code: "40300",
    });
    const bad = new TelnyxProvider({
      apiKey: "k",
      fetch: fakeFetch(422, { errors: [{ code: "40310", title: "Invalid 'to'" }] }),
    });
    expect(await bad.send({ from: "a", to: "b", text: "c" })).toMatchObject({
      ok: false,
      retry: false,
      optedOut: false,
    });
    const busy = new TelnyxProvider({
      apiKey: "k",
      fetch: fakeFetch(429, { errors: [{ title: "Too many" }] }),
    });
    expect(await busy.send({ from: "a", to: "b", text: "c" })).toMatchObject({
      ok: false,
      retry: true,
    });
  });
  it("needs a key", () => {
    expect(() => new TelnyxProvider({ apiKey: "" })).toThrow(/API key/);
  });
});

describe("lookup, numbers, balance", () => {
  it("reads a carrier lookup", async () => {
    const t = new TelnyxProvider({
      apiKey: "k",
      fetch: fakeFetch(200, { data: { carrier: { name: "T-Mobile USA", type: "mobile" } } }),
    });
    expect(await t.lookup("+12125550187")).toMatchObject({
      lineType: "mobile",
      carrier: "T-Mobile USA",
    });
  });
  it("keeps only active numbers on our profile", async () => {
    const t = new TelnyxProvider({
      apiKey: "k",
      messagingProfileId: "mp",
      fetch: fakeFetch(200, {
        data: [
          { id: "1", phone_number: "+12125550100", status: "active", messaging_profile_id: "mp" },
          {
            id: "2",
            phone_number: "+12125550101",
            status: "active",
            messaging_profile_id: "other",
          },
          {
            id: "3",
            phone_number: "+12125550102",
            status: "port-pending",
            messaging_profile_id: "mp",
          },
        ],
        meta: { total_pages: 1 },
      }),
    });
    expect(await t.listNumbers()).toEqual([{ e164: "+12125550100", providerId: "1" }]);
  });
  it("reads the balance and surfaces errors", async () => {
    expect(
      await new TelnyxProvider({
        apiKey: "k",
        fetch: fakeFetch(200, { data: { balance: "12.50" } }),
      }).balance(),
    ).toBe(12.5);
    await expect(
      new TelnyxProvider({
        apiKey: "k",
        fetch: fakeFetch(401, { errors: [{ code: "10009", detail: "auth" }] }),
      }).balance(),
    ).rejects.toThrow(/401/);
  });
  it("maps line types", () => {
    expect(lineTypeOf("fixed line")).toBe("landline");
    expect(lineTypeOf("fixed line or mobile")).toBe("unknown");
    expect(lineTypeOf("non-fixed VoIP")).toBe("voip");
  });
});

describe("parseTelnyxEvent", () => {
  it("reads an inbound text", () => {
    const e = parseTelnyxEvent({
      data: {
        id: "ev1",
        event_type: "message.received",
        occurred_at: "2026-09-29T15:00:00Z",
        payload: {
          id: "m9",
          text: "STOP",
          from: { phone_number: "+12125550187" },
          to: [{ phone_number: "+12125550100" }],
        },
      },
    });
    expect(e).toMatchObject({
      kind: "inbound",
      eventId: "ev1",
      from: "+12125550187",
      to: "+12125550100",
      text: "STOP",
    });
  });
  it("reads a finalized delivery and a failure", () => {
    const ok = parseTelnyxEvent({
      data: {
        id: "ev2",
        event_type: "message.finalized",
        payload: { id: "m1", to: [{ status: "delivered" }], completed_at: "2026-09-29T15:00:05Z" },
      },
    });
    expect(ok).toMatchObject({ kind: "status", messageId: "m1", status: "delivered" });
    const bad = parseTelnyxEvent({
      data: {
        id: "ev3",
        event_type: "message.finalized",
        payload: {
          id: "m2",
          to: [{ status: "delivery_failed" }],
          errors: [{ code: "40008", title: "Undeliverable" }],
        },
      },
    });
    expect(bad).toMatchObject({ status: "failed", code: "40008", detail: "Undeliverable" });
  });
  it("ignores what it does not use and refuses junk", () => {
    expect(
      parseTelnyxEvent({ data: { id: "ev4", event_type: "number_order.complete" } }).kind,
    ).toBe("ignored");
    expect(() => parseTelnyxEvent({})).toThrow();
  });
  it("reads an inbound call's events by its session; an outbound leg is ignored", () => {
    const call = (event_type: string, payload: Record<string, unknown>) =>
      parseTelnyxEvent({
        data: { id: `ev-${event_type}`, event_type, occurred_at: "2026-09-29T15:00:00Z", payload },
      });
    const base = {
      call_session_id: "s1",
      direction: "incoming",
      from: "+12125550187",
      to: "+12125550100",
    };
    expect(call("call.initiated", base)).toMatchObject({
      kind: "call",
      callId: "s1",
      stage: "ringing",
      from: "+12125550187",
      to: "+12125550100",
      cause: null,
    });
    expect(call("call.bridged", base)).toMatchObject({ stage: "bridged" });
    expect(
      call("call.hangup", { ...base, hangup_cause: "user_busy", end_time: "2026-09-29T15:00:20Z" }),
    ).toMatchObject({ stage: "ended", cause: "user_busy", at: new Date("2026-09-29T15:00:20Z") });
    expect(call("call.initiated", { ...base, direction: "outgoing" }).kind).toBe("ignored");
  });
});

describe("10DLC registration", () => {
  it("reads the campaign; stale reasons show only on a rejection", () => {
    const stale = [{ description: "opt-in unclear" }];
    expect(campaignOf({ campaignStatus: "MNO_PENDING", failureReasons: stale })).toEqual({
      status: "pending",
      raw: "MNO_PENDING",
      detail: null,
    });
    expect(campaignOf({ campaignStatus: "MNO_PROVISIONED" }).status).toBe("approved");
    expect(campaignOf({ campaignStatus: "TCR_FAILED", failureReasons: stale })).toMatchObject({
      status: "rejected",
      detail: "opt-in unclear",
    });
  });
  it("reads a number's assignment", () => {
    expect(assignmentOf({ assignmentStatus: "ASSIGNED", campaignId: "c" })).toMatchObject({
      status: "assigned",
      campaignId: "c",
    });
    expect(assignmentOf({ assignmentStatus: "PENDING_ASSIGNMENT" }).status).toBe("pending");
    expect(assignmentOf({ assignmentStatus: "FAILED_ASSIGNMENT" }).status).toBe("failed");
  });
  it("a number on no campaign is a 404, not an error", async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const t = new TelnyxProvider({
      apiKey: "k",
      fetch: fakeFetch(404, { errors: [{ code: "10005" }] }, seen),
    });
    expect(await t.registration.number("+13125550100")).toEqual({
      status: "none",
      campaignId: null,
      detail: null,
    });
    expect(seen[0]?.url).toContain("/10dlc/phone_number_campaigns/%2B13125550100");
  });
});

describe("TelnyxProvider.keywordReplies", () => {
  it("sends the HELP reply as Telnyx's `info` op, one per country", async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const t = new TelnyxProvider({
      apiKey: "k",
      messagingProfileId: "mp",
      fetch: fakeFetch(200, { data: [] }, seen),
    });
    await t.keywordReplies.set(
      "help",
      ["HELP", "INFO"],
      "Email us for help. Reply STOP to opt out.",
    );
    const posts = seen.filter((s) => s.init?.method === "POST");
    expect(posts.map((p) => JSON.parse(String(p.init?.body)))).toEqual([
      {
        op: "info",
        keywords: ["HELP", "INFO"],
        resp_text: "Email us for help. Reply STOP to opt out.",
        country_code: "US",
      },
      {
        op: "info",
        keywords: ["HELP", "INFO"],
        resp_text: "Email us for help. Reply STOP to opt out.",
        country_code: "CA",
      },
    ]);
  });
});
