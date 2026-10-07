import { describe, expect, it } from "vitest";
import {
  answerKept,
  bodyOf,
  bodyProblem,
  fillText,
  headersOf,
  keepOf,
  privateIp,
  retryTriesOf,
  urlProblem,
  webhookEventOfDoor,
  webhookEventOfEmit,
  webhookEventOfFired,
} from "./webhook-events.js";
import {
  eventIdOf,
  newSecret,
  retryable,
  safePost,
  secretsOf,
  signatureOf,
  signedHeaders,
  verifyWebhook,
  webhookStep,
} from "./webhooks.js";
import { sealToken } from "./doors.js";
import { logicOf, logicProblems } from "./logic.js";
import type { WebhookSubscription } from "./schema.js";

describe("the URL guard", () => {
  it.each([
    ["http://hooks.example.com/x", "https"],
    ["https://user:pw@hooks.example.com", "login"],
    ["https://localhost/x", "local"],
    ["https://box.internal/x", "local"],
    ["https://printer.local/x", "local"],
    ["https://metadata.google.internal/x", "local"],
    ["https://fileserver/x", "public host"],
    ["https://127.0.0.1/x", "private"],
    ["https://10.1.2.3/x", "private"],
    ["https://169.254.169.254/latest", "private"],
    ["https://[::1]/x", "private"],
    ["https://[::ffff:127.0.0.1]/x", "private"],
    ["https://[fd00::1]/x", "private"],
    ["not a url", "isn't a URL"],
  ])("refuses %s", (url, why) => {
    expect(urlProblem(url)).toContain(why);
  });

  it.each(["https://hooks.example.com/in?x=1", "https://93.184.215.14/x", "https://[2606:4700::1]/"])(
    "takes %s",
    (url) => expect(urlProblem(url)).toBeNull(),
  );

  it("knows private addresses, v4 and v6", () => {
    for (const ip of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.9.9.9",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fe80::1",
      "fc00::1",
      "::ffff:10.0.0.1",
      "64:ff9b::7f00:1",
      "2002:7f00:1::",
      "nonsense",
    ])
      expect(privateIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])
      expect(privateIp(ip), ip).toBe(false);
  });
});

describe("signing", () => {
  const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
  const body = '{"type":"lead.created"}';

  it("signs the Standard Webhooks way", () => {
    // Standard Webhooks' own test vector: id, timestamp, body and secret give this signature.
    expect(
      signatureOf(
        secret,
        "msg_p5jXN8AQM9LWM0D4loKWxJek",
        1614265330,
        '{"test": 2432232314}',
      ),
    ).toBe("v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });

  it("verifies within five minutes, with either secret after a rotate", () => {
    const old = newSecret();
    const h = signedHeaders([secret, old], "msg_1", 1_000_000, body);
    expect(h["webhook-signature"]?.split(" ")).toHaveLength(2);
    expect(verifyWebhook(secret, h, body, 1_000_100)).toBe(true);
    expect(verifyWebhook(old, h, body, 1_000_100)).toBe(true);
    expect(verifyWebhook(secret, h, body, 1_000_301)).toBe(false);
    expect(verifyWebhook(secret, h, `${body} `, 1_000_000)).toBe(false);
    expect(verifyWebhook(newSecret(), h, body, 1_000_000)).toBe(false);
  });

  it("keeps an event's id across a retried call, not across subjects", () => {
    expect(eventIdOf("inv_1", "reply.received", "reply:sms:1")).toBe(
      eventIdOf("inv_1", "reply.received", "reply:sms:1"),
    );
    expect(eventIdOf("inv_1", "reply.received", "reply:sms:1")).not.toBe(
      eventIdOf("inv_1", "reply.received", "reply:sms:2"),
    );
  });

  it("signs with the old secret only in its grace", () => {
    const key = "test-key";
    const now = new Date("2026-10-07T12:00:00Z");
    const s = {
      secret: sealToken("whsec_bmV3", key),
      prevSecret: sealToken("whsec_b2xk", key),
      prevUntil: new Date(now.getTime() + 1000),
    } as WebhookSubscription;
    expect(secretsOf(s, now, key)).toEqual(["whsec_bmV3", "whsec_b2xk"]);
    expect(secretsOf(s, new Date(now.getTime() + 2000), key)).toEqual(["whsec_bmV3"]);
    expect(secretsOf(s, now, "other-key")).toEqual([]);
  });
});

describe("events", () => {
  it("maps the spine's moments to webhook events", () => {
    expect(webhookEventOfFired({ trigger: "trigger.reply", channel: "sms" })).toBe(
      "reply.received",
    );
    expect(webhookEventOfFired({ trigger: "trigger.booking", change: "booked" })).toBe(
      "booking.made",
    );
    expect(webhookEventOfFired({ trigger: "trigger.booking", change: "cancelled" })).toBe(
      "booking.cancelled",
    );
    expect(
      webhookEventOfFired({ trigger: "trigger.flag", change: "raised", side: "risk" }),
    ).toBeNull();
    expect(webhookEventOfDoor("lead")).toBe("lead.created");
    expect(webhookEventOfDoor("form")).toBe("form.submitted");
    expect(webhookEventOfDoor("reply")).toBeNull();
    expect(webhookEventOfEmit("close", "outcome.won")).toBe("deal.won");
    expect(webhookEventOfEmit("close", "outcome.lost")).toBeNull();
  });

  it("retries what may change", () => {
    for (const status of [null, 408, 425, 429, 500, 503])
      expect(retryable({ status }), String(status)).toBe(true);
    for (const status of [200, 301, 400, 401, 404, 410]) expect(retryable({ status })).toBe(false);
  });

  it("reads a workflow's auto-retry tries", () => {
    expect(retryTriesOf(undefined)).toBe(0);
    expect(retryTriesOf(3)).toBe(3);
    expect(retryTriesOf(9)).toBe(5);
    expect(retryTriesOf("x")).toBe(0);
  });
});

describe("the Send webhook node's settings", () => {
  const e = {
    subject: "lead:sms:7",
    kind: "lead",
    data: { lead: { email: "dana@example.com", score: 7, tags: ["a"] } },
  };

  it("fills slots: whole ones keep their type, inside text they're text, in a URL encoded", () => {
    expect(
      bodyOf('{"email": "{{data.lead.email}}", "score": "{{data.lead.score}}", "who": "id {{subject}}"}', e),
    ).toEqual({ email: "dana@example.com", score: 7, who: "id lead:sms:7" });
    expect(bodyOf('{"tags": "{{ data.lead.tags }}", "none": "{{data.nope}}"}', e)).toEqual({
      tags: ["a"],
      none: null,
    });
    expect(fillText("https://x.example.com/p?e={{data.lead.email}}", e, true)).toBe(
      "https://x.example.com/p?e=dana%40example.com",
    );
    expect(bodyOf("", e)).toEqual({ subject: e.subject, kind: "lead", data: e.data });
  });

  it("says what won't read", () => {
    expect(bodyProblem("{nope")).toContain("JSON");
    expect(bodyProblem("")).toBeNull();
    const h = headersOf("Authorization: Bearer {{data.lead.score}}\nwebhook-id: x\nbroken", e);
    expect(h.headers).toEqual({ Authorization: "Bearer 7" });
    expect(h.problems).toHaveLength(2);
    expect(keepOf("id=body.id, ok=status, bad=data.x").keep).toEqual({
      id: "body.id",
      ok: "status",
    });
  });

  it("keeps the answer's status, time, body and named parts", () => {
    expect(
      answerKept({ status: 201, ms: 40, body: '{"id":"c_1"}' }, { id: "body.id", code: "status" }),
    ).toEqual({ status: 201, ms: 40, body: { id: "c_1" }, id: "c_1", code: 201 });
    const long = answerKept({ status: 200, ms: 1, body: "x".repeat(5000) }, {});
    expect(String(long.body)).toHaveLength(4000);
  });
});

describe("safePost", () => {
  it("refuses a host that resolves to a private address, before connecting", async () => {
    const got = await safePost(
      { url: "https://rebind.example.com/x", body: "{}" },
      { resolve: async () => [{ address: "127.0.0.1", family: 4 }] },
    );
    expect(got.status).toBeNull();
    expect(got.error).toContain("private");
  });

  it("refuses a bad URL without a lookup", async () => {
    let asked = false;
    const got = await safePost(
      { url: "http://hooks.example.com" },
      {
        resolve: async () => {
          asked = true;
          return [];
        },
      },
    );
    expect(asked).toBe(false);
    expect(got.error).toContain("https");
  });

  it("the step throws on no answer, so the spine's tries and auto-retry apply", async () => {
    const step = webhookStep({ resolve: async () => [{ address: "10.0.0.5", family: 4 }] });
    await expect(
      step(
        "in",
        { subject: "lead:1", kind: "lead", data: {} },
        { client: null, workflow: "w", node: "hook", with: { url: "https://api.example.com/x" } },
      ),
    ).rejects.toThrow(/private/);
  });
});

describe("the Send webhook node", () => {
  it("checks its URL, method, body, headers and keep", () => {
    const n = (w: Record<string, string>) => ({ id: "post", uses: "logic.webhook", with: w });
    expect(logicProblems("w.post", n({ url: "https://api.example.com/{{data.id}}" }))).toEqual([]);
    const bad = logicProblems(
      "w.post",
      n({ url: "http://10.0.0.1", method: "PUSH", body: "{x", headers: "nope", keep: "x" }),
    );
    expect(bad).toHaveLength(5);
    expect(logicOf("logic.webhook")?.says({ url: "https://api.example.com/x" })).toBe(
      "POST to api.example.com",
    );
  });
});
