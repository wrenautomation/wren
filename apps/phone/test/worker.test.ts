/**
 * The Worker with fake bindings: webhooks are signature-checked and forwarded
 * once per event id, and the desk opens only for a valid token from Wren's
 * sign-in that names an operator.
 */
import { forgetKeys } from "@wren/auth/verify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import worker, { DESK_HANDLERS } from "../src/worker.js";

const HOST = "https://phone.test";
const AUTH = "https://auth.test";
let restateCalls: { url: string; headers: Headers; body: string }[] = [];
let restateStatus = 200;
let keys: CryptoKeyPair;
let env: Env;

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
  restateCalls = [];
  restateStatus = 200;
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer;
  env = {
    ASSETS: { fetch: async () => new Response("<html>app</html>") } as unknown as Fetcher,
    AUTH_ORIGIN: AUTH,
    TELNYX_PUBLIC_KEY: b64(pub),
    RESTATE_INGRESS_URL: "https://restate.test/",
    RESTATE_AUTH_TOKEN: "rt",
  };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url === `${AUTH}/api/auth/jwks`) {
      const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
      return Response.json({ keys: [{ ...jwk, kid: "k1" }] });
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

async function signedWebhook(body: string, at = Math.floor(Date.now() / 1000)) {
  const sig = await crypto.subtle.sign(
    { name: "Ed25519" },
    keys.privateKey,
    new TextEncoder().encode(`${at}|${body}`),
  );
  return call("/webhooks/telnyx", {
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

  it("answers 502 when Restate fails, so Telnyx retries; 503 with no key configured", async () => {
    restateStatus = 500;
    expect((await signedWebhook(body)).status).toBe(502);
    delete env.TELNYX_PUBLIC_KEY;
    expect((await signedWebhook(body)).status).toBe(503);
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
