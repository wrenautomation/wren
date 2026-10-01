import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/worker.js";

const assets = { fetch: vi.fn(async () => new Response("page")) } as unknown as Fetcher;
const env = (over: Partial<Env> = {}): Env => ({
  ASSETS: assets,
  LAMBDA_URL: "https://lambda.test/",
  EDGE_SECRET: "s3cret",
  APPS: "https://app.test",
  ...over,
});
const forwarded = () => {
  const call = vi.mocked(fetch).mock.calls[0];
  return { url: String(call?.[0]), init: call?.[1] as RequestInit };
};

afterEach(() => vi.unstubAllGlobals());

describe("auth worker", () => {
  it("serves the pages from assets", async () => {
    const res = await worker.fetch(new Request("https://auth.test/reset?token=x"), env());
    expect(await res.text()).toBe("page");
  });

  it("forwards /api/auth with the edge secret and the caller's address, never theirs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { headers: { "set-cookie": "s=1" } })),
    );
    const req = new Request("https://auth.test/api/auth/sign-in/email?x=1", {
      method: "POST",
      headers: { "x-wren-edge": "forged", "x-wren-ip": "6.6.6.6", "cf-connecting-ip": "1.2.3.4" },
      body: "{}",
    });
    const res = await worker.fetch(req, env());
    const { url, init } = forwarded();
    expect(url).toBe("https://lambda.test/api/auth/sign-in/email?x=1");
    const headers = new Headers(init.headers);
    expect(headers.get("x-wren-edge")).toBe("s3cret");
    expect(headers.get("x-wren-ip")).toBe("1.2.3.4");
    expect(init.redirect).toBe("manual");
    expect(res.headers.get("set-cookie")).toBe("s=1");
  });

  it("lets only the apps read a token cross-origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"token":"t"}')),
    );
    const ask = (origin: string, path = "/api/auth/token") =>
      worker.fetch(new Request(`https://auth.test${path}`, { headers: { origin } }), env());
    const app = await ask("https://app.test");
    expect(app.headers.get("access-control-allow-origin")).toBe("https://app.test");
    expect(app.headers.get("access-control-allow-credentials")).toBe("true");
    expect((await ask("https://evil.test")).headers.get("access-control-allow-origin")).toBeNull();
    expect(
      (await ask("https://app.test", "/api/auth/get-session")).headers.get(
        "access-control-allow-origin",
      ),
    ).toBeNull();
  });

  it("is closed until configured", async () => {
    const { EDGE_SECRET: _, ...bare } = env();
    const res = await worker.fetch(new Request("https://auth.test/api/auth/get-session"), bare);
    expect(res.status).toBe(503);
  });
});
