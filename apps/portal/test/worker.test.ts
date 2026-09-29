/**
 * The Worker with fake bindings and a fake Restate: the viewer is always the
 * Worker's own (demo by host, or the email a valid Access token carries), the
 * API is closed for anything short of a valid token, and the demo is served
 * from the edge cache the second time.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetKeys } from "../src/access.js";
import type { Env } from "../src/env.js";
import worker from "../src/worker.js";

const TEAM = "wren.cloudflareaccess.com";
const AUD = "aud-tag";
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
  const head = enc({ alg: "RS256", kid, typ: "JWT" });
  const body = enc({
    aud: [AUD],
    iss: `https://${TEAM}`,
    exp: Math.floor(Date.now() / 1000) + 600,
    email: "Owner@Client.example",
    ...claims,
  });
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${head}.${body}`),
  );
  let bin = "";
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return `${head}.${body}.${enc(bin)}`;
}

const env = (over: Partial<Env> = {}): Env => ({
  ASSETS: { fetch: async () => new Response("app") } as unknown as Fetcher,
  DEMO_HOST: "demo.test",
  RESTATE_INGRESS_URL: "https://restate.test:8080/",
  RESTATE_AUTH_TOKEN: "rt",
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  OPERATOR_EMAILS: "william@wren.example, Ops@Wren.example",
  ...over,
});

const post = (host: string, route: string, body: unknown = {}, headers: HeadersInit = {}) =>
  new Request(`https://${host}/api/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
});

beforeEach(() => {
  forgetKeys();
  restate = [];
  restateStatus = 200;
  certFetches = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) {
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
    expect((await worker.fetch(post("demo.test", "reset"), env())).status).toBe(404);
    const get = new Request("https://demo.test/api/me");
    expect((await worker.fetch(get, env())).status).toBe(405);
    const form = new Request("https://demo.test/api/me", { method: "POST", body: "a=1" });
    expect((await worker.fetch(form, env())).status).toBe(415);
    expect((await worker.fetch(post("demo.test", "me", [1]), env())).status).toBe(400);
    expect(restate).toEqual([]);
  });

  it("anything else is the app", async () => {
    const res = await worker.fetch(new Request("https://app.test/people"), env());
    expect(await res.text()).toBe("app");
  });
});

describe("the demo host", () => {
  it("is always the demo viewer, whatever the browser sends", async () => {
    const res = await worker.fetch(
      post("demo.test", "people", { viewer: { email: "william@wren.example", operator: true } }),
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
});

describe("the app host", () => {
  it("refuses everything until Access is set up", async () => {
    const res = await worker.fetch(post("app.test", "me"), env({ ACCESS_AUD: "" }));
    expect(res.status).toBe(503);
    expect(restate).toEqual([]);
  });

  it("with no token, asks to sign in", async () => {
    expect((await worker.fetch(post("app.test", "me"), env())).status).toBe(401);
  });

  it("passes the token's email, lowercased, and the browser's viewer is ignored", async () => {
    const t = await token({});
    const res = await worker.fetch(
      post(
        "app.test",
        "overview",
        { client: "acme", viewer: { demo: true } },
        {
          "cf-access-jwt-assertion": t,
        },
      ),
      env(),
    );
    expect(res.status).toBe(200);
    expect(restate[0]?.body).toEqual({ client: "acme", viewer: { email: "owner@client.example" } });
  });

  it("marks an operator", async () => {
    const t = await token({ email: "ops@wren.example" });
    await worker.fetch(post("app.test", "me", {}, { "cf-access-jwt-assertion": t }), env());
    expect(restate[0]?.body).toEqual({ viewer: { email: "ops@wren.example", operator: true } });
  });

  it("refuses a token with the wrong audience, issuer, expiry, key or signature", async () => {
    const other = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const good = await token({});
    const [h, p] = good.split(".");
    const bad = [
      await token({ aud: ["someone-else"] }),
      await token({ iss: "https://evil.cloudflareaccess.com" }),
      await token({ exp: Math.floor(Date.now() / 1000) - 5 }),
      await token({}, "k2"),
      await token({}, "k1", other.privateKey),
      `${h}.${p}.`,
      `${enc({ alg: "none", kid: "k1" })}.${p}.`,
      "not-a-token",
    ];
    for (const t of bad) {
      const res = await worker.fetch(
        post("app.test", "me", {}, { "cf-access-jwt-assertion": t }),
        env(),
      );
      expect(res.status, t.slice(0, 30)).toBe(401);
    }
    expect(restate).toEqual([]);
  });

  it("a made-up key id refetches the keys at most once a minute", async () => {
    for (const kid of ["x1", "x2", "x3"]) {
      const t = await token({}, kid);
      await worker.fetch(post("app.test", "me", {}, { "cf-access-jwt-assertion": t }), env());
    }
    expect(certFetches).toBe(1);
  });

  it("passes Restate's refusal through", async () => {
    restateStatus = 403;
    const t = await token({});
    const res = await worker.fetch(
      post("app.test", "me", {}, { "cf-access-jwt-assertion": t }),
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
    const a = await worker.fetch(post("demo.test", "people", { filter: "moved" }), env());
    const b = await worker.fetch(post("demo.test", "people", { filter: "moved" }), env());
    expect(await b.json()).toEqual(await a.json());
    expect(restate).toHaveLength(1);
    await worker.fetch(post("demo.test", "people", { filter: "hiring" }), env());
    expect(restate).toHaveLength(2);
  });

  it("never keeps an error", async () => {
    restateStatus = 500;
    await worker.fetch(post("demo.test", "me"), env());
    await worker.fetch(post("demo.test", "me"), env());
    expect(restate).toHaveLength(2);
  });

  it("never serves the app host from it", async () => {
    await worker.fetch(post("demo.test", "me"), env());
    const t = await token({});
    await worker.fetch(post("app.test", "me", {}, { "cf-access-jwt-assertion": t }), env());
    expect(restate).toHaveLength(2);
  });
});
