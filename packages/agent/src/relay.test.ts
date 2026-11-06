/** The relay against a fake CLI child: synthetic frames, no `claude`, no model call. */
// biome-ignore-all lint/suspicious/noExplicitAny: wire frames, read loosely
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  type Authorize,
  CLOSE,
  fileName,
  type RelayOptions,
  relay,
  tokenMatches,
  uploadDir,
} from "./relay.js";
import { fileCommands, memoryCommands, memoryLedger } from "./sessions.js";
import type { Setup } from "./setup.js";

const dir = mkdtempSync(join(tmpdir(), "wren-agent-"));
const fake = join(dir, "fake-claude.mjs");
writeFileSync(
  fake,
  `import { createInterface } from "node:readline";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let model = "default";
createInterface({ input: process.stdin }).on("line", (l) => {
  const m = JSON.parse(l);
  const listed = ["compact", "demo:demo", "deploy"].map((name) => ({ name, description: "", argumentHint: "" }));
  if (m.type === "control_request" && m.request.subtype === "set_model") model = m.request.model;
  if (m.type === "control_request" && m.request.subtype === "get_context_usage") return out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: { totalTokens: 1200, maxTokens: model === "haiku" ? 200000 : 0, rawMaxTokens: 1000000, autoCompactThreshold: 167000, isAutoCompactEnabled: true } } });
  if (m.type === "control_request") return out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: { skills: m.request.skills ?? null, ...(m.request.subtype === "initialize" ? { commands: listed } : {}) } } });
  if (m.type !== "user") return;
  out({ type: "system", subtype: "init", apiKeySource: process.env.FAKE_SOURCE ?? "none", session_id: "s1" });
  if (m.message.content === "commands") out({ type: "system", subtype: "commands_changed", commands: listed.slice(0, 1) });
  out({ type: "result", subtype: "success", result: m.message.content, has_key: Boolean(process.env.ANTHROPIC_API_KEY), session_id: "s1" });
});
`,
);

const setup: Setup = {
  name: "demo",
  title: "Demo",
  app: "research",
  cwd: dir,
  model: "haiku",
  tools: ["Read"],
  skills: ["demo:demo"],
  plugins: [],
  allow: [],
  passEnv: ["FAKE_SOURCE"],
  credentials: ["plan"],
  connection: "sdk",
};

let port = 47900;
const spawned: string[][] = [];
let closeRelay: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closeRelay?.();
  closeRelay = undefined;
});

const byToken: Authorize = async ({ credential }) =>
  tokenMatches(credential, "tok") ? { who: "local", owner: false } : null;

const renamed: [string, string][] = [];

function start(
  host: Record<string, string> = {},
  authorize: Authorize = byToken,
  extra: Partial<RelayOptions> = {},
) {
  port += 1;
  const ledger = memoryLedger();
  const r = relay({
    port,
    authorize,
    ledger,
    history: {
      info: async (id) => ({ title: `title ${id}` }),
      messages: async (id) => [{ type: "user", session_id: id }],
      rename: async (id, _cwd, title) => void renamed.push([id, title]),
    },
    origins: ["https://app.wrenautomation.com"],
    setups: [setup],
    credential: { kind: "plan" },
    launch: {
      root: dir,
      host: { PATH: process.env.PATH ?? "", ANTHROPIC_API_KEY: "sk-host", ...host },
    },
    spawn: (_cmd, args, o) => {
      spawned.push([...args]);
      return spawn(process.execPath, [fake], o);
    },
    ...extra,
  });
  closeRelay = r.close;
  return new Promise<typeof ledger>((res) => r.server.on("listening", () => res(ledger)));
}

/** Opens a socket, sends frames, gathers frames until close or `until` matches. */
function session(path: string, send: object[], until?: (f: any) => boolean, origin?: string) {
  return new Promise<{ frames: any[]; code: number; reason: string }>((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, origin ? { origin } : {});
    const frames: any[] = [];
    ws.on("open", () => ws.send(send.map((f) => JSON.stringify(f)).join("\n")));
    ws.on("message", (d) => {
      for (const l of String(d).split("\n").filter(Boolean)) {
        const f = JSON.parse(l);
        frames.push(f);
        if (until?.(f)) ws.close();
      }
    });
    ws.on("close", (code, reason) => res({ frames, code, reason: String(reason) }));
    ws.on("error", () => res({ frames, code: -1, reason: "error" }));
  });
}

const auth = (token = "tok") => ({ type: "auth", credential: { type: "oauth", token } });
const user = (content: string) => ({
  type: "user",
  message: { role: "user", content },
  parent_tool_use_id: null,
  session_id: "",
});
const isResult = (f: { type: string }) => f.type === "result";

describe("relay", () => {
  it("runs a turn on the plan; the host key never reaches the child", async () => {
    await start();
    const init = {
      type: "control_request",
      request_id: "i1",
      request: { subtype: "initialize", skills: ["all"], systemPrompt: ["x"] },
    };
    const { frames } = await session(
      "/s/demo",
      [auth(), init, user("hello")],
      isResult,
      "https://app.wrenautomation.com",
    );
    expect(frames.find((f) => f.type === "control_response").response.response.skills).toEqual([
      "demo:demo",
    ]);
    expect(frames.find(isResult)).toMatchObject({ result: "hello", has_key: false });
  });

  it("ends a plan session whose init reports an API key", async () => {
    await start({ FAKE_SOURCE: "ANTHROPIC_API_KEY" });
    const { frames, code } = await session("/s/demo", [auth(), user("hi")]);
    expect(code).toBe(CLOSE.credential);
    expect(frames.some(isResult)).toBe(false);
  });

  it("refuses a bad token, an unknown setup, a foreign origin", async () => {
    await start();
    expect((await session("/s/demo", [auth("nope")])).code).toBe(CLOSE.unauthorized);
    expect((await session("/s/other", [auth()])).code).toBe(CLOSE.unknownSetup);
    expect((await session("/s/demo", [auth()], undefined, "https://evil.example")).code).toBe(-1);
  });

  it("holds frames sent while a slow authorize runs, then sends them in order", async () => {
    await start({}, async (a) => {
      await new Promise((r) => setTimeout(r, 300));
      return byToken(a);
    });
    const init = {
      type: "control_request",
      request_id: "i1",
      request: { subtype: "initialize" },
    };
    const { frames } = await session("/s/demo", [auth(), init, user("held")], isResult);
    expect(frames[0].type).toBe("control_response");
    expect(frames.find(isResult)).toMatchObject({ result: "held" });
  });

  it("refuses when authorize says no, and a resume of a session not in the ledger", async () => {
    await start({}, async () => null);
    expect((await session("/s/demo", [auth()])).code).toBe(CLOSE.unauthorized);
    await closeRelay?.();
    await start();
    expect((await session("/s/demo?resume=s9", [auth()])).code).toBe(CLOSE.unauthorized);
  });

  it("refuses a model the setup does not list, a bad effort, and bypass for a non-owner", async () => {
    await start();
    expect((await session("/s/demo?model=opus", [auth()])).code).toBe(CLOSE.setup);
    expect((await session("/s/demo?effort=huge", [auth()])).code).toBe(CLOSE.setup);
    expect((await session("/s/demo?mode=bypassPermissions", [auth()])).code).toBe(CLOSE.setup);
  });

  it("an owner setup opens for the owner only, on the socket and over HTTP", async () => {
    const maker: Setup = { ...setup, name: "maker", title: "Maker", owner: true };
    const sessions = () =>
      fetch(`http://127.0.0.1:${port}/s/maker/sessions`, {
        headers: { authorization: "Bearer tok" },
      });
    await start({}, byToken, { setups: [setup, maker] });
    expect((await session("/s/maker", [auth()])).code).toBe(CLOSE.unauthorized);
    expect((await sessions()).status).toBe(401);
    const list = (await (await fetch(`http://127.0.0.1:${port}/setups`)).json()) as any[];
    expect(list.map((s) => s.owner)).toEqual([undefined, true]);
    await closeRelay?.();
    await start({}, async () => ({ who: "local", owner: true }), { setups: [setup, maker] });
    const { frames } = await session("/s/maker", [auth(), user("one")], isResult);
    expect(frames.some(isResult)).toBe(true);
    expect((await sessions()).status).toBe(200);
  });

  it("lists setups, and only the asker's own sessions with their history", async () => {
    const ledger = await start();
    await session("/s/demo", [auth(), user("one")], isResult);
    ledger.add({ setup: "demo", session: "s-other", who: "sam@x.example", at: "2026-01-01" });
    const get = (path: string, token?: string) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
    expect(await (await get("/setups")).json()).toMatchObject([
      { name: "demo", models: ["haiku"], tools: ["Read"] },
    ]);
    expect((await get("/s/demo/sessions")).status).toBe(401);
    expect(await (await get("/s/demo/sessions", "tok")).json()).toEqual([
      expect.objectContaining({ session: "s1", title: "title s1" }),
    ]);
    expect(await (await get("/s/demo/sessions/s1", "tok")).json()).toEqual([
      { type: "user", session_id: "s1" },
    ]);
    expect((await get("/s/demo/sessions/s-other", "tok")).status).toBe(404);
    const patch = (path: string, body: unknown) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        method: "PATCH",
        headers: { authorization: "Bearer tok" },
        body: JSON.stringify(body),
      });
    expect((await patch("/s/demo/sessions/s-other", { title: "x" })).status).toBe(404);
    expect((await patch("/s/demo/sessions/s1", { title: "  " })).status).toBe(400);
    expect((await patch("/s/demo/sessions/s1", { title: " Coach  tools " })).status).toBe(200);
    expect(renamed).toEqual([["s1", "Coach tools"]]);
    const pre = await fetch(`http://127.0.0.1:${port}/setups`, {
      method: "OPTIONS",
      headers: { origin: "https://app.wrenautomation.com" },
    });
    expect(pre.headers.get("access-control-allow-private-network")).toBe("true");
  });

  it("keeps the last command list: a new chat gets it before a turn, cut to the asker", async () => {
    const commands = (token?: string) =>
      fetch(`http://127.0.0.1:${port}/s/demo/commands`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
    const names = async (token: string) =>
      ((await (await commands(token)).json()) as { name: string }[]).map((c) => c.name);
    await start();
    // no session yet: the relay asks the CLI with initialize alone, then the probe ends
    const before = spawned.length;
    expect(await names("tok")).toEqual(["compact", "demo:demo"]);
    expect(spawned.length).toBe(before + 1);
    expect(await names("tok")).toEqual(["compact", "demo:demo"]);
    expect(spawned.length).toBe(before + 1);
    const { frames } = await session("/s/demo", [auth(), user("commands")], isResult);
    expect(frames.find((f) => f.subtype === "commands_changed").commands).toHaveLength(1);
    expect(await names("tok")).toEqual(["compact"]);
    expect((await commands()).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${port}/s/nope/commands`)).status).toBe(404);
    const store = memoryCommands();
    store.set("demo", [{ name: "deploy" }]);
    await closeRelay?.();
    await start({}, async () => ({ who: "local", owner: true }), { commands: store });
    expect(await names("tok")).toEqual(["deploy"]);
  });

  it("reads a fresh chat's meter per model in the same probe", async () => {
    await start();
    const before = spawned.length;
    const context = (token?: string) =>
      fetch(`http://127.0.0.1:${port}/s/demo/context`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
    const meter = {
      haiku: { used: 1200, max: 200000, raw: 1000000, compactAt: 167000, autoCompact: true },
    };
    expect(await (await context("tok")).json()).toEqual(meter);
    expect(await (await context("tok")).json()).toEqual(meter);
    expect(spawned.length).toBe(before + 1);
    expect((await context()).status).toBe(401);
  });

  it("answers a widening control request with an error", async () => {
    await start();
    const bad = {
      type: "control_request",
      request_id: "b1",
      request: { subtype: "mcp_set_servers", servers: {} },
    };
    const { frames } = await session(
      "/s/demo",
      [auth(), bad],
      (f) => f.type === "control_response",
    );
    expect(frames[0].response).toMatchObject({ subtype: "error", request_id: "b1" });
  });

  it("stores a sent file in the asker's folder, and the child may read it", async () => {
    const uploads = mkdtempSync(join(tmpdir(), "wren-up-"));
    await start({}, byToken, { uploads, uploadCap: 16 });
    const post = (name: string, body: string, token?: string) =>
      fetch(`http://127.0.0.1:${port}/s/demo/files?name=${encodeURIComponent(name)}`, {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body,
      });
    expect((await post("a.txt", "hi")).status).toBe(401);
    const ok = await post("../../etc/clip.mp4", "frames", "tok");
    const { path } = (await ok.json()) as { path: string };
    const mine = uploadDir(uploads, "local");
    expect(path.startsWith(`${mine}/`)).toBe(true);
    expect(path.endsWith("/clip.mp4")).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("frames");
    const before = readdirSync(mine).length;
    expect((await post("big.bin", "x".repeat(64), "tok")).status).toBe(413);
    expect(readdirSync(mine).length).toBe(before);
    await session("/s/demo", [auth(), user("one")], isResult);
    const args = spawned.at(-1) ?? [];
    expect(args[args.indexOf("--add-dir") + 1]).toBe(mine);
    expect(existsSync(mine)).toBe(true);
  });

  it("shows an image or video by path: the owner any, anyone else their folders", async () => {
    const uploads = mkdtempSync(join(tmpdir(), "wren-up-"));
    const away = mkdtempSync(join(tmpdir(), "wren-away-"));
    const mine = uploadDir(uploads, "local");
    mkdirSync(mine, { recursive: true });
    writeFileSync(join(mine, "shot.png"), "png");
    writeFileSync(join(away, "far.png"), "far");
    writeFileSync(join(away, "key"), "secret");
    symlinkSync(join(away, "key"), join(mine, "key.png"));
    let owner = false;
    await start({}, async (a) => ((await byToken(a)) ? { who: "local", owner } : null), {
      uploads,
    });
    const get = (path: string, token: string | null = "tok") =>
      fetch(`http://127.0.0.1:${port}/s/demo/file?path=${encodeURIComponent(path)}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
    expect((await get(join(mine, "shot.png"), null)).status).toBe(401);
    const ok = await get(join(mine, "shot.png"));
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(await ok.text()).toBe("png");
    expect((await get(join(away, "far.png"))).status).toBe(403);
    expect((await get(join(mine, "key.png"))).status).toBe(415);
    expect((await get("shot.png")).status).toBe(400);
    expect((await get(join(mine, "none.png"))).status).toBe(404);
    owner = true;
    expect(await (await get(join(away, "far.png"))).text()).toBe("far");
    expect((await get(join(away, "key"))).status).toBe(415);
  });

  it("a file command store keeps lists across restarts; a torn file starts empty", () => {
    const path = join(dir, "commands.json");
    fileCommands(path).set("demo", [{ name: "compact" }]);
    expect(fileCommands(path).get("demo")).toEqual([{ name: "compact" }]);
    writeFileSync(path, "{torn");
    expect(fileCommands(path).get("demo")).toBeUndefined();
  });

  it("file names keep one path segment", () => {
    expect(fileName("../../x.pdf")).toBe("x.pdf");
    expect(fileName("C:\\a\\b.png")).toBe("b.png");
    expect(fileName("..")).toBeNull();
    expect(fileName("a\u0000b.txt")).toBe("ab.txt");
  });
});

describe("headless runs", () => {
  const post = (path: string, body?: object, token = "tok") =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const get = async (path: string, token = "tok") =>
    (
      await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json() as Promise<any>;
  const settled = async (id: string) => {
    for (let i = 0; i < 100; i++) {
      const r = await get(`/s/demo/runs/${id}`);
      if (r.ended) return r;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error("run did not end");
  };

  it("queues a run, ends it on the result, and puts its session in the ledger", async () => {
    const ledger = await start();
    expect((await post("/s/demo/runs", { prompt: "hi" }, "bad")).status).toBe(401);
    expect((await post("/s/demo/runs", {})).status).toBe(400);
    expect((await post("/s/demo/runs", { prompt: "hi", model: "opus" })).status).toBe(400);
    const res = await post("/s/demo/runs", { prompt: "make sample 3" });
    expect(res.status).toBe(202);
    const run = await settled(((await res.json()) as any).id);
    expect(run).toMatchObject({
      state: "done",
      result: "make sample 3",
      session: "s1",
      denied: [],
    });
    expect(ledger.list("demo", "local").map((r) => r.session)).toEqual(["s1"]);
    expect((await get("/s/demo/runs")).map((r: any) => r.id)).toEqual([run.id]);
    expect((await post(`/s/demo/runs/${run.id}/stop`)).status).toBe(200);
    expect((await get(`/s/demo/runs/${run.id}`)).state).toBe("done");
  });

  it("denies an ask, since no person answers", async () => {
    const asker = join(dir, "asker.mjs");
    writeFileSync(
      asker,
      `import { createInterface } from "node:readline";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
createInterface({ input: process.stdin }).on("line", (l) => {
  const m = JSON.parse(l);
  if (m.type === "user") out({ type: "control_request", request_id: "a1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "rm x" } } });
  if (m.type === "control_response" && m.response.request_id === "a1") out({ type: "result", subtype: "success", result: m.response.response.behavior, session_id: "s2" });
});
`,
    );
    await start({}, byToken, { spawn: (_c, _a, o) => spawn(process.execPath, [asker], o) });
    const res = await post("/s/demo/runs", { prompt: "go" });
    const run = await settled(((await res.json()) as any).id);
    expect(run.result).toBe("deny");
    expect(run.denied).toEqual(['Bash {"command":"rm x"}']);
  });

  it("holds runs over the cap in a queue, and stops one that waits", async () => {
    const slow = join(dir, "slow.mjs");
    writeFileSync(
      slow,
      `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (l) => {
  const m = JSON.parse(l);
  if (m.type === "user") setTimeout(() => process.stdout.write(JSON.stringify({ type: "result", subtype: "success", result: "late" }) + "\\n"), 300);
});
`,
    );
    await start({}, byToken, {
      maxRuns: 1,
      spawn: (_c, _a, o) => spawn(process.execPath, [slow], o),
    });
    const a = (await (await post("/s/demo/runs", { prompt: "a" })).json()) as any;
    const b = (await (await post("/s/demo/runs", { prompt: "b" })).json()) as any;
    const c = (await (await post("/s/demo/runs", { prompt: "c" })).json()) as any;
    expect([a.state, b.state, c.state]).toEqual(["running", "queued", "queued"]);
    expect(((await (await post(`/s/demo/runs/${c.id}/stop`)).json()) as any).state).toBe("stopped");
    expect((await settled(a.id)).state).toBe("done");
    expect((await settled(b.id)).result).toBe("late");
    expect((await get(`/s/demo/runs/${c.id}`)).started).toBeUndefined();
  });

  it("a `runs` session gets its own token: it starts runs as its person, a run gets none", async () => {
    const teller = join(dir, "teller.mjs");
    writeFileSync(
      teller,
      `import { createInterface } from "node:readline";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
createInterface({ input: process.stdin }).on("line", (l) => {
  const m = JSON.parse(l);
  if (m.type === "user") out({ type: "result", subtype: "success", result: [process.env.WREN_AGENT_URL ?? "", process.env.WREN_AGENT_TOKEN ?? ""].join(" ") });
});
`,
    );
    const chat: Setup = { ...setup, name: "chat", runs: true };
    const maker: Setup = { ...setup, name: "maker", app: "campaigns", owner: true };
    await start({}, byToken, {
      setups: [chat, maker, setup],
      spawn: (_c, _a, o) => spawn(process.execPath, [teller], o),
    });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/s/chat`);
    const told = await new Promise<string>((res) => {
      ws.on("open", () => ws.send([auth(), user("hi")].map((f) => JSON.stringify(f)).join("\n")));
      ws.on("message", (d) => {
        for (const l of String(d).split("\n").filter(Boolean)) {
          const f = JSON.parse(l);
          if (f.type === "result") res(String(f.result));
        }
      });
    });
    const [url, token] = told.split(" ") as [string, string];
    expect(url).toBe(`http://127.0.0.1:${port}`);
    // not the owner: no maker; another app: no
    expect((await post("/s/maker/runs", { prompt: "x" }, token)).status).toBe(401);
    const res = await post("/s/demo/runs", { prompt: "x" }, token);
    expect(res.status).toBe(202);
    const run = await settled(((await res.json()) as any).id);
    expect(run.result).toBe(" ");
    // the chat closed: its token is dead
    ws.close();
    await new Promise((r) => setTimeout(r, 300));
    expect((await post("/s/demo/runs", { prompt: "x" }, token)).status).toBe(401);
  });
});
