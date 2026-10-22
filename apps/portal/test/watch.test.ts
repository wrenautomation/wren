/**
 * Sends told live: the state of a write and why Restate is trying it again, the watch that
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
import { adminUrl, readWrite, reasonOf, retryOf } from "../src/writes.js";

const KEY = `portal:${"a".repeat(64)}`;
const INGRESS = "https://restate.test:8080/";

const env = (over: Partial<Env> = {}): Env => ({
  ASSETS: {} as Fetcher,
  DEMO_HOST: "demo.test",
  RESTATE_INGRESS_URL: INGRESS,
  RESTATE_AUTH_TOKEN: "tok",
  ...over,
});

type Asked = { url: string; sql?: string };

/** Restate as a fake: the output read answers `output`, each admin query the next of `rows`. */
function restate(output: () => Response, rows: unknown[][] | "down" = []) {
  const asked: Asked[] = [];
  let n = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/query")) {
      const sql = (JSON.parse(String(init?.body)) as { query: string }).query;
      asked.push({ url, sql });
      if (rows === "down") return new Response("no", { status: 503 });
      return Response.json({ rows: rows[n++] ?? [] });
    }
    asked.push({ url });
    return output();
  });
  return asked;
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

  it("while it sends, says why Restate is trying again: the deepest call that is failing", async () => {
    const asked = restate(
      () => new Response(null, { status: 470 }),
      [
        [{ id: "inv_1top", retry_count: 0, last_failure: null }],
        [
          {
            id: "inv_2child",
            retry_count: 3,
            last_failure:
              "[500] LinkedIn answered 400: object is required\n    at post (linkedin.ts:40)",
            modified_at: "2026-10-15T10:00:00Z",
          },
        ],
        [],
      ],
    );
    expect(await readWrite(env(), "MarketingConsole", "inboxReply", KEY)).toEqual({
      state: "sending",
      retry: { count: 3, reason: "[500] LinkedIn answered 400: object is required" },
    });
    const sql = asked.filter((a) => a.sql).map((a) => a.sql);
    expect(asked.find((a) => a.sql)?.url).toBe("https://restate.test:8080/admin/query");
    expect(sql[0]).toContain(
      `target_service_name = 'MarketingConsole' AND target_handler_name = 'inboxReply' AND idempotency_key = '${KEY}'`,
    );
    expect(sql[1]).toContain("invoked_by_id IN ('inv_1top')");
    expect(sql[2]).toContain("invoked_by_id IN ('inv_2child')");
  });

  it("sending with nothing failing, or the admin API down, has no reason and still answers", async () => {
    restate(() => new Response(null, { status: 470 }), [[{ id: "inv_1", retry_count: 0 }], []]);
    expect(await readWrite(env(), "MarketingConsole", "inboxReply", KEY)).toEqual({
      state: "sending",
    });
    restate(() => new Response(null, { status: 470 }), "down");
    expect(await readWrite(env(), "MarketingConsole", "inboxReply", KEY)).toEqual({
      state: "sending",
    });
  });

  it("never puts an unchecked value in the query", async () => {
    const asked = restate(() => new Response(null, { status: 470 }), [[]]);
    expect(
      await retryOf(env(), "MarketingConsole", "inboxReply", "portal:x' OR 1=1 --"),
    ).toBeNull();
    expect(await retryOf(env(), "Bad'Name", "inboxReply", KEY)).toBeNull();
    expect(asked).toEqual([]);
    // A child id that isn't Restate's shape stops the walk.
    const more = restate(
      () => new Response(null, { status: 470 }),
      [[{ id: "inv_1'; drop", retry_count: 1, last_failure: "boom" }]],
    );
    expect(await retryOf(env(), "MarketingConsole", "inboxReply", KEY)).toEqual({
      count: 1,
      reason: "boom",
    });
    expect(more.filter((a) => a.sql)).toHaveLength(1);
  });

  it("a reason is one line, short, with tokens hidden", () => {
    expect(reasonOf("first\nsecond")).toBe("first");
    expect(reasonOf("auth failed: Bearer abc.def")).toBe("auth failed: Bearer [hidden]");
    expect(reasonOf(`id ${"x".repeat(50)} bad`)).toBe("id [hidden] bad");
    expect(reasonOf("y ".repeat(200))).toBe("y ".repeat(200).trim());
  });

  it("finds the admin API: set, Restate Cloud's port, or /admin on the box", () => {
    expect(adminUrl(env({ RESTATE_ADMIN_URL: "https://admin.test/" }))).toBe("https://admin.test");
    expect(adminUrl(env({ RESTATE_INGRESS_URL: "https://abc.env.us.restate.cloud:8080" }))).toBe(
      "https://abc.env.us.restate.cloud:9070",
    );
    expect(adminUrl(env({ RESTATE_INGRESS_URL: "https://restate.box.test" }))).toBe(
      "https://restate.box.test/admin",
    );
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
    let rows: unknown[][] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) =>
      String(input).endsWith("/query") ? Response.json({ rows: rows.shift() ?? [] }) : output(),
    );
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

    // Restate starts retrying: the tab hears why.
    rows = [[{ id: "inv_a", retry_count: 2, last_failure: "LinkedIn is down" }], []];
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
