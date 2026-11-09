/** Live topics: the writer's signed POST, the hook's check, the rooms it tells, the socket's door. */
import { LIVE_SIG_HEADER, LIVE_TS_HEADER, liveSignature, tellLive } from "@wren/core/live";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import type { Site } from "../src/hosts.js";
import {
  LiveRoom,
  roomOf,
  TOPICS_PROTOCOL,
  topicsHookRoute,
  topicsSocketRoute,
} from "../src/topics.js";

const SECRET = "test-secret";
const app: Site = { kind: "app" };

/** A fake namespace: records each room and path asked, answers `tabs: 1`. */
function rooms() {
  const asked: { room: string; path: string; body: string }[] = [];
  const ns = {
    idFromName: (n: string) => n,
    get: (room: string) => ({
      fetch: async (req: Request) => {
        asked.push({ room, path: new URL(req.url).pathname, body: await req.text() });
        return Response.json({ tabs: 1 });
      },
    }),
  } as unknown as DurableObjectNamespace;
  return { ns, asked };
}

const env = (over: Partial<Env> = {}): Env => ({
  ASSETS: {} as Fetcher,
  DEMO_HOST: "demo.test",
  RESTATE_INGRESS_URL: "https://restate.test/",
  LIVE_HOOK_SECRET: SECRET,
  ...over,
});

async function signed(body: string, o: { secret?: string; ts?: number } = {}) {
  const ts = String(o.ts ?? Date.now());
  return new Request("https://app.test/api/live/changed", {
    method: "POST",
    headers: {
      [LIVE_TS_HEADER]: ts,
      [LIVE_SIG_HEADER]: await liveSignature(o.secret ?? SECRET, ts, body),
    },
    body,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("the hook", () => {
  it("tells room app, and the client's room when one is named", async () => {
    const r = rooms();
    const e = env({ LIVE_ROOM: r.ns });
    const res = await topicsHookRoute(
      await signed(
        JSON.stringify({ topics: ["variants", "variants", "BAD topic"], client: "firm" }),
      ),
      e,
      app,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tabs: 2 });
    expect(r.asked.map((a) => [a.room, a.path])).toEqual([
      ["app", "/tell"],
      ["client:firm", "/tell"],
    ]);
    expect(JSON.parse(r.asked[0]?.body ?? "")).toEqual({ type: "changed", topics: ["variants"] });
  });

  it("refuses a bad or old signature, no topics, other hosts; 404 unset", async () => {
    const e = env({ LIVE_ROOM: rooms().ns });
    const body = JSON.stringify({ topics: ["variants"] });
    const status = async (req: Request, en = e, site: Site = app) =>
      (await topicsHookRoute(req, en, site)).status;
    expect(await status(await signed(body, { secret: "other" }))).toBe(401);
    expect(await status(await signed(body, { ts: Date.now() - 10 * 60_000 }))).toBe(401);
    expect(
      await status(new Request("https://app.test/api/live/changed", { method: "POST", body })),
    ).toBe(401);
    expect(await status(await signed(JSON.stringify({ topics: [] })))).toBe(400);
    expect(await status(await signed(body), e, { kind: "client", client: "firm" })).toBe(404);
    const { LIVE_HOOK_SECRET: _, ...noSecret } = env({ LIVE_ROOM: rooms().ns });
    expect(await status(await signed(body), noSecret)).toBe(404);
    expect(await status(await signed(body), env())).toBe(404);
  });
});

describe("tellLive", () => {
  it("signs what the hook checks; no secret = no call; a dead hook never throws", async () => {
    const r = rooms();
    const e = env({ LIVE_ROOM: r.ns });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
      topicsHookRoute(new Request(String(input), init), e, app),
    );
    const vars = { WREN_LIVE_SECRET: SECRET, WREN_LIVE_URL: "https://app.test/api/live/changed" };
    expect(await tellLive(["variants"], { vars, client: "firm" })).toBe(true);
    expect(r.asked.map((a) => a.room)).toEqual(["app", "client:firm"]);
    expect(await tellLive(["variants"], { vars: {} })).toBe(false);
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    expect(await tellLive(["variants"], { vars })).toBe(false);
  });
});

describe("LiveRoom", () => {
  it("sends the frame to each socket that takes it", () => {
    const room = new LiveRoom({} as DurableObjectState);
    const got: string[] = [];
    const n = room.tell(
      [
        { send: (f) => got.push(f) },
        {
          send: () => {
            throw new Error("gone");
          },
        },
      ],
      "frame",
    );
    expect(n).toBe(1);
    expect(got).toEqual(["frame"]);
    expect(roomOf({ kind: "client", client: "firm" })).toBe("client:firm");
  });
});

describe("the topics socket's door", () => {
  const signedIn = async (req: Request) =>
    req.headers.get("authorization") === "Bearer tok"
      ? { email: "amy@firm.example" }
      : new Response("no", { status: 401 });
  const open = (headers: Record<string, string> = {}) =>
    new Request("https://app.test/api/live/topics", {
      headers: {
        upgrade: "websocket",
        origin: "https://app.test",
        "sec-websocket-protocol": `${TOPICS_PROTOCOL}, tok`,
        ...headers,
      },
    });

  it("joins the site's room; refuses the writes protocol, the demo, no binding", async () => {
    const r = rooms();
    const e = env({ LIVE_ROOM: r.ns });
    const site: Site = { kind: "client", client: "firm" };
    expect((await topicsSocketRoute(open(), e, site, signedIn)).status).toBe(200);
    expect(r.asked.map((a) => [a.room, a.path])).toEqual([["client:firm", "/socket"]]);
    expect(
      (
        await topicsSocketRoute(
          open({ "sec-websocket-protocol": "wren-writes, tok" }),
          e,
          app,
          signedIn,
        )
      ).status,
    ).toBe(401);
    expect((await topicsSocketRoute(open(), e, { kind: "demo" }, signedIn)).status).toBe(404);
    expect((await topicsSocketRoute(open(), env(), app, signedIn)).status).toBe(404);
  });
});
