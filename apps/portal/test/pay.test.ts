/**
 * Stripe's webhook through the Worker, with a fake Restate: the body goes on byte for byte with
 * its signature, only on the app host, and Stripe gets the service's own status back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import worker from "../src/worker.js";

let calls: { url: string; body: Record<string, unknown> }[];
let answer: () => Response;

const env = (): Env =>
  ({
    ASSETS: { fetch: async () => new Response("page") } as unknown as Fetcher,
    DEMO_HOST: "demo.wren.test",
    APP_HOST: "app.wren.test",
    RESTATE_INGRESS_URL: "https://restate.test:8080/",
    RESTATE_AUTH_TOKEN: "rt",
    AUTH_ORIGIN: "https://auth.test",
  }) as Env;

// Synthetic: a made-up event and signature.
const RAW = '{"id":"evt_test_1","type":"checkout.session.completed"}';
const hook = (host = "app.wren.test", method = "POST") =>
  worker.fetch(
    new Request(`https://${host}/__pay/stripe/acme`, {
      method,
      headers: { "stripe-signature": "t=1,v1=ab" },
      ...(method === "POST" ? { body: RAW } : {}),
    }),
    env(),
  );

beforeEach(() => {
  calls = [];
  answer = () => Response.json({ status: 200, result: "paid" });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/Domains/resolve")) return Response.json({ client: null });
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return answer();
  });
});

describe("Stripe's webhook at the edge", () => {
  it("passes the raw body and signature to Payments/stripe", async () => {
    const res = await hook();
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://restate.test:8080/Payments/stripe");
    expect(calls[0]?.body).toEqual({ client: "acme", raw: RAW, signature: "t=1,v1=ab" });
  });

  it("gives Stripe the service's refusal, and 502 to retry when Restate fails", async () => {
    answer = () => Response.json({ status: 400, result: "signature doesn't match" });
    expect((await hook()).status).toBe(400);
    answer = () => new Response("boom", { status: 500 });
    expect((await hook()).status).toBe(502);
  });

  it("takes POST only, on the app host only", async () => {
    expect((await hook("app.wren.test", "GET")).status).toBe(405);
    await hook("demo.wren.test");
    expect(calls.some((c) => c.url.endsWith("/Payments/stripe"))).toBe(false);
  });
});
