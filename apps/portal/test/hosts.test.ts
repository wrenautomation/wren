/**
 * The portal on a client's own host, with a fake Restate and a fake sign-in Lambda: the host
 * decides the client, our other hosts pass through, and the session lives in this host's cookie.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import { SESSION_COOKIE, safeNext, siteOf } from "../src/hosts.js";
import worker from "../src/worker.js";

vi.mock("@wren/auth/verify", () => ({
  AUDIENCE: "wren",
  bearer: (req: Request) => req.headers.get("authorization")?.slice(7) ?? null,
  verifyToken: async (t: string | null) => (t === "jwt" ? { email: "a@acme.example" } : null),
}));

const AUTH = "https://auth.test";
const LAMBDA = "https://lambda.test/";
const HOST = "portal.acme.example";
const SIGNED = "sess.sig";

let calls: { url: string; init?: RequestInit | undefined }[];
let tokenStatus: number;

const env = (over: { [K in keyof Env]?: Env[K] | undefined } = {}): Env =>
  ({
    ASSETS: { fetch: async () => new Response("app") } as unknown as Fetcher,
    DEMO_HOST: "demo.wren.test",
    APP_HOST: "app.wren.test",
    RESTATE_INGRESS_URL: "https://restate.test:8080/",
    AUTH_ORIGIN: AUTH,
    LAMBDA_URL: LAMBDA,
    EDGE_SECRET: "edge",
    ...over,
  }) as Env;

const get = (path: string, headers: HeadersInit = {}, host = HOST) =>
  worker.fetch(new Request(`https://${host}${path}`, { headers }), env());

beforeEach(() => {
  calls = [];
  tokenStatus = 200;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    if (url.endsWith("/Domains/resolve")) {
      const { host } = JSON.parse(String(init?.body));
      return Response.json({ client: host === HOST ? "c-acme" : null });
    }
    if (url === `${LAMBDA.replace(/\/$/, "")}/api/auth/one-time-token/verify`) {
      const { token } = JSON.parse(String(init?.body));
      if (token !== "good") return Response.json({ message: "invalid" }, { status: 400 });
      const h = new Headers({ "content-type": "application/json" });
      h.append("set-cookie", "__Secure-better-auth.session_data=x; Path=/");
      h.append("set-cookie", `__Secure-better-auth.session_token=${SIGNED}; Path=/; HttpOnly`);
      return new Response("{}", { headers: h });
    }
    if (url.endsWith("/api/auth/token"))
      return Response.json(tokenStatus === 200 ? { token: "jwt" } : {}, { status: tokenStatus });
    if (url.endsWith("/api/auth/sign-out")) return Response.json({ success: true });
    return new Response(`origin of ${url}`);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("which site a host is", () => {
  it("app, demo, ours, a client's, or unknown", async () => {
    const at = (h: string, e = env()) => siteOf(new Request(`https://${h}/`), e);
    expect(await at("app.wren.test")).toEqual({ kind: "app" });
    expect(await at("demo.wren.test")).toEqual({ kind: "demo" });
    expect(await at("wren.test")).toEqual({ kind: "ours" });
    expect(await at("desk.wren.test")).toEqual({ kind: "ours" });
    expect(await at(HOST)).toEqual({ kind: "client", client: "c-acme" });
    expect(await at("other.example")).toEqual({ kind: "unknown" });
    // Without APP_HOST, as before custom domains: everything is the app.
    expect(await at("other.example", env({ APP_HOST: undefined }))).toEqual({ kind: "app" });
  });

  it("passes our other hosts to their origin and turns unknown ones away", async () => {
    expect(await (await get("/x", {}, "desk.wren.test")).text()).toBe(
      "origin of https://desk.wren.test/x",
    );
    expect((await get("/", {}, "other.example")).status).toBe(404);
  });

  it("pins the host's client on every API call, whatever the browser asks for", async () => {
    const call = (headers: HeadersInit) =>
      worker.fetch(
        new Request(`https://${HOST}/api/delivery/me`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({ client: "c-other", asClient: false }),
        }),
        env(),
      );
    expect((await call({})).status).toBe(401);
    await call({ authorization: "Bearer jwt" });
    const sent = calls.find((c) => c.url.includes("/DeliveryPortal/"));
    expect(JSON.parse(String(sent?.init?.body))).toMatchObject({
      client: "c-acme",
      asClient: true,
      viewer: { email: "a@acme.example" },
    });
  });
});

describe("sign-in on a client's host", () => {
  it("in: off to our sign-in, which comes back to this host's /__auth/back", async () => {
    const res = await get("/__auth/in?next=/reports");
    const to = new URL(res.headers.get("location") ?? "");
    expect(to.origin).toBe(AUTH);
    expect(to.searchParams.get("next")).toBe(`https://${HOST}/__auth/back?next=%2Freports`);
  });

  it("back: redeems the token at the Lambda and keeps the session in an HttpOnly cookie", async () => {
    const res = await get("/__auth/back?ott=good&next=/reports", { "cf-connecting-ip": "1.2.3.4" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/reports");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=${SIGNED}`);
    expect(cookie).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    const call = calls.find((c) => c.url.endsWith("one-time-token/verify"));
    const h = new Headers(call?.init?.headers);
    expect(h.get("x-wren-edge")).toBe("edge");
    expect(h.get("x-wren-ip")).toBe("1.2.3.4");
  });

  it("back: a bad or missing token is a page, not a cookie or a loop", async () => {
    for (const path of ["/__auth/back?ott=bad", "/__auth/back"]) {
      const res = await get(path);
      expect(res.status).toBe(400);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("token: asks the Lambda with the session as its cookie", async () => {
    const res = await get("/__auth/token", { cookie: `a=1; ${SESSION_COOKIE}=${SIGNED}` });
    expect(await res.json()).toEqual({ token: "jwt" });
    const call = calls.find((c) => c.url.endsWith("/api/auth/token"));
    expect(new Headers(call?.init?.headers).get("cookie")).toBe(
      `__Secure-better-auth.session_token=${SIGNED}`,
    );
    expect((await get("/__auth/token")).status).toBe(401);
  });

  it("token: an ended session clears the cookie", async () => {
    tokenStatus = 401;
    const res = await get("/__auth/token", { cookie: `${SESSION_COOKIE}=${SIGNED}` });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("out: signs out at the Lambda as our sign-in's origin, clears the cookie", async () => {
    const res = await get("/__auth/out", { cookie: `${SESSION_COOKIE}=${SIGNED}` });
    expect(res.headers.get("location")).toBe(`${AUTH}/?out=1`);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    const call = calls.find((c) => c.url.endsWith("/api/auth/sign-out"));
    expect(new Headers(call?.init?.headers).get("origin")).toBe(AUTH);
  });

  it("no Lambda configured: says so", async () => {
    const res = await worker.fetch(
      new Request(`https://${HOST}/__auth/back?ott=good`),
      env({ LAMBDA_URL: undefined }),
    );
    expect(res.status).toBe(503);
  });

  it("only same-origin paths come back", () => {
    expect(safeNext("/a?b=1")).toBe("/a?b=1");
    for (const bad of [
      null,
      "",
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "evil",
    ])
      expect(safeNext(bad)).toBe("/");
  });
});
