/**
 * `/api/aerie` (aerie D20 B): a `wren_` token through `Tokens/check`, the raw body to
 * `AerieConsole/remote` as that person, Aerie's status and superjson text back as sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import worker from "../src/worker.js";

const TOKEN = `wren_${"a".repeat(43)}`;
const BODY = JSON.stringify({ json: { port: "store", op: "get", args: ["WA-1"] } });
let sent: { url: string; body: Record<string, unknown> }[];
let token: unknown;
let reply: { status: number; body: unknown };

const env = (): Env => ({
  ASSETS: { fetch: async () => new Response("app") } as unknown as Fetcher,
  DEMO_HOST: "demo.test",
  APP_HOST: "app.test",
  WREN_API_URL: "https://restate.test:8080/",
  WREN_API_TOKEN: "rt",
  AUTH_ORIGIN: "https://auth.test",
});

beforeEach(() => {
  sent = [];
  token = { email: "amy@wren.example", operator: true, client: null };
  reply = { status: 200, body: { status: 200, body: JSON.stringify({ json: { value: null } }) } };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, body: JSON.parse(String(init?.body)) });
    if (url.endsWith("/Tokens/check")) return Response.json(token);
    return Response.json(reply.body, { status: reply.status });
  });
});
afterEach(() => vi.unstubAllGlobals());

const call = (body = BODY, auth = `Bearer ${TOKEN}`, host = "app.test", method = "POST") =>
  worker.fetch(
    new Request(`https://${host}/api/aerie`, {
      method,
      headers: { "content-type": "application/json", authorization: auth },
      ...(method === "POST" ? { body } : {}),
    }),
    env(),
  );

/** the error as the CLI's superjson.parse reads it */
const errorOf = async (res: Response) =>
  ((await res.json()) as { json: { error: string } }).json.error;

describe("aerie remote", () => {
  it("sends the raw body as that person and passes Aerie's answer through", async () => {
    reply.body = { status: 409, body: JSON.stringify({ json: { error: "stale" } }) };
    const res = await call();
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("stale");
    const fwd = sent.at(-1);
    expect(fwd?.url).toBe("https://restate.test:8080/AerieConsole/remote");
    expect(fwd?.body).toMatchObject({
      body: BODY,
      viewer: { email: "amy@wren.example", operator: true },
    });
    expect(fwd?.body).not.toHaveProperty("client");
  });

  it("answers 200 with Aerie's text", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ json: { value: null } });
  });

  it("refuses without a token, in superjson", async () => {
    const res = await call(BODY, "");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    expect(await errorOf(res)).toMatch(/token/);
    expect(sent).toHaveLength(0);
  });

  it("refuses an unknown token", async () => {
    token = {};
    const res = await call();
    expect(res.status).toBe(401);
    expect(sent.map((s) => s.url)).toEqual(["https://restate.test:8080/Tokens/check"]);
  });

  it("refuses a client's token: Wren's database only (WA-1364.9)", async () => {
    token = { email: "bo@client.example", client: "acme" };
    const res = await call();
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatch(/Wren's own database/);
    expect(sent).toHaveLength(1);
  });

  it("refuses a read-only token", async () => {
    token = { email: "amy@wren.example", operator: true, cap: { verbs: ["read"] } };
    const res = await call();
    expect(res.status).toBe(403);
    expect(sent).toHaveLength(1);
  });

  it("passes the guard's refusal on in superjson", async () => {
    token = { email: "bo@wren.example", client: null };
    reply = { status: 403, body: { message: "Wren's team only." } };
    const res = await call();
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("Wren's team only.");
  });

  it("refuses a body over 1 MB", async () => {
    const res = await call("x".repeat((1 << 20) + 1));
    expect(res.status).toBe(413);
    expect(sent).toHaveLength(1);
  });

  it("runs on the app host only, POST only", async () => {
    expect((await call(BODY, `Bearer ${TOKEN}`, "demo.test")).status).toBe(404);
    expect((await call(BODY, `Bearer ${TOKEN}`, "app.test", "GET")).status).toBe(405);
    expect(sent).toHaveLength(0);
  });
});
