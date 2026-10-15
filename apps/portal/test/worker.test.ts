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
let restate: { url: string; body: Record<string, unknown>; key: string | null }[];
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
      // As Better Auth publishes it: alg EdDSA (WebCrypto exports Ed25519).
      return Response.json({ keys: [{ ...jwk, alg: "EdDSA", kid: "k1" }] });
    }
    restate.push({
      url,
      body: JSON.parse(String(init?.body)),
      key: new Headers(init?.headers).get("idempotency-key"),
    });
    return Response.json({ ok: true, route: url.split("/").at(-1) }, { status: restateStatus });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pulse", () => {
  it("runs each read as its own call, in order, with the same sign-in", async () => {
    const t = await token({});
    const res = await worker.fetch(
      post(
        "app.test",
        "pulse",
        { calls: [{ path: "console/recordsCounts", body: { n: 1 } }, { path: "delivery/me" }] },
        { authorization: `Bearer ${t}` },
      ),
      env({ APP_HOST: "app.test" } as Partial<Env>),
    );
    const { answers } = (await res.json()) as {
      answers: { status: number; body: { route?: string } }[];
    };
    expect(answers.map((a) => a.status)).toEqual([200, 200]);
    // The reads run at once: the answers keep the calls' order, the requests may not.
    expect(answers.map((a) => a.body.route)).toEqual(["recordsCounts", "me"]);
    expect(restate.map((r) => r.url).sort()).toEqual([
      "https://restate.test:8080/ConsolePortal/recordsCounts",
      "https://restate.test:8080/DeliveryPortal/me",
    ]);
    expect(restate.find((r) => r.url.endsWith("/recordsCounts"))?.body.n).toBe(1);
  });

  it("refuses a batch with no sign-in answer by answer, and a malformed one outright", async () => {
    const res = await worker.fetch(
      post("app.test", "pulse", { calls: [{ path: "delivery/me" }] }),
      env(),
    );
    const { answers } = (await res.json()) as { answers: { status: number }[] };
    expect(answers[0]?.status).toBe(401);
    for (const body of [{}, { calls: [] }, { calls: [{ path: "a/b/c" }] }, { calls: "x" }])
      expect((await worker.fetch(post("demo.test", "pulse", body), env())).status).toBe(400);
    expect(restate).toEqual([]);
  });

  it("a write has no place in a batch", async () => {
    const res = await worker.fetch(
      post("demo.test", "pulse", { calls: [{ path: "console/setPref" }] }),
      env(),
    );
    const { answers } = (await res.json()) as { answers: { status: number }[] };
    expect(answers[0]?.status).toBe(403);
    expect(restate).toEqual([]);
  });
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
    await worker.fetch(post("demo.test", "console/recordsStats"), env());
    expect(restate.map((r) => r.url)).toEqual([
      "https://restate.test:8080/DeliveryPortal/home",
      "https://restate.test:8080/ReactivationPortal/overview",
      "https://restate.test:8080/ConsolePortal/recordsStats",
    ]);
  });

  it("anything else is the app", async () => {
    const res = await worker.fetch(new Request("https://app.test/people"), env());
    expect(await res.text()).toBe("app");
  });

  it("a record id with a slash gets the app shell, not the asset server's redirect", async () => {
    const asked: string[] = [];
    const assets = { fetch: async (r: Request) => (asked.push(r.url), new Response("app")) };
    await worker.fetch(
      new Request("https://app.test/handlers/all/Ads%2Fstart"),
      env({ ASSETS: assets as unknown as Fetcher }),
    );
    expect(asked).toEqual(["https://app.test/"]);
  });

  it("the replay page alone allows inline styles and the lander's images, framed only by the app", async () => {
    const csp = (await worker.fetch(new Request("https://app.test/replay"), env())).headers.get(
      "content-security-policy",
    );
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: https://test");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("script-src 'self';");
  });
});

describe("the demo host", () => {
  it("is always the demo viewer, whatever the browser sends", async () => {
    const res = await worker.fetch(
      post("demo.test", "reactivation/recordsList", {
        viewer: { email: "william@wren.example", operator: true },
      }),
      env(),
    );
    expect(res.status).toBe(200);
    expect(restate).toEqual([
      {
        url: "https://restate.test:8080/ReactivationPortal/recordsList",
        body: { viewer: { demo: true } },
        key: null,
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
      "console/call",
      "console/install",
      "console/uninstall",
      "console/ask",
      "email/approve",
      "email/drop",
      "email/pause",
      "email/resume",
      "books/setAccount",
    ]) {
      const res = await worker.fetch(post("demo.test", route, { ids: [1] }), env());
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
        { client: "acme", viewer: { demo: true }, origin: { ip: "1.2.3.4", agent: "forged" } },
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
      origin: { ip: null, agent: null },
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

  it("view as: Look passes reads on and refuses writes; Act goes on; a bad shape is refused", async () => {
    const t = await token({ email: "ops@wren.example", operator: true });
    const auth = { authorization: `Bearer ${t}` };
    const look = { client: "acme", email: "a@b.test" };
    const read = await worker.fetch(post("app.test", "delivery/me", { viewAs: look }, auth), env());
    expect(read.status).toBe(200);
    expect(restate[0]?.body).toMatchObject({ viewAs: look });
    const write = await worker.fetch(
      post("app.test", "delivery/invite", { viewAs: look, email: "c@d.test" }, auth),
      env(),
    );
    expect(write.status).toBe(403);
    expect(restate).toHaveLength(1);
    const act = await worker.fetch(
      post(
        "app.test",
        "delivery/invite",
        { viewAs: { ...look, act: true }, email: "c@d.test" },
        auth,
      ),
      env(),
    );
    expect(act.status).toBe(200);
    expect(restate).toHaveLength(2);
    const bad = await worker.fetch(
      post("app.test", "delivery/me", { viewAs: "a@b.test" }, auth),
      env(),
    );
    expect(bad.status).toBe(400);
    expect(restate).toHaveLength(2);
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

  it("an action's request id becomes Restate's idempotency key, per login, and leaves the body", async () => {
    const auth = { authorization: `Bearer ${await token({})}` };
    const send = (route: string, body: Record<string, unknown>, a = auth) =>
      worker.fetch(post("app.test", route, body, a), env());
    expect((await send("documents/send", { id: "d1", requestId: "req-0001" })).status).toBe(200);
    await send("documents/send", { id: "d1", requestId: "req-0001" });
    const other = { authorization: `Bearer ${await token({ email: "else@client.example" })}` };
    await send("documents/send", { id: "d1", requestId: "req-0001" }, other);
    // A read keeps no key; a write without an id has none.
    await send("documents/templates", { requestId: "req-0001" });
    await send("documents/send", { id: "d1" });
    const [a, b, c, read, plain] = restate;
    expect(a?.key).toMatch(/^portal:[0-9a-f]{64}$/);
    expect(b?.key).toBe(a?.key);
    expect(c?.key).not.toBe(a?.key);
    expect(read?.key).toBeNull();
    expect(plain?.key).toBeNull();
    for (const r of restate) expect(r.body).not.toHaveProperty("requestId");
  });

  it("refuses a request id that isn't a short token", async () => {
    const auth = { authorization: `Bearer ${await token({})}` };
    for (const requestId of ["short", "has space here", "x".repeat(101), 12])
      expect(
        (await worker.fetch(post("app.test", "documents/send", { requestId }, auth), env())).status,
      ).toBe(400);
    expect(restate).toEqual([]);
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
      post("demo.test", "reactivation/recordsList", { view: "call" }),
      env(),
    );
    const b = await worker.fetch(
      post("demo.test", "reactivation/recordsList", { view: "call" }),
      env(),
    );
    expect(await b.json()).toEqual(await a.json());
    expect(restate).toHaveLength(1);
    await worker.fetch(post("demo.test", "reactivation/recordsList", { view: "warm" }), env());
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

const KEPT = `s3://media-bucket/media/${"a".repeat(32)}.jpg`;

describe("Learn's media", () => {
  let upstream: { url: string; range: string | null }[];
  let asked: Record<string, unknown>[];
  beforeEach(() => {
    upstream = [];
    asked = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${AUTH}/api/auth/jwks`) {
        const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
        return Response.json({ keys: [{ ...jwk, alg: "EdDSA", kid: "k1" }] });
      }
      // Learn's service: item 7 is the client's, with one picture; anything else is no one's.
      if (url.endsWith("/LearnConsole/media")) {
        const body = JSON.parse(String(init?.body)) as { ids: string[]; client?: string };
        asked.push(body);
        if (body.client !== "acme") return Response.json({ error: "no access" }, { status: 403 });
        return Response.json({
          urls: body.ids.includes("7") ? ["https://img.example/a.jpg"] : [],
        });
      }
      // Learn's kept pictures: one signed address for a ref a row names.
      if (url.endsWith("/LearnPictures/sign")) {
        const { ref } = JSON.parse(String(init?.body)) as { ref: string };
        asked.push({ sign: ref });
        return Response.json({ url: ref === KEPT ? "https://store.example/k.jpg?sig=1" : null });
      }
      const range = new Headers(init?.headers).get("range");
      upstream.push({ url, range });
      if (url === "https://store.example/k.jpg?sig=1")
        return new Response("kept", { headers: { "content-type": "image/jpeg" } });
      if (url === "https://img.example/a.jpg")
        return new Response("jpg", { headers: { "content-type": "image/jpeg" } });
      if (url === "https://cdn.example/1.mp3")
        return new Response("mp3", {
          status: range ? 206 : 200,
          headers: {
            "content-type": "application/octet-stream",
            ...(range ? { "content-range": "bytes 0-2/100" } : {}),
          },
        });
      return new Response("<html>", { headers: { "content-type": "text/html" } });
    });
  });

  const grant = async (claims: Record<string, unknown>, body: unknown = {}) => {
    const t = await token(claims);
    return worker.fetch(
      post("app.test", "media/grant", body, { authorization: `Bearer ${t}` }),
      env(),
    );
  };
  const media = (u: string, g: string, headers: HeadersInit = {}) =>
    worker.fetch(
      new Request(`https://app.test/media?u=${encodeURIComponent(u)}&g=${g}`, { headers }),
      env(),
    );

  it("grants an operator, never a client or the demo", async () => {
    expect((await grant({ email: "ops@wren.example", operator: true })).status).toBe(200);
    expect((await grant({})).status).toBe(403);
    expect((await worker.fetch(post("demo.test", "media/grant"), env())).status).toBe(401);
    expect((await worker.fetch(post("app.test", "media/grant"), env())).status).toBe(401);
  });

  it("grants a client's login its own items' media, each address alone", async () => {
    const res = await grant({}, { client: "acme", items: ["7", "8"] });
    expect(res.status).toBe(200);
    // The service is asked as them, for that workspace and those items.
    expect(asked.at(-1)).toMatchObject({
      client: "acme",
      ids: ["7", "8"],
      viewer: { email: "owner@client.example" },
    });
    expect(asked.at(-1)?.viewer).not.toHaveProperty("operator");
    const { grants } = (await res.json()) as { grants: Record<string, string> };
    expect(Object.keys(grants)).toEqual(["https://img.example/a.jpg"]);
    const g = grants["https://img.example/a.jpg"] as string;
    expect((await media("https://img.example/a.jpg", g)).status).toBe(200);
    // Good for that address alone.
    expect((await media("https://cdn.example/1.mp3", g)).status).toBe(403);

    // Another workspace's items: the service refuses, and so does the grant.
    expect((await grant({}, { client: "other", items: ["7"] })).status).toBe(403);
    // Not its item: nothing granted.
    const none = (await (await grant({}, { client: "acme", items: ["8"] })).json()) as {
      grants: Record<string, string>;
    };
    expect(none.grants).toEqual({});
    // No items named, or too many: refused before the service.
    const before = asked.length;
    expect((await grant({}, { client: "acme" })).status).toBe(403);
    expect((await grant({}, { client: "acme", items: [] })).status).toBe(400);
    expect(asked.length).toBe(before);
  });

  it("passes pictures and audio with a grant, ranges through, sandboxed; nothing else", async () => {
    const { grant: g } = (await (
      await grant({ email: "ops@wren.example", operator: true })
    ).json()) as { grant: string };
    const img = await media("https://img.example/a.jpg", g);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(img.headers.get("content-security-policy")).toContain("sandbox");
    expect(await img.text()).toBe("jpg");

    const audio = await media("https://cdn.example/1.mp3", g, { range: "bytes=0-2" });
    expect(audio.status).toBe(206);
    expect(audio.headers.get("content-type")).toBe("audio/mpeg");
    expect(audio.headers.get("content-range")).toBe("bytes 0-2/100");
    expect(upstream.at(-1)?.range).toBe("bytes=0-2");

    expect((await media("https://page.example/", g)).status).toBe(415);
    expect((await media("http://img.example/a.jpg", g)).status).toBe(400);
    expect((await media("https://127.0.0.1/a.jpg", g)).status).toBe(400);
    expect((await media("https://localhost/a.jpg", g)).status).toBe(400);
    const before = upstream.length;
    expect(
      (await media("https://img.example/a.jpg", `${g.slice(0, -1)}${g.endsWith("0") ? "1" : "0"}`))
        .status,
    ).toBe(403);
    expect((await media("https://img.example/a.jpg", "1.abc")).status).toBe(403);
    expect(upstream.length).toBe(before);
  });

  it("serves a kept picture from the edge, signing it once", async () => {
    const edge = new Map<string, Response>();
    vi.stubGlobal("caches", {
      default: {
        match: async (r: Request) => edge.get(r.url)?.clone(),
        put: async (r: Request, res: Response) => void edge.set(r.url, res),
      },
    });
    const { grant: g } = (await (
      await grant({ email: "ops@wren.example", operator: true })
    ).json()) as { grant: string };
    for (let n = 0; n < 2; n++) {
      const res = await media(KEPT, g);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("kept");
      expect(res.headers.get("content-security-policy")).toContain("sandbox");
      expect(res.headers.get("cache-control")).toContain("immutable");
    }
    expect(asked.filter((a) => "sign" in a)).toHaveLength(1);
    expect(upstream.filter((u) => u.url.startsWith("https://store.example"))).toHaveLength(1);
    // A ref no row names, or not one of ours, loads nothing.
    expect((await media(`s3://media-bucket/media/${"b".repeat(32)}.jpg`, g)).status).toBe(404);
    expect((await media("s3://media-bucket/other/x.jpg", g)).status).toBe(400);
    vi.unstubAllGlobals();
  });
});
