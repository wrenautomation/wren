/**
 * Keys at the edge (designs/2026-10-07-key-store.md): a pasted key goes to the sign-in Lambda
 * with the edge secret and the checked viewer, never to Restate; a route that takes a ref is
 * refused a raw key before Restate journals it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import { keyStage, rawKeyRefusal } from "../src/keys.js";
import worker from "../src/worker.js";

const KEY = "sk_live_synthetic0000000000";
const env = (over: { [K in keyof Env]?: Env[K] | undefined } = {}): Env =>
  ({
    ASSETS: { fetch: async () => new Response("app") } as unknown as Fetcher,
    DEMO_HOST: "demo.test",
    RESTATE_INGRESS_URL: "https://restate.test:8080/",
    AUTH_ORIGIN: "https://auth.test",
    LAMBDA_URL: "https://lambda.test/",
    EDGE_SECRET: "edge-s3cret",
    ...over,
  }) as Env;
const req = (body: unknown, init: RequestInit = {}) =>
  new Request("https://app.test/api/keys/stage", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" },
    body: JSON.stringify(body),
    ...init,
  });
const signedIn = async () => ({ email: "owner@client.example" });

let sent: { url: string; headers: Headers; body: string }[];
beforeEach(() => {
  sent = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: String(init?.body),
    });
    return Response.json({ ref: `ks_${"0a".repeat(16)}`, last4: "0000" });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("keyStage", () => {
  it("passes the key to the sign-in Lambda with the edge secret and who is signed in", async () => {
    const res = await keyStage(
      req({ client: "acme", name: "STRIPE_SECRET_KEY", value: KEY, viewer: "forged" }),
      env(),
      { kind: "app" },
      signedIn,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ref: `ks_${"0a".repeat(16)}`, last4: "0000" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://lambda.test/api/keys/stage");
    expect(sent[0]?.headers.get("x-wren-edge")).toBe("edge-s3cret");
    expect(sent[0]?.headers.get("x-wren-viewer")).toBe("owner@client.example");
    expect(sent[0]?.headers.get("x-wren-ip")).toBe("203.0.113.9");
    expect(JSON.parse(sent[0]?.body ?? "{}")).toEqual({
      client: "acme",
      name: "STRIPE_SECRET_KEY",
      value: KEY,
    });
  });

  it("a client's host saves for that client only", async () => {
    await keyStage(
      req({ client: "beta", name: "STRIPE_SECRET_KEY", value: KEY }),
      env(),
      { kind: "client", client: "acme" },
      signedIn,
    );
    expect(JSON.parse(sent[0]?.body ?? "{}").client).toBe("acme");
  });

  it("refuses the demo, a GET, a form, no sign-in and no Lambda; nothing leaves", async () => {
    const no = async () => Response.json({ error: "Sign in." }, { status: 401 });
    const cases: [Promise<Response>, number][] = [
      [keyStage(req({}), env(), { kind: "demo" }, signedIn), 401],
      [
        keyStage(new Request("https://app.test/api/keys/stage"), env(), { kind: "app" }, signedIn),
        405,
      ],
      [
        keyStage(
          req({}, { headers: { "content-type": "text/plain" } }),
          env(),
          { kind: "app" },
          signedIn,
        ),
        415,
      ],
      [keyStage(req({ value: KEY }), env(), { kind: "app" }, no), 401],
      [
        keyStage(req({ value: KEY }), env({ EDGE_SECRET: undefined }), { kind: "app" }, signedIn),
        503,
      ],
      [keyStage(req({ value: "x".repeat(6000) }), env(), { kind: "app" }, signedIn), 413],
    ];
    for (const [res, status] of cases) {
      const r = await res;
      expect(r.status).toBe(status);
      expect(await r.text()).not.toContain(KEY);
    }
    expect(sent).toEqual([]);
  });
});

describe("raw keys on ref routes", () => {
  it("refuses a key where a ref goes, before Restate; a ref passes", () => {
    const refused = rawKeyRefusal("payments/connect", { client: "acme", key: KEY });
    expect(refused?.status).toBe(400);
    expect(rawKeyRefusal("accounts/setVendor", { keyRef: KEY })?.status).toBe(400);
    expect(rawKeyRefusal("payments/connect", { keyRef: `ks_${"0a".repeat(16)}` })).toBeNull();
    expect(rawKeyRefusal("notes/save", { body: KEY })).toBeNull();
  });

  it("the Worker refuses one on payments/connect without calling Restate or checking sign-in", async () => {
    const res = await worker.fetch(
      new Request("https://app.test/api/payments/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client: "acme", keyRef: KEY }),
      }),
      env(),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(KEY);
    expect(sent).toEqual([]);
  });
});
