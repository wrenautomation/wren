/** The relay against a fake CLI child: synthetic frames, no `claude`, no model call. */
// biome-ignore-all lint/suspicious/noExplicitAny: wire frames, read loosely
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { type Authorize, CLOSE, relay, tokenMatches } from "./relay.js";
import { memoryLedger } from "./sessions.js";
import type { Setup } from "./setup.js";

const dir = mkdtempSync(join(tmpdir(), "wren-agent-"));
const fake = join(dir, "fake-claude.mjs");
writeFileSync(
  fake,
  `import { createInterface } from "node:readline";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
createInterface({ input: process.stdin }).on("line", (l) => {
  const m = JSON.parse(l);
  if (m.type === "control_request") return out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: { skills: m.request.skills ?? null } } });
  if (m.type !== "user") return;
  out({ type: "system", subtype: "init", apiKeySource: process.env.FAKE_SOURCE ?? "none", session_id: "s1" });
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
let closeRelay: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closeRelay?.();
  closeRelay = undefined;
});

const byToken: Authorize = async ({ credential }) =>
  tokenMatches(credential, "tok") ? "local" : null;

function start(host: Record<string, string> = {}, authorize: Authorize = byToken) {
  port += 1;
  const ledger = memoryLedger();
  const r = relay({
    port,
    authorize,
    ledger,
    history: {
      info: async (id) => ({ title: `title ${id}` }),
      messages: async (id) => [{ type: "user", session_id: id }],
    },
    origins: ["https://app.wrenautomation.com"],
    setups: [setup],
    credential: { kind: "plan" },
    launch: {
      root: dir,
      host: { PATH: process.env.PATH ?? "", ANTHROPIC_API_KEY: "sk-host", ...host },
    },
    spawn: (_cmd, _args, o) => spawn(process.execPath, [fake], o),
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

  it("refuses a model the setup does not list", async () => {
    await start();
    expect((await session("/s/demo?model=opus", [auth()])).code).toBe(CLOSE.setup);
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
    const pre = await fetch(`http://127.0.0.1:${port}/setups`, {
      method: "OPTIONS",
      headers: { origin: "https://app.wrenautomation.com" },
    });
    expect(pre.headers.get("access-control-allow-private-network")).toBe("true");
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
});
