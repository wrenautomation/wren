/**
 * The Worker with fake bindings: webhooks are signature-checked and forwarded
 * once per event id, and the desk opens only for a valid token from Wren's
 * sign-in that names an operator. A credential link is minted only signed and
 * taken once, by an operator.
 */
import { forgetKeys } from "@wren/auth/verify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import worker, { DESK_HANDLERS, forgetSigners, LINK_SIGNATURE } from "../src/worker.js";

const HOST = "https://phone.test";
const AUTH = "https://auth.test";
let restateCalls: { url: string; headers: Headers; body: string }[] = [];
let restateStatus = 200;
/** What `SmsEvents/signer` answers; default: the path's owner, on Wren's account. */
let signer: (req: { number: string | null; client: string | null }) => unknown;
let signerCalls = 0;
let keys: CryptoKeyPair;
let env: Env;
/** The fake KV: what was put, and with which options. */
let kv: Map<string, { value: string; ttl: number | undefined }>;

function b64(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}
const b64u = (v: unknown) =>
  btoa(typeof v === "string" ? v : JSON.stringify(v))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** A token as Wren's sign-in mints it, signed with `key`. */
async function token(claims: Record<string, unknown>, key = keys.privateKey) {
  const head = b64u({ alg: "EdDSA", kid: "k1", typ: "JWT" });
  const body = b64u({
    aud: ["wren"],
    iss: AUTH,
    sub: "u1",
    exp: Math.floor(Date.now() / 1000) + 600,
    email: "william@wrenautomation.com",
    operator: true,
    ...claims,
  });
  const sig = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(`${head}.${body}`));
  let bin = "";
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return `${head}.${body}.${b64u(bin)}`;
}

beforeEach(async () => {
  forgetKeys();
  forgetSigners();
  restateCalls = [];
  restateStatus = 200;
  signerCalls = 0;
  signer = (req) => ({ ok: true, client: req.client, publicKey: null });
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer;
  kv = new Map();
  env = {
    CRED_LINKS: {
      get: async (k: string) => kv.get(k)?.value ?? null,
      put: async (k: string, value: string, o?: { expirationTtl?: number }) => {
        kv.set(k, { value, ttl: o?.expirationTtl });
      },
      delete: async (k: string) => {
        kv.delete(k);
      },
    } as unknown as KVNamespace,
    CRED_LINK_SECRET: "link-secret",
    ASSETS: { fetch: async () => new Response("<html>app</html>") } as unknown as Fetcher,
    AUTH_ORIGIN: AUTH,
    TELNYX_PUBLIC_KEY: b64(pub),
    RESTATE_INGRESS_URL: "https://restate.test/",
    RESTATE_AUTH_TOKEN: "rt",
  };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url === `${AUTH}/api/auth/jwks`) {
      const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
      // As Better Auth publishes it: alg EdDSA (WebCrypto exports Ed25519).
      return Response.json({ keys: [{ ...jwk, alg: "EdDSA", kid: "k1" }] });
    }
    if (url.endsWith("/SmsEvents/signer")) {
      signerCalls += 1;
      return Response.json(signer(JSON.parse(String(init.body))));
    }
    restateCalls.push({ url, headers: new Headers(init.headers), body: String(init.body) });
    return new Response(JSON.stringify({ ok: true }), { status: restateStatus });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const call = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`${HOST}${path}`, init), env);
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const as = async (claims: Record<string, unknown> = {}) => ({
  authorization: `Bearer ${await token(claims)}`,
});

async function signedWebhook(
  body: string,
  at = Math.floor(Date.now() / 1000),
  path = "/webhooks/telnyx",
  signer = keys.privateKey,
) {
  const sig = await crypto.subtle.sign(
    { name: "Ed25519" },
    signer,
    new TextEncoder().encode(`${at}|${body}`),
  );
  return call(path, {
    method: "POST",
    headers: {
      "telnyx-signature-ed25519": b64(sig as ArrayBuffer),
      "telnyx-timestamp": String(at),
    },
    body,
  });
}

describe("telnyx webhook", () => {
  const body = JSON.stringify({
    data: { id: "evt-1", event_type: "message.received", payload: {} },
  });

  it("forwards a signed event to Restate, keyed by its id", async () => {
    const res = await signedWebhook(body);
    expect(res.status).toBe(200);
    expect(restateCalls).toHaveLength(1);
    expect(restateCalls[0]?.url).toBe("https://restate.test/SmsEvents/ingest/send");
    expect(restateCalls[0]?.headers.get("idempotency-key")).toBe("telnyx-evt-1");
    expect(restateCalls[0]?.headers.get("authorization")).toBe("Bearer rt");
    expect(restateCalls[0]?.body).toBe(body);
  });

  it("a client's messaging profile lands through ingestFor, wrapped with its id", async () => {
    const res = await signedWebhook(body, undefined, "/webhooks/telnyx/acme");
    expect(res.status).toBe(200);
    expect(restateCalls[0]?.url).toBe("https://restate.test/SmsEvents/ingestFor/send");
    expect(restateCalls[0]?.headers.get("idempotency-key")).toBe("telnyx-evt-1");
    expect(JSON.parse(restateCalls[0]?.body as string)).toEqual({
      client: "acme",
      body: JSON.parse(body),
    });
  });

  it("refuses a forged, stale or unsigned event and forwards nothing", async () => {
    expect((await call("/webhooks/telnyx", { method: "POST", body })).status).toBe(401);
    expect((await signedWebhook(body, Math.floor(Date.now() / 1000) - 3600)).status).toBe(401);
    const res = await call("/webhooks/telnyx", {
      method: "POST",
      headers: {
        "telnyx-signature-ed25519": b64(new Uint8Array(64).buffer),
        "telnyx-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      body,
    });
    expect(res.status).toBe(401);
    expect(restateCalls).toHaveLength(0);
  });

  describe("a client on its own Telnyx account", () => {
    const ACME = "+15550001111";
    const BETA = "+15550002222";
    const WREN = "+15550009999";
    const to = (n: string) =>
      JSON.stringify({
        data: {
          id: "evt-2",
          event_type: "message.received",
          payload: { from: { phone_number: "+15551230000" }, to: [{ phone_number: n }] },
        },
      });
    let acme: CryptoKeyPair;
    let beta: CryptoKeyPair;
    const pubOf = async (k: CryptoKeyPair) =>
      b64((await crypto.subtle.exportKey("raw", k.publicKey)) as ArrayBuffer);
    beforeEach(async () => {
      const pair = () =>
        crypto.subtle.generateKey({ name: "Ed25519" }, true, [
          "sign",
          "verify",
        ]) as Promise<CryptoKeyPair>;
      acme = await pair();
      beta = await pair();
      const owners: Record<string, { client: string | null; publicKey: string | null }> = {
        [ACME]: { client: "acme", publicKey: await pubOf(acme) },
        [BETA]: { client: "beta", publicKey: await pubOf(beta) },
        [WREN]: { client: null, publicKey: null },
      };
      signer = ({ number, client }) => {
        const o = number ? owners[number] : undefined;
        if (!o) return { ok: true, client, publicKey: null };
        if (client && o.client !== client)
          return { ok: false, why: `that number isn't ${client}'s` };
        return { ok: true, ...o };
      };
    });

    it("its signature passes on its number and lands in its database", async () => {
      const res = await signedWebhook(
        to(ACME),
        undefined,
        "/webhooks/telnyx/acme",
        acme.privateKey,
      );
      expect(res.status).toBe(200);
      expect(restateCalls[0]?.url).toBe("https://restate.test/SmsEvents/ingestFor/send");
      expect(JSON.parse(restateCalls[0]?.body as string).client).toBe("acme");
      // The number picks the client on Wren's path too.
      restateCalls = [];
      expect(
        (await signedWebhook(to(ACME), undefined, "/webhooks/telnyx", acme.privateKey)).status,
      ).toBe(200);
      expect(JSON.parse(restateCalls[0]?.body as string).client).toBe("acme");
    });

    it("another client's signature fails, and so does Wren's", async () => {
      expect(
        (await signedWebhook(to(BETA), undefined, "/webhooks/telnyx", acme.privateKey)).status,
      ).toBe(401);
      expect((await signedWebhook(to(ACME), undefined, "/webhooks/telnyx/acme")).status).toBe(401);
      // A path naming someone other than the number's owner is refused before any check.
      expect(
        (await signedWebhook(to(BETA), undefined, "/webhooks/telnyx/acme", acme.privateKey)).status,
      ).toBe(401);
      expect(restateCalls).toHaveLength(0);
    });

    it("Wren's numbers still pass on Wren's key, and never on a client's", async () => {
      expect((await signedWebhook(to(WREN))).status).toBe(200);
      expect(restateCalls[0]?.url).toBe("https://restate.test/SmsEvents/ingest/send");
      restateCalls = [];
      expect(
        (await signedWebhook(to(WREN), undefined, "/webhooks/telnyx", acme.privateKey)).status,
      ).toBe(401);
      expect(restateCalls).toHaveLength(0);
    });

    it("asks whose key once per number, and 502 when it can't ask", async () => {
      await signedWebhook(to(ACME), undefined, "/webhooks/telnyx", acme.privateKey);
      await signedWebhook(to(ACME), undefined, "/webhooks/telnyx", acme.privateKey);
      expect(signerCalls).toBe(1);
      // An unsigned request costs no lookup.
      await call("/webhooks/telnyx", { method: "POST", body: to(BETA) });
      expect(signerCalls).toBe(1);
      forgetSigners();
      signer = () => {
        throw new Error("down");
      };
      expect(
        (await signedWebhook(to(ACME), undefined, "/webhooks/telnyx", acme.privateKey)).status,
      ).toBe(502);
    });
  });

  it("answers 502 when Restate fails, so Telnyx retries; 503 with no key configured", async () => {
    restateStatus = 500;
    expect((await signedWebhook(body)).status).toBe(502);
    delete env.TELNYX_PUBLIC_KEY;
    expect((await signedWebhook(body)).status).toBe(503);
  });
});

describe("cal.com webhook", () => {
  const SECRET = "test-secret";
  const booking = JSON.stringify({
    triggerEvent: "BOOKING_CREATED",
    payload: { uid: "bk-1", startTime: "2026-10-06T15:00:00Z", attendees: [] },
  });
  const sign = async (body: string, secret = SECRET) => {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
    return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const send = (body: string, signature?: string) =>
    call("/webhooks/calcom", {
      method: "POST",
      headers: signature ? { "x-cal-signature-256": signature } : {},
      body,
    });
  beforeEach(() => {
    env.CALCOM_WEBHOOK_SECRET = SECRET;
  });

  it("forwards a signed booking to Restate, keyed by trigger + uid + start, the same key twice", async () => {
    expect((await send(booking, await sign(booking))).status).toBe(200);
    expect((await send(booking, await sign(booking))).status).toBe(200);
    expect(restateCalls).toHaveLength(2);
    expect(restateCalls[0]?.url).toBe("https://restate.test/CallBookings/ingest/send");
    expect(restateCalls[0]?.headers.get("idempotency-key")).toBe(
      "calcom-BOOKING_CREATED-bk-1-2026-10-06T15:00:00Z",
    );
    expect(restateCalls[1]?.headers.get("idempotency-key")).toBe(
      restateCalls[0]?.headers.get("idempotency-key"),
    );
    expect(restateCalls[0]?.body).toBe(booking);
  });

  it("refuses an unsigned or wrongly signed booking and forwards nothing", async () => {
    expect((await send(booking)).status).toBe(401);
    expect((await send(booking, await sign(booking, "other"))).status).toBe(401);
    expect((await send(booking, "zz")).status).toBe(401);
    expect(restateCalls).toHaveLength(0);
  });

  it("answers a signed PING with 200 and goes no further", async () => {
    const ping = JSON.stringify({ triggerEvent: "PING", payload: {} });
    expect((await send(ping, await sign(ping))).status).toBe(200);
    expect(restateCalls).toHaveLength(0);
  });

  it("answers 502 when Restate fails; 503 with no secret configured", async () => {
    restateStatus = 500;
    expect((await send(booking, await sign(booking))).status).toBe(502);
    delete env.CALCOM_WEBHOOK_SECRET;
    expect((await send(booking, await sign(booking))).status).toBe(503);
  });

  it("a client's booking checks that client's own secret and lands through ingestFor", async () => {
    env.CALCOM_WEBHOOK_SECRETS = JSON.stringify({ acme: "acme-secret" });
    const to = (path: string, signature: string) =>
      call(path, { method: "POST", headers: { "x-cal-signature-256": signature }, body: booking });
    // Wren's secret does not open a client's door; a client with no secret is not found.
    expect((await to("/webhooks/calcom/acme", await sign(booking))).status).toBe(401);
    expect((await to("/webhooks/calcom/other", await sign(booking, "acme-secret"))).status).toBe(
      404,
    );
    expect(restateCalls).toHaveLength(0);
    expect((await to("/webhooks/calcom/acme", await sign(booking, "acme-secret"))).status).toBe(
      200,
    );
    expect(restateCalls[0]?.url).toBe("https://restate.test/CallBookings/ingestFor/send");
    expect(restateCalls[0]?.headers.get("idempotency-key")).toBe(
      "calcom-acme-BOOKING_CREATED-bk-1-2026-10-06T15:00:00Z",
    );
    expect(JSON.parse(restateCalls[0]?.body as string)).toEqual({
      client: "acme",
      body: JSON.parse(booking),
    });
  });
});

describe("gmail push", () => {
  const push = (data: unknown, id = "pm-1") => ({
    message: { data: btoa(JSON.stringify(data)), messageId: id },
    subscription: "projects/p/subscriptions/gmail-push-phone",
  });
  const change = { emailAddress: "William@Wren-Automation.net", historyId: "42" };
  beforeEach(() => {
    env.GMAIL_PUSH_TOKEN = "tok";
  });

  it("a push with the token runs the mailbox's pass, keyed by Pub/Sub's message id", async () => {
    expect((await post("/webhooks/gmail?token=tok", push(change))).status).toBe(200);
    expect(restateCalls[0]?.url).toBe(
      "https://restate.test/InboxPush/william%40wren-automation.net/notify/send",
    );
    expect(restateCalls[0]?.headers.get("idempotency-key")).toBe("gmail-pm-1");
  });

  it("refuses a wrong or missing token, and a body that is not a push", async () => {
    expect((await post("/webhooks/gmail?token=nope", push(change))).status).toBe(401);
    expect((await post("/webhooks/gmail", push(change))).status).toBe(401);
    expect((await post("/webhooks/gmail?token=tok", { message: { data: "!!" } })).status).toBe(400);
    expect((await post("/webhooks/gmail?token=tok", push({ historyId: "1" }))).status).toBe(400);
    expect(restateCalls).toHaveLength(0);
  });

  it("answers 502 when Restate fails, so Pub/Sub retries; 503 with no token set", async () => {
    restateStatus = 500;
    expect((await post("/webhooks/gmail?token=tok", push(change))).status).toBe(502);
    delete env.GMAIL_PUSH_TOKEN;
    expect((await post("/webhooks/gmail?token=tok", push(change))).status).toBe(503);
  });
});

describe("the desk", () => {
  it("is closed without a token, and shut when sign-in isn't set up", async () => {
    expect((await post("/api/threads", {})).status).toBe(401);
    delete env.AUTH_ORIGIN;
    expect((await post("/api/threads", {}, await as())).status).toBe(503);
    expect(restateCalls).toHaveLength(0);
  });

  it("an operator's token reaches SmsDesk", async () => {
    const res = await post("/api/reply", { contactId: 3, body: "hi" }, await as());
    expect(res.status).toBe(200);
    expect(restateCalls[0]?.url).toBe("https://restate.test/SmsDesk/reply");
    expect(JSON.parse(restateCalls[0]?.body as string)).toEqual({ contactId: 3, body: "hi" });
  });

  it("a client's token is turned away; a forged, expired or foreign one is not a sign-in", async () => {
    expect((await post("/api/threads", {}, await as({ operator: false }))).status).toBe(403);
    const stranger = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    for (const bad of [
      await token({}, stranger.privateKey),
      await token({ exp: Math.floor(Date.now() / 1000) - 60 }),
      await token({ iss: "https://elsewhere.test" }),
      await token({ aud: ["other"] }),
    ])
      expect((await post("/api/threads", {}, { authorization: `Bearer ${bad}` })).status).toBe(401);
    expect(restateCalls).toHaveLength(0);
  });

  it("only the app's handlers are open, and only as JSON", async () => {
    expect(DESK_HANDLERS.has("enroll")).toBe(false);
    expect((await post("/api/enroll", { sequence: "x", limit: 5 }, await as())).status).toBe(404);
    const form = await call("/api/threads", {
      method: "POST",
      headers: { ...(await as()), "content-type": "text/plain" },
      body: "{}",
    });
    expect(form.status).toBe(415);
    expect((await call("/api/threads")).status).toBe(405);
    expect(restateCalls).toHaveLength(0);
  });

  it("the old passkey routes are gone; everything else is the static app", async () => {
    expect(await (await post("/auth/login/options", {})).text()).toContain("app");
    expect(await (await call("/")).text()).toContain("app");
  });
});

describe("the lander's marketing calls", () => {
  it("pass to the Marketing service as they are, without a sign-in", async () => {
    const res = await post("/marketing/prefs", { token: "t" });
    expect(res.status).toBe(200);
    expect(restateCalls[0]?.url).toBe("https://restate.test/Marketing/prefs");
    expect(restateCalls[0]?.headers.get("authorization")).toBe("Bearer rt");
  });

  it("only its four handlers, only POSTed JSON", async () => {
    expect((await post("/marketing/withdraw", {})).status).toBe(404);
    expect((await call("/marketing/prefs")).status).toBe(405);
    const form = await call("/marketing/set", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "a=1",
    });
    expect(form.status).toBe(415);
    expect(restateCalls).toHaveLength(0);
  });
});

describe("the lander's calendar calls", () => {
  it("pass to the Calendar service as they are, its five handlers only", async () => {
    const res = await post("/calendar/book", { offer: "intro" });
    expect(res.status).toBe(200);
    expect(restateCalls[0]?.url).toBe("https://restate.test/Calendar/book");
    expect((await post("/calendar/remind", {})).status).toBe(404);
    expect((await call("/calendar/slots")).status).toBe(405);
    expect(restateCalls).toHaveLength(1);
  });
});

describe("the door", () => {
  const TOKEN = "a".repeat(43);

  it("passes a hook's JSON or form to the Spine and answers its status", async () => {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.endsWith("/SmsEvents/signer")) {
        signerCalls += 1;
        return Response.json(signer(JSON.parse(String(init.body))));
      }
      restateCalls.push({ url, headers: new Headers(init.headers), body: String(init.body) });
      return Response.json({ status: 202, subject: "form:jane@example.com" });
    });
    const res = await post(`/hooks/${TOKEN}`, { email: "jane@example.com" });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ subject: "form:jane@example.com" });
    expect(restateCalls[0]?.url).toBe("https://restate.test/Spine/hook");
    expect(JSON.parse(restateCalls[0]?.body ?? "")).toEqual({
      token: TOKEN,
      payload: { email: "jane@example.com" },
    });
    await call(`/hooks/${TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=jane%40example.com&name=Jane",
    });
    expect(JSON.parse(restateCalls[1]?.body ?? "").payload).toEqual({
      email: "jane@example.com",
      name: "Jane",
    });
  });

  it("turns away a malformed token, a bad body and a GET before Restate", async () => {
    expect((await post("/hooks/short", {})).status).toBe(404);
    expect((await call(`/hooks/${TOKEN}`, { method: "POST", body: "{nope" })).status).toBe(415);
    expect((await call(`/hooks/${TOKEN}`)).status).toBe(405);
    expect(restateCalls).toHaveLength(0);
  });

  it("answers 502 when Restate fails", async () => {
    restateStatus = 500;
    expect((await post(`/hooks/${TOKEN}`, { email: "x" })).status).toBe(502);
  });
});

describe("review links", () => {
  const LINK = "/r/acme/abcdEFGH1234_-xyzABCDEF";
  const reply = (body: unknown) =>
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.endsWith("/SmsEvents/signer")) {
        signerCalls += 1;
        return Response.json(signer(JSON.parse(String(init.body))));
      }
      restateCalls.push({ url, headers: new Headers(init.headers), body: String(init.body) });
      return Response.json(body);
    });

  it("a click is counted and goes on to the review form; an unknown link is 404", async () => {
    reply({ to: "https://search.google.com/local/writereview?placeid=P1" });
    const res = await call(LINK);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://search.google.com/local/writereview?placeid=P1",
    );
    expect(restateCalls[0]?.url).toBe("https://restate.test/Reviews/click");
    expect(JSON.parse(restateCalls[0]?.body ?? "")).toEqual({
      client: "acme",
      token: "abcdEFGH1234_-xyzABCDEF",
    });
    reply({ to: null });
    expect((await call(LINK)).status).toBe(404);
  });

  it("a link preview counts nothing; a bad path never reaches Restate", async () => {
    const res = await call(LINK, { headers: { "user-agent": "facebookexternalhit/1.1" } });
    expect(res.status).toBe(200);
    expect((await call("/r/acme/short")).status).toBe(200); // the static app
    expect((await call(LINK, { method: "POST" })).status).toBe(405);
    expect(restateCalls).toHaveLength(0);
  });

  it("the feedback form shows, and its words go to Reviews/feedback", async () => {
    const form = await call(`${LINK}/feedback`);
    expect(await form.text()).toContain('name="words"');
    reply({ ok: true });
    const res = await call(`${LINK}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "words=Parking+was+hard",
    });
    expect(await res.text()).toContain("Thanks");
    expect(restateCalls[0]?.url).toBe("https://restate.test/Reviews/feedback");
    expect(JSON.parse(restateCalls[0]?.body ?? "").words).toBe("Parking was hard");
  });

  it("answers 502 when Restate fails", async () => {
    restateStatus = 500;
    expect((await call(LINK)).status).toBe(502);
  });
});

describe("credential links", () => {
  const sealed = { label: "example", iv: "AAAAAAAAAAAAAAAA", data: "c2VhbGVk" };
  async function mint(body: unknown, secret = "link-secret") {
    const raw = JSON.stringify(body);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)),
    );
    const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
    return call("/links", { method: "POST", headers: { [LINK_SIGNATURE]: hex }, body: raw });
  }

  it("a signed mint keeps the ciphertext 10 minutes under a random id", async () => {
    const res = await mint({ ...sealed, at: Date.now() });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(kv.get(id)).toEqual({ value: JSON.stringify({ ...sealed, open: false }), ttl: 600 });
  });

  it("refuses a bad signature, a stale body, a bad shape, and minting with no secret", async () => {
    expect((await mint({ ...sealed, at: Date.now() }, "wrong")).status).toBe(401);
    expect((await mint({ ...sealed, at: Date.now() - 10 * 60_000 })).status).toBe(401);
    expect((await mint({ ...sealed, data: "<html>", at: Date.now() })).status).toBe(400);
    expect((await mint({ ...sealed, label: "a/b", at: Date.now() })).status).toBe(400);
    expect((await mint({ ...sealed, ttl: 30, at: Date.now() })).status).toBe(400);
    expect((await mint({ ...sealed, ttl: 8 * 24 * 3600, at: Date.now() })).status).toBe(400);
    expect((await mint({ ...sealed, open: "yes", at: Date.now() })).status).toBe(400);
    expect((await call("/links")).status).toBe(405);
    delete env.CRED_LINK_SECRET;
    expect((await mint({ ...sealed, at: Date.now() })).status).toBe(503);
    expect(kv.size).toBe(0);
  });

  it("the page loads for any id and consumes nothing", async () => {
    const { id } = (await (await mint({ ...sealed, at: Date.now() })).json()) as { id: string };
    let served = "";
    env.ASSETS = {
      fetch: async (r: Request) => {
        served = new URL(r.url).pathname;
        return new Response("<html>link</html>");
      },
    } as unknown as Fetcher;
    expect(await (await call(`/c/${id}`)).text()).toContain("link");
    expect(served).toBe("/c");
    expect(kv.has(id)).toBe(true);
  });

  it("an operator sees the site, then takes it once; nobody else learns it exists", async () => {
    const { id } = (await (await mint({ ...sealed, at: Date.now() })).json()) as { id: string };
    expect((await post(`/api/links/${id}/take`, {})).status).toBe(401);
    expect((await post(`/api/links/${id}/take`, {}, await as({ operator: false }))).status).toBe(
      403,
    );
    expect(kv.has(id)).toBe(true);
    const peek = await post(`/api/links/${id}`, {}, await as());
    expect(await peek.json()).toEqual({ label: "example", open: false });
    const take = await post(`/api/links/${id}/take`, {}, await as());
    expect(take.status).toBe(200);
    expect(await take.json()).toEqual(sealed);
    expect(kv.has(id)).toBe(false);
    expect((await post(`/api/links/${id}/take`, {}, await as())).status).toBe(404);
    expect((await post("/api/links/nope/take", {}, await as())).status).toBe(404);
    expect((await post(`/api/links/${id}/drop`, {}, await as())).status).toBe(404);
    expect(restateCalls).toHaveLength(0);
  });

  it("an open link opens once for anyone with it, for its own TTL", async () => {
    const res = await mint({ ...sealed, open: true, ttl: 86_400, at: Date.now() });
    const { id } = (await res.json()) as { id: string };
    expect(kv.get(id)?.ttl).toBe(86_400);
    expect(await (await post(`/api/links/${id}`, {})).json()).toEqual({
      label: "example",
      open: true,
    });
    const take = await post(`/api/links/${id}/take`, {});
    expect(await take.json()).toEqual(sealed);
    expect(kv.has(id)).toBe(false);
    // Gone, it looks like any id: no sign-in, no answer.
    expect((await post(`/api/links/${id}/take`, {})).status).toBe(401);
  });
});

describe("body cap", () => {
  /** A body streamed 1 KB at a time, counting what the Worker pulled. */
  function stream(total: number) {
    const chunk = new Uint8Array(1024).fill(0x61);
    const seen = { pulled: 0 };
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (seen.pulled >= total) return c.close();
        seen.pulled += chunk.byteLength;
        c.enqueue(chunk);
      },
    });
    return { body, seen };
  }

  it("cuts an unsigned stream off at the cap instead of buffering it", async () => {
    const { body, seen } = stream(8 * 1024 * 1024);
    const res = await call("/webhooks/telnyx", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(seen.pulled).toBeLessThan(256 * 1024);
  });

  it("counts bytes, not characters", async () => {
    const res = await call("/webhooks/telnyx", { method: "POST", body: "€".repeat(30_000) });
    expect(res.status).toBe(413);
  });

  it("refuses a declared length past the cap unread", async () => {
    const res = await call("/links", {
      method: "POST",
      headers: { "content-length": String(1024 * 1024) },
      body: "{}",
    });
    expect(res.status).toBe(413);
  });
});
