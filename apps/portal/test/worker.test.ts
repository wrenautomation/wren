/**
 * The Worker with fake bindings and a fake Restate: the viewer is always the
 * Worker's own (demo by host, or the email a valid token carries), the
 * API is closed for anything short of a valid token, and the demo is served
 * from the edge cache the second time.
 */

import { forgetKeys } from "@wren/auth/verify";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import worker from "../src/worker.js";

const AUTH = "https://auth.test";
const AUD = "wren";
let keys: CryptoKeyPair;
let restate: { url: string; body: Record<string, unknown> }[];
let restateStatus: number;
let certFetches: number;

const enc = (v: unknown) =>
  btoa(typeof v === "string" ? v : JSON.stringify(v))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function token(claims: Record<string, unknown>, kid = "k1", key = keys.privateKey) {
  const head = enc({ alg: "EdDSA", kid, typ: "JWT" });
  const body = enc({
    aud: [AUD],
    iss: AUTH,
    sub: "u1",
    exp: Math.floor(Date.now() / 1000) + 600,
    email: "Owner@Client.example",
    ...claims,
  });
  const sig = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(`${head}.${body}`));
  let bin = "";
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return `${head}.${body}.${enc(bin)}`;
}

const env = (over: Partial<Env> = {}): Env => ({
  ASSETS: { fetch: async () => new Response("app") } as unknown as Fetcher,
  DEMO_HOST: "demo.test",
  RESTATE_INGRESS_URL: "https://restate.test:8080/",
  RESTATE_AUTH_TOKEN: "rt",
  AUTH_ORIGIN: AUTH,
  ...over,
});

const post = (host: string, route: string, body: unknown = {}, headers: HeadersInit = {}) =>
  new Request(`https://${host}/api/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
});

beforeEach(() => {
  forgetKeys();
  restate = [];
  restateStatus = 200;
  certFetches = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `${AUTH}/api/auth/jwks`) {
      certFetches++;
      const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
      return Response.json({ keys: [{ ...jwk, kid: "k1" }] });
    }
    restate.push({ url, body: JSON.parse(String(init?.body)) });
    return Response.json({ ok: true, route: url.split("/").at(-1) }, { status: restateStatus });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("routes", () => {
  it("an unknown route is 404, a GET 405, a form post 415, an array 400", async () => {
    for (const path of [
      "reset",
      "delivery/reset",
      "nope/me",
      "delivery/me/x",
      "__proto__/me",
      "delivery",
    ])
      expect((await worker.fetch(post("demo.test", path), env())).status).toBe(404);
    const get = new Request("https://demo.test/api/delivery/me");
    expect((await worker.fetch(get, env())).status).toBe(405);
    const form = new Request("https://demo.test/api/delivery/me", { method: "POST", body: "a=1" });
    expect((await worker.fetch(form, env())).status).toBe(415);
    expect((await worker.fetch(post("demo.test", "delivery/me", [1]), env())).status).toBe(400);
    expect(restate).toEqual([]);
  });

  it("the first part names the service", async () => {
    await worker.fetch(post("demo.test", "delivery/home"), env());
    await worker.fetch(post("demo.test", "reactivation/overview"), env());
    expect(restate.map((r) => r.url)).toEqual([
      "https://restate.test:8080/DeliveryPortal/home",
      "https://restate.test:8080/ReactivationPortal/overview",
    ]);
  });

  it("anything else is the app", async () => {
    const res = await worker.fetch(new Request("https://app.test/people"), env());
    expect(await res.text()).toBe("app");
  });
});

describe("the demo host", () => {
  it("is always the demo viewer, whatever the browser sends", async () => {
    const res = await worker.fetch(
      post("demo.test", "reactivation/people", {
        viewer: { email: "william@wren.example", operator: true },
      }),
      env(),
    );
    expect(res.status).toBe(200);
    expect(restate).toEqual([
      {
        url: "https://restate.test:8080/ReactivationPortal/people",
        body: { viewer: { demo: true } },
      },
    ]);
  });

  it("refuses every write before it reaches the service", async () => {
    for (const route of [
      "reactivation/approve",
      "reactivation/skip",
      "delivery/post",
      "delivery/answer",
      "console/setLoop",
      "email/approve",
      "email/drop",
      "email/pause",
      "email/resume",
    ]) {
      const res = await worker.fetch(post("demo.test", route, { enrollmentIds: [1] }), env());
      expect(res.status).toBe(403);
    }
    expect(restate).toEqual([]);
  });
});

describe("the app host", () => {
  it("refuses everything until sign-in is set up", async () => {
    const res = await worker.fetch(post("app.test", "delivery/me"), env({ AUTH_ORIGIN: "" }));
    expect(res.status).toBe(503);
    expect(restate).toEqual([]);
  });

  it("with no token, asks to sign in", async () => {
    expect((await worker.fetch(post("app.test", "delivery/me"), env())).status).toBe(401);
  });

  it("passes the token's email, lowercased; the browser's viewer and origin are ignored", async () => {
    const t = await token({});
    const res = await worker.fetch(
      post(
        "app.test",
        "reactivation/overview",
        { client: "acme", viewer: { demo: true }, from: { ip: "1.2.3.4", agent: "forged" } },
        {
          authorization: `Bearer ${t}`,
        },
      ),
      env(),
    );
    expect(res.status).toBe(200);
    // Where it came from is the edge's to say, like the viewer.
    expect(restate[0]?.body).toEqual({
      client: "acme",
      viewer: { email: "owner@client.example" },
      from: { ip: null, agent: null },
    });
  });

  it("marks an operator", async () => {
    const t = await token({ email: "ops@wren.example", operator: true });
    await worker.fetch(
      post("app.test", "delivery/me", {}, { authorization: `Bearer ${t}` }),
      env(),
    );
    expect(restate[0]?.body).toMatchObject({
      viewer: { email: "ops@wren.example", operator: true },
    });
  });

  it("refuses a token with the wrong audience, issuer, expiry, key or signature", async () => {
    const other = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const good = await token({});
    const [h, p] = good.split(".");
    const bad = [
      await token({ aud: ["someone-else"] }),
      await token({ iss: "https://evil.test" }),
      await token({ exp: Math.floor(Date.now() / 1000) - 5 }),
      await token({}, "k2"),
      await token({}, "k1", other.privateKey),
      `${h}.${p}.`,
      `${enc({ alg: "none", kid: "k1" })}.${p}.`,
      "not-a-token",
    ];
    for (const t of bad) {
      const res = await worker.fetch(
        post("app.test", "delivery/me", {}, { authorization: `Bearer ${t}` }),
        env(),
      );
      expect(res.status, t.slice(0, 30)).toBe(401);
    }
    expect(restate).toEqual([]);
  });

  it("a made-up key id refetches the keys at most once a minute", async () => {
    for (const kid of ["x1", "x2", "x3"]) {
      const t = await token({}, kid);
      await worker.fetch(
        post("app.test", "delivery/me", {}, { authorization: `Bearer ${t}` }),
        env(),
      );
    }
    expect(certFetches).toBe(1);
  });

  it("passes Restate's refusal through", async () => {
    restateStatus = 403;
    const t = await token({});
    const res = await worker.fetch(
      post("app.test", "delivery/me", {}, { authorization: `Bearer ${t}` }),
      env(),
    );
    expect(res.status).toBe(403);
  });
});

describe("the demo cache", () => {
  let store: Map<string, Response>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("caches", {
      default: {
        match: async (r: Request) => store.get(r.url)?.clone(),
        put: async (r: Request, res: Response) => void store.set(r.url, res),
      },
    });
  });

  it("answers the same request from the edge the second time", async () => {
    const a = await worker.fetch(
      post("demo.test", "reactivation/people", { filter: "moved" }),
      env(),
    );
    const b = await worker.fetch(
      post("demo.test", "reactivation/people", { filter: "moved" }),
      env(),
    );
    expect(await b.json()).toEqual(await a.json());
    expect(restate).toHaveLength(1);
    await worker.fetch(post("demo.test", "reactivation/people", { filter: "hiring" }), env());
    expect(restate).toHaveLength(2);
  });

  it("never keeps an error", async () => {
    restateStatus = 500;
    await worker.fetch(post("demo.test", "delivery/me"), env());
    await worker.fetch(post("demo.test", "delivery/me"), env());
    expect(restate).toHaveLength(2);
  });

  it("never serves the app host from it", async () => {
    await worker.fetch(post("demo.test", "delivery/me"), env());
    const t = await token({});
    await worker.fetch(
      post("app.test", "delivery/me", {}, { authorization: `Bearer ${t}` }),
      env(),
    );
    expect(restate).toHaveLength(2);
  });
});
