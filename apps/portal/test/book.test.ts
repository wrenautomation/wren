/**
 * A client's booking page through the Worker, with a fake Restate and fake assets: the host or
 * the `/c/<client>` path names the client, never the browser; no sign-in; a bot's hidden field
 * and a failed Turnstile never reach Restate; Wren's own paths are untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import worker from "../src/worker.js";

const HOST = "book.acme.example";
let calls: { url: string; body: Record<string, unknown> }[];
let assets: string[];
let restateStatus: number;

const env = (over: { [K in keyof Env]?: Env[K] | undefined } = {}): Env =>
  ({
    ASSETS: {
      fetch: async (r: Request) => {
        assets.push(new URL(r.url).pathname);
        return new Response("page", { headers: { "content-type": "text/html" } });
      },
    } as unknown as Fetcher,
    DEMO_HOST: "demo.wren.test",
    APP_HOST: "app.wren.test",
    RESTATE_INGRESS_URL: "https://restate.test:8080/",
    RESTATE_AUTH_TOKEN: "rt",
    AUTH_ORIGIN: "https://auth.test",
    ...over,
  }) as Env;

const post = (host: string, path: string, body: unknown, e = env()) =>
  worker.fetch(
    new Request(`https://${host}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    e,
  );

beforeEach(() => {
  calls = [];
  assets = [];
  restateStatus = 200;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/Domains/resolve")) {
      const { host } = JSON.parse(String(init?.body));
      return Response.json({ client: host === HOST ? "acme" : null });
    }
    if (url.startsWith("https://challenges.cloudflare.com/")) {
      const { response } = JSON.parse(String(init?.body));
      return Response.json({ success: response === "ok" });
    }
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    if (restateStatus !== 200)
      return Response.json({ message: "That time was just taken." }, { status: restateStatus });
    return Response.json({ owner: "Acme Dental", slots: [] });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("a client's booking page", () => {
  it("serves the page on the client's host and under /c/<client> on the app host", async () => {
    for (const [host, path] of [
      [HOST, "/book"],
      [HOST, "/book/consult"],
      [HOST, "/booking/12.abc"],
      ["app.wren.test", "/c/acme/book"],
      ["app.wren.test", "/c/acme/booking/12.abc"],
    ] as const) {
      const res = await worker.fetch(new Request(`https://${host}${path}`), env());
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-security-policy")).toContain("challenges.cloudflare.com");
    }
    expect(assets.every((p) => p === "/book")).toBe(true);
  });

  it("pins the client from the host or the path, never the body", async () => {
    await post(HOST, "/__book/slots", { client: "other", tag: "consult" });
    await post("app.wren.test", "/c/acme/__book/slots", { client: "other" });
    expect(calls.map((c) => [c.url, c.body.client])).toEqual([
      ["https://restate.test:8080/ClientCalendar/slots", "acme"],
      ["https://restate.test:8080/ClientCalendar/slots", "acme"],
    ]);
    expect((await post(HOST, "/c/acme/__book/slots", {})).status).toBe(404);
    expect((await post("app.wren.test", "/__book/slots", {})).status).toBe(404);
    expect((await post("demo.wren.test", "/c/acme/__book/slots", {})).status).not.toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("keeps a bot's hidden field and a failed check off Restate", async () => {
    const booking = {
      start: "2026-10-08T14:00:00.000Z",
      name: "Ann",
      email: "a@x.test",
      zone: "UTC",
    };
    expect((await post(HOST, "/__book/book", { ...booking, website: "spam" })).status).toBe(409);
    const checked = env({ TURNSTILE_SECRET: "s", TURNSTILE_SITE_KEY: "k" });
    expect((await post(HOST, "/__book/book", { ...booking, human: "bad" }, checked)).status).toBe(
      403,
    );
    expect(calls).toHaveLength(0);
    expect((await post(HOST, "/__book/book", { ...booking, human: "ok" }, checked)).status).toBe(
      200,
    );
    expect(calls[0]?.body).not.toHaveProperty("human");
    const slots = await (await post(HOST, "/__book/slots", {}, checked)).json();
    expect(slots).toMatchObject({ owner: "Acme Dental", human: "k" });
  });

  it("passes Restate's refusal through as words", async () => {
    restateStatus = 409;
    const res = await post(HOST, "/__book/book", {});
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "That time was just taken." });
  });

  it("leaves the rest alone: /book on the app host is the app, no other handler", async () => {
    await worker.fetch(new Request("https://app.wren.test/book"), env());
    expect(assets).toEqual(["/"]);
    await post(HOST, "/__book/remind", {});
    expect(calls).toHaveLength(0);
  });
});
