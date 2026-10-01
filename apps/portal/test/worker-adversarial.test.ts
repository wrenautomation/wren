/**
 * Adversarial cases for the Worker: tokens shaped the ways our sign-in might send
 * them (or an attacker might), odd requests at the API edge, and the demo
 * cache. Same fakes as worker.test.ts.
 */

import { forgetKeys } from "@wren/auth/verify";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import worker from "../src/worker.js";

const AUTH = "https://auth.test";
const AUD = "wren";
let keys: CryptoKeyPair;
let rotated: CryptoKeyPair;
let published: { kid: string; key: CryptoKey }[];
let restate: { url: string; body: Record<string, unknown> }[];
let restateReply: () => Response;

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
    email: "owner@client.example",
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
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const signedIn = async (claims: Record<string, unknown>, route = "me", kid?: string) => {
  const t = await token(claims, kid);
  return worker.fetch(post("app.test", route, {}, { authorization: `Bearer ${t}` }), env());
};

const gen = async () =>
  (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;

beforeAll(async () => {
  keys = await gen();
  rotated = await gen();
});

beforeEach(() => {
  forgetKeys();
  restate = [];
  restateReply = () => Response.json({ ok: true });
  published = [{ kid: "k1", key: keys.publicKey }];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `${AUTH}/api/auth/jwks`) {
      const out = [];
      for (const p of published)
        out.push({ ...(await crypto.subtle.exportKey("jwk", p.key)), kid: p.kid });
      return Response.json({ keys: out });
    }
    restate.push({ url, body: JSON.parse(String(init?.body)) });
    return restateReply();
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("tokens", () => {
  it("aud as a plain string is accepted", async () => {
    expect((await signedIn({ aud: AUD })).status).toBe(200);
  });

  it("no email claim (a service token) is refused", async () => {
    expect((await signedIn({ email: undefined, common_name: "svc" })).status).toBe(401);
    expect((await signedIn({ email: "   " })).status).toBe(401);
    expect(restate).toEqual([]);
  });

  it("an operator's email is lowercased; only operator: true marks one", async () => {
    await signedIn({ email: "  WILLIAM@wren.EXAMPLE ", operator: "true" });
    expect(restate[0]?.body.viewer).toEqual({ email: "william@wren.example" });
    await signedIn({ email: "  WILLIAM@wren.EXAMPLE ", operator: true });
    expect(restate[1]?.body.viewer).toEqual({ email: "william@wren.example", operator: true });
  });

  it("no subject is refused", async () => {
    expect((await signedIn({ sub: undefined })).status).toBe(401);
  });

  it("an RS256 token is refused, whatever it carries", async () => {
    const t = await token({});
    const [, p, sig] = t.split(".");
    const res = await worker.fetch(
      post(
        "app.test",
        "me",
        {},
        { authorization: `Bearer ${enc({ alg: "RS256", kid: "k1" })}.${p}.${sig}` },
      ),
      env(),
    );
    expect(res.status).toBe(401);
  });

  it("an aud array that only contains another app's tag is refused", async () => {
    expect((await signedIn({ aud: ["other", `${AUD}x`] })).status).toBe(401);
  });

  it("a rotated-in key is picked up", async () => {
    await signedIn({});
    published = [
      { kid: "k1", key: keys.publicKey },
      { kid: "k2", key: rotated.publicKey },
    ];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * 60_000);
    const t = await token({}, "k2", rotated.privateKey);
    const res = await worker.fetch(
      post("app.test", "me", {}, { authorization: `Bearer ${t}` }),
      env(),
    );
    expect(res.status).toBe(200);
  });

  it("a removed key stops working after the hourly refresh", async () => {
    await signedIn({});
    published = [{ kid: "k2", key: rotated.publicKey }];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 61 * 60_000);
    expect((await signedIn({})).status).toBe(401);
  });

  it("exp exactly now is refused; nbf a little ahead is allowed, far ahead refused", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect((await signedIn({ exp: now })).status).toBe(401);
    expect((await signedIn({ nbf: now + 30 })).status).toBe(200);
    expect((await signedIn({ nbf: now + 600 })).status).toBe(401);
  });

  it("exp as a string is refused", async () => {
    expect((await signedIn({ exp: "9999999999" })).status).toBe(401);
  });

  it("a cookie alone signs nobody in", async () => {
    const t = await token({});
    const res = await worker.fetch(
      post("app.test", "me", {}, { cookie: `__Secure-better-auth.session_token=${t}` }),
      env(),
    );
    expect(res.status).toBe(401);
  });

  it("a demo-host token is irrelevant: the demo host never becomes a login", async () => {
    const t = await token({ email: "william@wren.example" });
    await worker.fetch(post("demo.test", "me", {}, { authorization: `Bearer ${t}` }), env());
    expect(restate[0]?.body.viewer).toEqual({ demo: true });
  });
});

describe("requests", () => {
  it("a JSON content type with a charset is accepted", async () => {
    const res = await worker.fetch(
      post("demo.test", "me", {}, { "content-type": "application/json; charset=utf-8" }),
      env(),
    );
    expect(res.status).toBe(200);
  });

  it("a trailing slash, an encoded name, HEAD and OPTIONS never reach Restate", async () => {
    const bad = [
      post("demo.test", "me/"),
      post("demo.test", "m%65"),
      post("demo.test", "ME"),
      new Request("https://demo.test/api/me", { method: "HEAD" }),
      new Request("https://demo.test/api/me", { method: "OPTIONS" }),
      new Request("https://demo.test/api/me", { method: "PUT", body: "{}" }),
    ];
    for (const r of bad) expect((await worker.fetch(r, env())).status).toBeGreaterThanOrEqual(400);
    expect(restate).toEqual([]);
  });

  it("null, a string or a number body is refused; an empty body is {}", async () => {
    for (const b of ["null", '"x"', "1", "{"])
      expect((await worker.fetch(post("demo.test", "me", b), env())).status).toBe(400);
    expect((await worker.fetch(post("demo.test", "me", ""), env())).status).toBe(200);
    expect(restate).toEqual([{ url: expect.any(String), body: { viewer: { demo: true } } }]);
  });

  it("a __proto__ or nested viewer never wins", async () => {
    await worker.fetch(
      post("demo.test", "people", '{"__proto__":{"viewer":{"operator":true}},"viewer":{"x":1}}'),
      env(),
    );
    expect(restate[0]?.body.viewer).toEqual({ demo: true });
  });

  // Was a bug: the limit is 16 KiB but counts UTF-16 units, so a multi-byte body three times the size gets through.
  it("the size limit counts bytes", async () => {
    const res = await worker.fetch(post("demo.test", "people", { q: "€".repeat(10_000) }), env());
    expect(res.status).toBe(413);
  });

  // Was a bug: a huge streamed body is read into memory in full before the limit is checked.
  it("a streamed body over the limit is not read to the end", async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode(`{"q":"${"a".repeat(64 * 1024)}`);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (pulled >= 4 * 1024 * 1024) return c.close();
        pulled += chunk.length;
        c.enqueue(chunk);
      },
    });
    const req = new Request("https://demo.test/api/people", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const res = await worker.fetch(req, env());
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(256 * 1024);
  });

  it("Restate's error status and body pass through; unreachable is 502", async () => {
    restateReply = () => Response.json({ message: "this login has no client" }, { status: 403 });
    const res = await signedIn({});
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "this login has no client" });
    restateReply = () => {
      throw new TypeError("fetch failed");
    };
    expect((await signedIn({})).status).toBe(502);
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

  it("different routes with the same body never share an answer", async () => {
    await worker.fetch(post("demo.test", "overview"), env());
    await worker.fetch(post("demo.test", "health"), env());
    expect(restate).toHaveLength(2);
  });

  it("a browser-sent viewer can't pick a different cache entry than the demo's", async () => {
    await worker.fetch(post("demo.test", "me"), env());
    await worker.fetch(post("demo.test", "me", { viewer: { email: "x@y.z" } }), env());
    expect(restate).toHaveLength(1);
  });

  it("an app-host login is never answered from the demo cache, even on the same body", async () => {
    await worker.fetch(post("demo.test", "overview", { client: "demo" }), env());
    const t = await token({});
    const res = await worker.fetch(
      post("app.test", "overview", { client: "demo" }, { authorization: `Bearer ${t}` }),
      env(),
    );
    expect(res.status).toBe(200);
    expect(restate).toHaveLength(2);
  });

  it("a 4xx is never kept", async () => {
    restateReply = () => Response.json({ message: "no demo" }, { status: 404 });
    await worker.fetch(post("demo.test", "me"), env());
    restateReply = () => Response.json({ ok: true });
    const res = await worker.fetch(post("demo.test", "me"), env());
    expect(res.status).toBe(200);
    expect(restate).toHaveLength(2);
  });

  it("the cached answer is not cacheable by the browser or a shared proxy", async () => {
    await worker.fetch(post("demo.test", "me"), env());
    const hit = await worker.fetch(post("demo.test", "me"), env());
    expect(hit.headers.get("cache-control")).toBe("no-store");
  });
});
