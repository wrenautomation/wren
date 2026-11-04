/**
 * The relay: one WebSocket per session at `ws://127.0.0.1:<port>/s/<setup>?resume=<id>`, one
 * `claude` child per socket. Frames are the CLI's own stream-json (NDJSON), which the Agent SDK's
 * `./browser` `query({websocket})` speaks, so the page holds the whole SDK and the relay parses
 * only to filter (filter.ts) and to guard the credential (guard.ts).
 */
import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { type WebSocket, WebSocketServer } from "ws";
import { inbound } from "./filter.js";
import { credentialBreach } from "./guard.js";
import { type Credential, LaunchError, type LaunchOptions, launch } from "./launch.js";
import type { Setup } from "./setup.js";

export interface RelayOptions {
  port: number;
  /** Shared with the page once; the first frame must carry it (the SDK's `authMessage`). */
  token: string;
  /** Allowed `Origin` values; a client with no Origin (a local process) still needs the token. */
  origins: readonly string[];
  setups: readonly Setup[];
  credential: Credential;
  launch: Omit<LaunchOptions, "resume">;
  /** The setup's CLI dirs, put before PATH (bins.ts). */
  binDirs?: (setup: Setup) => readonly string[];
  /** Live children at once; each `claude` holds a few hundred MB. */
  maxSessions?: number;
  log?: (line: string) => void;
  spawn?: (command: string, args: readonly string[], opts: SpawnOptions) => ChildProcess;
}

/** Close codes the page reads. */
export const CLOSE = {
  unknownSetup: 4404,
  busy: 4429,
  unauthorized: 4401,
  setup: 4400,
  credential: 4403,
  child: 4500,
} as const;

const AUTH_MS = 5000;

export function relay(o: RelayOptions): { server: WebSocketServer; close: () => Promise<void> } {
  const log = o.log ?? (() => {});
  const live = new Set<ChildProcess>();
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: o.port,
    verifyClient: ({ origin }: { origin?: string }) => !origin || o.origins.includes(origin),
  });

  server.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://relay");
    const name = /^\/s\/([\w-]+)$/.exec(url.pathname)?.[1];
    const setup = o.setups.find((s) => s.name === name);
    if (!setup) return ws.close(CLOSE.unknownSetup, `no setup ${name ?? url.pathname}`);
    if (live.size >= (o.maxSessions ?? 3)) return ws.close(CLOSE.busy, "too many sessions");

    let child: ChildProcess | undefined;
    const timer = setTimeout(() => ws.close(CLOSE.unauthorized, "no auth frame"), AUTH_MS);

    ws.on("message", (data) => {
      for (const line of String(data).split("\n")) {
        if (!line.trim()) continue;
        if (!child) {
          if (!authorized(line, o.token)) return ws.close(CLOSE.unauthorized, "bad token");
          clearTimeout(timer);
          child = start(ws, setup, url.searchParams.get("resume") ?? undefined);
          if (!child) return;
          continue;
        }
        const r = inbound(line, setup);
        if (r.kind === "forward") child.stdin?.write(`${r.line}\n`);
        else if (r.kind === "reply") ws.send(`${JSON.stringify(r.frame)}\n`);
        else if (!/keep_alive/.test(r.why)) log(`${setup.name}: dropped ${r.why}`);
      }
    });
    ws.on("close", () => {
      clearTimeout(timer);
      stop(child);
    });
  });

  function start(
    ws: WebSocket,
    setup: Setup,
    resume: string | undefined,
  ): ChildProcess | undefined {
    let l: ReturnType<typeof launch>;
    try {
      const binDirs = o.binDirs?.(setup) ?? o.launch.binDirs;
      l = launch(setup, o.credential, { ...o.launch, resume, ...(binDirs ? { binDirs } : {}) });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      log(`${setup.name}: launch failed: ${why}`);
      ws.close(CLOSE.setup, (e instanceof LaunchError ? why : "launch failed").slice(0, 120));
      return undefined;
    }
    mkdirSync(l.cwd, { recursive: true });
    const child = (o.spawn ?? nodeSpawn)(l.command, l.args, {
      cwd: l.cwd,
      env: l.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    live.add(child);
    log(`${setup.name}: started pid ${child.pid}${resume ? ` resume ${resume}` : ""}`);

    if (!child.stdout) return child;
    createInterface({ input: child.stdout }).on("line", (line) => {
      let frame: unknown;
      try {
        frame = JSON.parse(line);
      } catch {
        return;
      }
      const breach = credentialBreach(frame, o.credential);
      if (breach) {
        log(`${setup.name}: ${breach}`);
        stop(child);
        return ws.close(CLOSE.credential, breach.slice(0, 120));
      }
      if (ws.readyState === ws.OPEN) ws.send(`${line}\n`);
    });
    child.stderr?.on("data", (d) => log(`${setup.name}: ${String(d).trim().slice(0, 300)}`));
    child.on("exit", (code) => {
      live.delete(child);
      log(`${setup.name}: pid ${child.pid} exit ${code}`);
      if (ws.readyState === ws.OPEN)
        ws.close(code === 0 ? 1000 : CLOSE.child, `claude exit ${code}`);
    });
    child.on("error", (e) => {
      live.delete(child);
      if (ws.readyState === ws.OPEN) ws.close(CLOSE.child, e.message.slice(0, 120));
    });
    return child;
  }

  function stop(child: ChildProcess | undefined): void {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 3000).unref();
  }

  return {
    server,
    close: () =>
      new Promise<void>((res) => {
        for (const c of live) stop(c);
        for (const c of server.clients) c.terminate();
        server.close(() => res());
      }),
  };
}

/** `{type:"auth", credential:{type:"oauth", token}}`: the SDK's authMessage shape, our local token. */
function authorized(line: string, token: string): boolean {
  try {
    const m = JSON.parse(line) as { type?: string; credential?: { token?: unknown } };
    const got = m.type === "auth" ? m.credential?.token : undefined;
    if (typeof got !== "string") return false;
    const a = Buffer.from(got);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
