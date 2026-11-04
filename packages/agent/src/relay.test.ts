/** The relay against a fake CLI child: synthetic frames, no `claude`, no model call. */
// biome-ignore-all lint/suspicious/noExplicitAny: wire frames, read loosely
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { CLOSE, relay } from "./relay.js";
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

function start(host: Record<string, string> = {}) {
  port += 1;
  const r = relay({
    port,
    token: "tok",
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
  return new Promise<void>((res) => r.server.on("listening", () => res()));
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
