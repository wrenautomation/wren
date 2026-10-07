/**
 * Sites' form paths through the Worker, with a fake Restate: a hosted form page is served with
 * the frame-anywhere CSP; a submit passes Turnstile before Restate hears it, its token is dropped,
 * the `wv` cookie rides along; the kit carries the site key.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import worker from "../src/worker.js";

const HOST = "forms.acme.example";
const FORM = "0b5c2a59-9a3e-4c47-9a35-0f1f2b6c1d11";
let calls: { url: string; body: Record<string, unknown> }[];

const env = (over: { [K in keyof Env]?: Env[K] | undefined } = {}): Env =>
  ({
    ASSETS: { fetch: async () => new Response("page") } as unknown as Fetcher,
    DEMO_HOST: "demo.wren.test",
    APP_HOST: "app.wren.test",
    RESTATE_INGRESS_URL: "https://restate.test:8080/",
    RESTATE_AUTH_TOKEN: "rt",
    AUTH_ORIGIN: "https://auth.test",
    ...over,
  }) as Env;

const submit = (fields: Record<string, unknown>, e = env(), cookie?: string) =>
  worker.fetch(
    new Request(`https://${HOST}/o/__form`, {
      method: "POST",
      headers: { "content-type": "text/plain", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ form: FORM, view: "v1", fields, touch: { source: "google" } }),
    }),
    e,
  );

beforeEach(() => {
  calls = [];
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
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url, body });
    if (url.endsWith("/Sites/serveForm"))
      return Response.json({ status: 200, html: "<!doctype html><form></form>" });
    if (url.endsWith("/Sites/form")) {
      const f = body.fields as Record<string, string>;
      return f.email
        ? Response.json({ status: 202 })
        : Response.json({
            status: 400,
            error: "Check the marked fields.",
            errors: { email: "Fill this in." },
          });
    }
    return Response.json({});
  });
});

describe("hosted forms at the edge", () => {
  it("serves a form page any site may frame", async () => {
    const res = await worker.fetch(new Request(`https://${HOST}/o/f/quote?embed=1`), env());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors *");
    expect(calls.at(-1)?.url).toMatch(/\/Sites\/serveForm$/);
    expect(calls.at(-1)?.body).toMatchObject({ client: "acme", slug: "quote", embed: true });
  });

  it("refuses a submit that fails Turnstile before Restate hears it", async () => {
    const e = env({ TURNSTILE_SECRET: "s" });
    const res = await submit({ email: "a@example.com", "cf-turnstile-response": "bad" }, e);
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.url.endsWith("/Sites/form"))).toBe(false);
    const none = await submit({ email: "a@example.com" }, e);
    expect(none.status).toBe(403);
  });

  it("passes a human with the cookie, drops the token", async () => {
    const e = env({ TURNSTILE_SECRET: "s" });
    const res = await submit(
      { email: "a@example.com", "cf-turnstile-response": "ok" },
      e,
      "x=1; wv=v_abc123; y=2",
    );
    expect(res.status).toBe(202);
    const sent = calls.find((c) => c.url.endsWith("/Sites/form"))?.body;
    expect(sent).toMatchObject({ form: FORM, visitor: "v_abc123", human: "yes", host: HOST });
    expect(sent?.fields).toEqual({ email: "a@example.com" });
  });

  it("marks off with no secret, and hands back each bad field", async () => {
    const res = await submit({ email: "" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Check the marked fields.",
      errors: { email: "Fill this in." },
    });
    expect(calls.find((c) => c.url.endsWith("/Sites/form"))?.body.human).toBe("off");
  });

  it("bakes the site key into the kit", async () => {
    const res = await worker.fetch(
      new Request(`https://${HOST}/o/__kit.js`),
      env({ TURNSTILE_SITE_KEY: "0xKEY" }),
    );
    expect(await res.text()).toContain('TK="0xKEY"');
  });
});
