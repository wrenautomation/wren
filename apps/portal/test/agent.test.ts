/**
 * `/api/agent` (designs/2026-10-09-ai-tools.md): a token is read through `Tokens/check`, each tool
 * goes to the console's route as that person, and a refusal comes back in the guard's words.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import worker from "../src/worker.js";

const TOKEN = `wren_${"a".repeat(43)}`;
let sent: { url: string; body: Record<string, unknown> }[];
let token: unknown;
let reply: { status: number; body: unknown };

const env = (): Env => ({
  ASSETS: { fetch: async () => new Response("app") } as unknown as Fetcher,
  DEMO_HOST: "demo.test",
  APP_HOST: "app.test",
  RESTATE_INGRESS_URL: "https://restate.test:8080/",
  RESTATE_AUTH_TOKEN: "rt",
  AUTH_ORIGIN: "https://auth.test",
});

beforeEach(() => {
  sent = [];
  token = { email: "amy@wren.example", operator: true, client: null };
  reply = { status: 200, body: [{ id: "deals.deal" }] };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, body: JSON.parse(String(init?.body)) });
    if (url.endsWith("/Tokens/check")) return Response.json(token);
    return Response.json(reply.body, { status: reply.status });
  });
});
afterEach(() => vi.unstubAllGlobals());

const call = (tool: string, args: unknown = {}, auth = `Bearer ${TOKEN}`, host = "app.test") =>
  worker.fetch(
    new Request(`https://${host}/api/agent/${tool}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify(args),
    }),
    env(),
  );

describe("agent", () => {
  it("lists its tools without a token", async () => {
    const res = await worker.fetch(new Request("https://app.test/api/agent"), env());
    const got = (await res.json()) as { tools: { name: string }[] };
    expect(got.tools.map((t) => t.name)).toEqual([
      "types",
      "list",
      "get",
      "handlers",
      "describe",
      "call",
    ]);
    expect(sent).toHaveLength(0);
  });

  it("a tool goes to the console as the token's person, never as the body says", async () => {
    const res = await call("list", { record: "deals.deal", limit: 999, viewer: { email: "x" } });
    expect(await res.json()).toEqual([{ id: "deals.deal" }]);
    expect(sent[1]).toMatchObject({
      url: "https://restate.test:8080/ConsolePortal/recordsList",
      body: {
        record: "deals.deal",
        limit: 50,
        viewer: { email: "amy@wren.example", operator: true },
      },
    });
    expect(sent[1]?.body).not.toHaveProperty("asClient");
  });

  it("a refusal keeps its status and the guard's words", async () => {
    reply = { status: 403, body: { message: "you can't read deals" } };
    const res = await call("get", { record: "deals.deal", id: 1 });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "you can't read deals" });
  });

  it("handler tools are the team's; a pinned token acts as that client", async () => {
    token = { email: "bo@acme.example", operator: false, client: "acme" };
    const res = await call("handlers");
    expect(res.status).toBe(403);
    expect(sent).toHaveLength(1);
    await call("types");
    expect(sent[2]?.body).toMatchObject({
      client: "acme",
      asClient: true,
      viewer: { email: "bo@acme.example" },
    });
  });

  it("no token, a bad one, or the demo: refused before any tool", async () => {
    const none = await call("types", {}, "");
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain("Bearer");
    token = null;
    expect((await call("types")).status).toBe(401);
    expect((await call("types", {}, undefined, "demo.test")).status).toBe(404);
    const get = await worker.fetch(new Request("https://app.test/api/agent/types"), env());
    expect(get.status).toBe(405);
  });

  it("unknown tools and bodies that aren't one object are refused", async () => {
    expect((await call("nope")).status).toBe(404);
    expect((await call("types", [1])).status).toBe(400);
  });
});
