/**
 * `/api/mcp` (designs/2026-10-09-mcp.md): a token is read through `Tokens/check`, each tool goes
 * to the console's route as that person, and a refusal comes back as an error result.
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

const post = (body: unknown, auth = `Bearer ${TOKEN}`, host = "app.test") =>
  worker.fetch(
    new Request(`https://${host}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: auth,
      },
      body: JSON.stringify(body),
    }),
    env(),
  );
const call = (name: string, args: object = {}) =>
  post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });

describe("mcp", () => {
  it("initializes, lists tools and pings", async () => {
    const init = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t" } },
    });
    expect(await init.json()).toMatchObject({
      id: 1,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "wren" },
      },
    });
    const tools = (await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as {
      result: { tools: { name: string }[] };
    };
    expect(tools.result.tools.map((t) => t.name)).toEqual([
      "list_record_types",
      "list_records",
      "get_record",
      "list_handlers",
      "describe_handler",
      "call_handler",
    ]);
    expect(await (await post({ jsonrpc: "2.0", id: 3, method: "ping" })).json()).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: {},
    });
    const note = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.status).toBe(202);
  });

  it("a tool goes to the console as the token's person, never as the body says", async () => {
    const res = await call("list_records", {
      record: "deals.deal",
      limit: 999,
      viewer: { email: "x" },
    });
    expect(await res.json()).toMatchObject({
      result: { content: [{ type: "text", text: JSON.stringify([{ id: "deals.deal" }]) }] },
    });
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

  it("a refusal is an error result in the guard's words", async () => {
    reply = { status: 403, body: { message: "you can't read deals" } };
    const res = await call("get_record", { record: "deals.deal", id: 1 });
    expect(await res.json()).toMatchObject({
      result: { content: [{ text: "you can't read deals" }], isError: true },
    });
  });

  it("handler tools are the team's; a pinned token acts as that client", async () => {
    token = { email: "bo@acme.example", operator: false, client: "acme" };
    const res = await call("list_handlers");
    expect(await res.json()).toMatchObject({ result: { isError: true } });
    expect(sent).toHaveLength(1);
    await call("list_record_types");
    expect(sent[2]?.body).toMatchObject({
      client: "acme",
      asClient: true,
      viewer: { email: "bo@acme.example" },
    });
  });

  it("no token, a bad one, or the demo: refused before any tool", async () => {
    const none = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, "");
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain("Bearer");
    token = null;
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(401);
    expect(
      (await post({ jsonrpc: "2.0", id: 1, method: "ping" }, undefined, "demo.test")).status,
    ).toBe(404);
    const get = await worker.fetch(new Request("https://app.test/api/mcp"), env());
    expect(get.status).toBe(405);
  });

  it("unknown methods and tools are JSON-RPC errors", async () => {
    expect(
      await (await post({ jsonrpc: "2.0", id: 9, method: "resources/list" })).json(),
    ).toMatchObject({
      error: { code: -32601 },
    });
    expect(await (await call("nope")).json()).toMatchObject({ error: { code: -32602 } });
  });
});
