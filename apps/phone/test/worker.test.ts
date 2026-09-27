/**
 * The Worker with fake bindings: webhooks are signature-checked and forwarded
 * once per event id, the API is closed without a session and open with one, and
 * a device joins only through the setup token. WebAuthn's own verification is
 * the library's; it is stubbed here so the flow around it is what is tested.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(async () => ({ challenge: "regchallenge" })),
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: "authchallenge" })),
  verifyRegistrationResponse: vi.fn(
    async ({ expectedChallenge }: { expectedChallenge: string }) => ({
      verified: expectedChallenge === "regchallenge",
      registrationInfo: {
        credential: { id: "cred1", publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
      },
    }),
  ),
  verifyAuthenticationResponse: vi.fn(
    async ({ expectedChallenge }: { expectedChallenge: string }) => ({
      verified: expectedChallenge === "authchallenge",
      authenticationInfo: { newCounter: 7 },
    }),
  ),
}));

const { default: worker, DESK_HANDLERS } = await import("../src/worker.js");

import type { Env } from "../src/env.js";

const HOST = "https://phone.test";
const kv = new Map<string, string>();
let restateCalls: { url: string; headers: Headers; body: string }[] = [];
let restateStatus = 200;
let keys: CryptoKeyPair;
let env: Env;

function b64(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

beforeEach(async () => {
  kv.clear();
  restateCalls = [];
  restateStatus = 200;
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer;
  env = {
    ASSETS: { fetch: async () => new Response("<html>app</html>") } as unknown as Fetcher,
    CREDS: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
    } as unknown as KVNamespace,
    SESSION_SECRET: "s3cret",
    SETUP_TOKEN: "join-me",
    TELNYX_PUBLIC_KEY: b64(pub),
    RESTATE_INGRESS_URL: "https://restate.test/",
    RESTATE_AUTH_TOKEN: "rt",
  };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
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
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0] as string;

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

describe("passkeys and the desk", () => {
  async function join(): Promise<string> {
    const opts = await post("/auth/register/options", { setup: "join-me" });
    expect(opts.status).toBe(200);
    const res = await post(
      "/auth/register/verify",
      { setup: "join-me", label: "iPhone", response: { id: "cred1" } },
      { cookie: cookieOf(opts) },
    );
    expect(res.status).toBe(200);
    return cookieOf(res);
  }

  it("the API is closed without a session", async () => {
    expect((await post("/api/threads", {})).status).toBe(401);
    expect(restateCalls).toHaveLength(0);
  });

  it("only the setup token adds a device", async () => {
    expect((await post("/auth/register/options", { setup: "guess" })).status).toBe(403);
    expect((await post("/auth/register/options", {})).status).toBe(403);
    await join();
    expect(JSON.parse(kv.get("cred:cred1") as string)).toMatchObject({
      label: "iPhone",
      counter: 0,
    });
  });

  it("a joined device reaches the desk; a later sign-in updates the counter", async () => {
    const session = await join();
    const res = await post("/api/reply", { contactId: 3, body: "hi" }, { cookie: session });
    expect(res.status).toBe(200);
    expect(restateCalls[0]?.url).toBe("https://restate.test/SmsDesk/reply");
    expect(JSON.parse(restateCalls[0]?.body as string)).toEqual({ contactId: 3, body: "hi" });

    const opts = await post("/auth/login/options", {});
    const login = await post(
      "/auth/login/verify",
      { response: { id: "cred1" } },
      { cookie: cookieOf(opts) },
    );
    expect(login.status).toBe(200);
    expect(cookieOf(login)).toMatch(/^wren_session=/);
    expect(JSON.parse(kv.get("cred:cred1") as string).counter).toBe(7);
  });

  it("an unknown passkey, a missing challenge or a forged cookie is refused", async () => {
    const opts = await post("/auth/login/options", {});
    expect(
      (await post("/auth/login/verify", { response: { id: "nope" } }, { cookie: cookieOf(opts) }))
        .status,
    ).toBe(403);
    await join();
    expect((await post("/auth/login/verify", { response: { id: "cred1" } })).status).toBe(400);
    expect(
      (await post("/api/threads", {}, { cookie: "wren_session=operator.9999999999.forged" }))
        .status,
    ).toBe(401);
  });

  it("only the app's handlers are open, and only as JSON", async () => {
    const session = await join();
    expect(DESK_HANDLERS.has("enroll")).toBe(false);
    expect(
      (await post("/api/enroll", { sequence: "x", limit: 5 }, { cookie: session })).status,
    ).toBe(404);
    const form = await call("/api/threads", {
      method: "POST",
      headers: { cookie: session, "content-type": "text/plain" },
      body: "{}",
    });
    expect(form.status).toBe(415);
    expect(restateCalls).toHaveLength(0);
  });

  it("everything else is the static app", async () => {
    expect(await (await call("/")).text()).toContain("app");
  });
});
