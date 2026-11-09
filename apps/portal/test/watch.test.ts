/**
 * Sends told live: the state of a write and why the runtime is trying it again, the watch that
 * pushes each change to a person's tabs, and the socket's door.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import type { Site } from "../src/hosts.js";
import {
  FIRST_MS,
  KEEP_DONE_MS,
  MAX_MS,
  type Watch,
  type WatchSocket,
  WRITES_PROTOCOL,
  WriteWatch,
  watchName,
  writesSocketRoute,
} from "../src/watch.js";
import { readWrite, reasonOf } from "../src/writes.js";

const KEY = `portal:${"a".repeat(64)}`;
const INGRESS = "https://restate.test:8080/";

const env = (over: Partial<Env> = {}): Env => ({
  ASSETS: {} as Fetcher,
  DEMO_HOST: "demo.test",
  WREN_API_URL: INGRESS,
  WREN_API_TOKEN: "tok",
  ...over,
});

/** The door as a fake: the output read answers `output`. */
function restate(output: () => Response) {
  vi.stubGlobal("fetch", async () => output());
}

afterEach(() => vi.unstubAllGlobals());

describe("readWrite", () => {
  it("reads sent, failed, unknown and can't-say from Restate's record", async () => {
    let answer = () => Response.json({ done: true });
    restate(() => answer());
    expect(await readWrite(env(), "DocumentsConsole", "send", KEY)).toEqual({
      state: "sent",
      answer: { done: true },
    });
    answer = () => Response.json({ message: "That lead opted out." }, { status: 409 });
    expect(await readWrite(env(), "DocumentsConsole", "send", KEY)).toEqual({
      state: "failed",
      error: "That lead opted out.",
    });
    answer = () => new Response("gone", { status: 404 });
    expect(await readWrite(env(), "DocumentsConsole", "send", KEY)).toEqual({ state: "unknown" });
    answer = () => new Response("down", { status: 503 });
    expect(await readWrite(env(), "DocumentsConsole", "send", KEY)).toBeNull();
  });

  it("the door's 470 carries the reason, tokens hidden", async () => {
    restate(() =>
      Response.json(
        { message: "not ready", retry: { count: 2, reason: "token=abc123 refused\nat x" } },
        { status: 470 },
      ),
    );
    expect(await readWrite(env(), "MarketingConsole", "inboxReply", KEY)).toEqual({
      state: "sending",
      retry: { count: 2, reason: "token=[hidden] refused" },
    });
  });

  it("sending with nothing failing has no reason", async () => {
    restate(() => new Response(null, { status: 470 }));
    expect(await readWrite(env(), "MarketingConsole", "inboxReply", KEY)).toEqual({
      state: "sending",
    });
    restate(() => Response.json({ retry: { count: 0, reason: "x" } }, { status: 470 }));
    expect(await readWrite(env(), "MarketingConsole", "inboxReply", KEY)).toEqual({
      state: "sending",
    });
  });

  it("a reason is one line, short, with tokens hidden", () => {
    expect(reasonOf("first\nsecond")).toBe("first");
    expect(reasonOf("auth failed: Bearer abc.def")).toBe("auth failed: Bearer [hidden]");
    expect(reasonOf(`id ${"x".repeat(50)} bad`)).toBe("id [hidden] bad");
    expect(reasonOf("y ".repeat(200))).toBe("y ".repeat(200).trim());
  });
});

/** A Durable Object's state, in memory. */
function doState() {
  const data = new Map<string, unknown>();
  const sockets: WatchSocket[] = [];
  let alarm: number | null = null;
  const storage = {
    get: async (k: string) => structuredClone(data.get(k)),
    put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
    delete: async (k: string | string[]) => {
      for (const x of Array.isArray(k) ? k : [k]) data.delete(x);
    },
    list: async ({ prefix }: { prefix: string }) =>
      new Map(
        [...data]
          .filter(([k]) => k.startsWith(prefix))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, structuredClone(v)]),
      ),
    setAlarm: async (t: number) => {
      alarm = t;
    },
    deleteAlarm: async () => {
      alarm = null;
    },
  };
  const state = {
    storage,
    acceptWebSocket: (s: WatchSocket) => sockets.push(s),
    getWebSockets: () => sockets,
  } as unknown as DurableObjectState;
  return { state, data, sockets, alarmAt: () => alarm };
}

const socket = () => {
  const heard: unknown[] = [];
  const s: WatchSocket = { send: (f) => heard.push(JSON.parse(f)), close: () => undefined };
  return { s, heard };
};

describe("WriteWatch", () => {
  it("reads a send with backoff and pushes each change, the retry reason too", async () => {
    let now = 1_000_000;
    let output = () => new Response(null, { status: 470 });
    vi.stubGlobal("fetch", async () => output());
    const d = doState();
    const watch = new WriteWatch(d.state, env(), () => now);
    const tab = socket();
    d.state.acceptWebSocket(tab.s as unknown as WebSocket);
    expect(
      await watch.watch({ requestId: "req-00001", path: "marketing/inboxReply", key: KEY }),
    ).toBe(true);
    expect(d.alarmAt()).toBe(now + FIRST_MS);

    now += FIRST_MS;
    await watch.alarm();
    expect(tab.heard).toEqual([
      {
        type: "write",
        path: "marketing/inboxReply",
        requestId: "req-00001",
        state: { state: "sending" },
      },
    ]);
    // Nothing moved: the next read waits twice as long, never past the cap.
    now += FIRST_MS;
    await watch.alarm();
    expect(tab.heard).toHaveLength(1);
    expect(d.alarmAt()).toBe(now + 2 * FIRST_MS);
    const w = d.data.get("w:req-00001") as Watch;
    expect(w.wait).toBeLessThanOrEqual(MAX_MS);

    // The runtime starts retrying: the tab hears why.
    output = () =>
      Response.json({ retry: { count: 2, reason: "LinkedIn is down" } }, { status: 470 });
    now += 2 * FIRST_MS;
    await watch.alarm();
    expect(tab.heard.at(-1)).toMatchObject({
      state: { state: "sending", retry: { count: 2, reason: "LinkedIn is down" } },
    });

    // It went: the tab hears, and the watch stops reading.
    output = () => Response.json({ ok: true });
    now += FIRST_MS;
    await watch.alarm();
    expect(tab.heard.at(-1)).toMatchObject({ state: { state: "sent", answer: { ok: true } } });
    const done = d.data.get("w:req-00001") as Watch;
    expect(done.next).toBeNull();
    expect(d.alarmAt()).toBe(now + KEEP_DONE_MS + 1);

    // A tab that connects late still hears how it ended; later it's dropped.
    const late = socket();
    await watch.greet(late.s);
    expect(late.heard).toEqual([tab.heard.at(-1)]);
    now += KEEP_DONE_MS + 1;
    await watch.alarm();
    expect(d.data.size).toBe(0);
    expect(d.alarmAt()).toBeNull();
  });

  it("refuses what isn't a write, and keeps at most the newest 200", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 470 }));
    let now = 1;
    const d = doState();
    const watch = new WriteWatch(d.state, env(), () => now);
    expect(
      await watch.watch({ requestId: "req-00001", path: "documents/templates", key: KEY }),
    ).toBe(false);
    expect(await watch.watch({ requestId: "bad id", path: "marketing/inboxReply", key: KEY })).toBe(
      false,
    );
    expect(
      await watch.watch({ requestId: "req-00001", path: "marketing/inboxReply", key: "nope" }),
    ).toBe(false);
    for (let i = 0; i < 205; i++) {
      now += 1;
      await watch.watch({
        requestId: `req-${String(i).padStart(5, "0")}`,
        path: "marketing/inboxReply",
        key: KEY,
      });
    }
    expect(d.data.size).toBe(200);
    expect(d.data.has("w:req-00000")).toBe(false);
    expect(d.data.has("w:req-00204")).toBe(true);
  });
});

describe("the writes socket's door", () => {
  const app: Site = { kind: "app" };
  const signedIn = async (req: Request) =>
    req.headers.get("authorization") === "Bearer tok"
      ? { email: "amy@firm.example" }
      : new Response("no", { status: 401 });
  const watches = () => {
    const names: string[] = [];
    const paths: string[] = [];
    const ns = {
      idFromName: (n: string) => {
        names.push(n);
        return n;
      },
      get: () => ({
        fetch: async (req: Request) => {
          paths.push(new URL(req.url).pathname);
          return new Response("joined");
        },
      }),
    } as unknown as DurableObjectNamespace;
    return { ns, names, paths };
  };
  const open = (headers: Record<string, string> = {}) =>
    new Request("https://app.test/api/live/writes", {
      headers: {
        upgrade: "websocket",
        origin: "https://app.test",
        "sec-websocket-protocol": `${WRITES_PROTOCOL}, tok`,
        ...headers,
      },
    });

  it("joins the signed-in person's own watch for this site", async () => {
    const w = watches();
    const res = await writesSocketRoute(open(), env({ WRITE_WATCH: w.ns }), app, signedIn);
    expect(await res.text()).toBe("joined");
    expect(w.names).toEqual([watchName("amy@firm.example", app)]);
    expect(w.paths).toEqual(["/socket"]);
    expect(watchName("Amy@Firm.example", { kind: "client", client: "firm" })).toBe(
      "amy@firm.example\nclient:firm",
    );
  });

  it("refuses another site, no or a bad token, a plain request; 404 without the binding or on the demo", async () => {
    const e = env({ WRITE_WATCH: watches().ns });
    const status = async (req: Request, en = e, site: Site = app) =>
      (await writesSocketRoute(req, en, site, signedIn)).status;
    expect(await status(open({ origin: "https://evil.example" }))).toBe(403);
    expect(await status(open({ origin: "" }))).toBe(403);
    expect(await status(open({ "sec-websocket-protocol": WRITES_PROTOCOL }))).toBe(401);
    expect(await status(open({ "sec-websocket-protocol": "wren-notes, tok" }))).toBe(401);
    expect(await status(open({ "sec-websocket-protocol": `${WRITES_PROTOCOL}, bad` }))).toBe(401);
    expect(await status(open({ upgrade: "" }))).toBe(426);
    expect(await status(open(), env())).toBe(404);
    expect(await status(open(), e, { kind: "demo" })).toBe(404);
  });
});
