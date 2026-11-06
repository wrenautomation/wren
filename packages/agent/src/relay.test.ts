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

  it("file names keep one path segment", () => {
    expect(fileName("../../x.pdf")).toBe("x.pdf");
    expect(fileName("C:\\a\\b.png")).toBe("b.png");
    expect(fileName("..")).toBeNull();
    expect(fileName("a\u0000b.txt")).toBe("ab.txt");
  });
});
