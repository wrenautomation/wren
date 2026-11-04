/**
 * The relay: one WebSocket per session at `ws://127.0.0.1:<port>/s/<setup>?resume=<id>&model=<m>`, one
 * `claude` child per socket. Frames are the CLI's own stream-json (NDJSON), which the Agent SDK's
 * `./browser` `query({websocket})` speaks, so the page holds the whole SDK and the relay parses
 * only to filter (filter.ts), to guard the credential (guard.ts) and to note the session id.
 * HTTP on the same port: `GET /setups`, and a person's own sessions (designs/2026-11-04-multi-user-runtime.md,
 * Decisions 4 and 5). `authorize` decides who may open which setup; the relay holds no access model.
 */
import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createInterface } from "node:readline";
import { type WebSocket, WebSocketServer } from "ws";
import { inbound } from "./filter.js";
import { credentialBreach } from "./guard.js";
import { type Credential, LaunchError, type LaunchOptions, launch, setupCwd } from "./launch.js";
import { type Ledger, memoryLedger } from "./sessions.js";
import type { Setup } from "./setup.js";

/** What the page sent: the auth frame's token (or a bearer) and its Origin, if any. */
export interface Asker {
  credential: string;
  origin: string | undefined;
  setup: Setup;
}

/** Who may open `setup`: an id for the ledger (an email, `local`), or null for no. */
export type Authorize = (a: Asker) => Promise<string | null>;

/** A setup's past sessions, read from the CLI's own store (the SDK's session readers). */
export interface History {
  info(session: string, cwd: string): Promise<{ title?: string; at?: string } | undefined>;
  messages(session: string, cwd: string): Promise<unknown[]>;
}

export interface RelayOptions {
  port: number;
  authorize: Authorize;
  /** Allowed `Origin` values; a client with no Origin (a local process) still needs `authorize`. */
  origins: readonly string[];
  setups: readonly Setup[];
  credential: Credential;
  launch: Omit<LaunchOptions, "resume" | "model">;
  /** The setup's CLI dirs, put before PATH (bins.ts). */
  binDirs?: (setup: Setup) => readonly string[];
  /** Live children at once; each `claude` holds a few hundred MB. */
  maxSessions?: number;
  ledger?: Ledger;
  history?: History;
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
const SESSION_PATH = /^\/s\/([\w-]+)(?:\/sessions(?:\/([\w-]+))?)?$/;

/** The local token as an `authorize` branch: constant-time, `local` in the ledger. */
export const tokenMatches = (got: string, token: string): boolean => {
  const a = Buffer.from(got);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function relay(o: RelayOptions): {
  server: WebSocketServer;
  close: () => Promise<void>;
} {
  const log = o.log ?? (() => {});
  const ledger = o.ledger ?? memoryLedger();
  const live = new Set<ChildProcess>();
  const http = createServer((req, res) => void answer(req, res));
  const server = new WebSocketServer({
    server: http,
    verifyClient: ({ origin }: { origin?: string }) => allowed(origin),
  });
  http.listen(o.port, "127.0.0.1");

  function allowed(origin: string | undefined): boolean {
    return !origin || o.origins.includes(origin);
  }

  server.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://relay");
    const m = SESSION_PATH.exec(url.pathname);
    const setup = m && !m[2] && !url.pathname.includes("/sessions") ? setupOf(m[1]) : undefined;
    if (!setup) return ws.close(CLOSE.unknownSetup, `no setup at ${url.pathname}`);
    if (live.size >= (o.maxSessions ?? 3)) return ws.close(CLOSE.busy, "too many sessions");

    const origin = req.headers.origin;
    const resume = url.searchParams.get("resume") ?? undefined;
    const model = url.searchParams.get("model") ?? undefined;
    if (model && model !== setup.model && !setup.models?.includes(model))
      return ws.close(CLOSE.setup, `setup ${setup.name} has no model ${model}`.slice(0, 120));
    let child: ChildProcess | undefined;
    let state: "auth" | "checking" | "open" | "closed" = "auth";
    // the SDK sends initialize and the first turn right after auth: held in order until let in
    const held: string[] = [];
    const timer = setTimeout(() => ws.close(CLOSE.unauthorized, "no auth frame"), AUTH_MS);

    const forward = (line: string) => {
      const r = inbound(line, setup);
      if (r.kind === "forward") child?.stdin?.write(`${r.line}\n`);
      else if (r.kind === "reply") ws.send(`${JSON.stringify(r.frame)}\n`);
      else if (!/keep_alive/.test(r.why)) log(`${setup.name}: dropped ${r.why}`);
    };

    ws.on("message", (data) => {
      for (const line of String(data).split("\n")) {
        if (!line.trim()) continue;
        if (state === "open") forward(line);
        else if (state === "checking") held.push(line);
        else if (state === "auth") {
          const credential = authToken(line);
          if (credential === null) return ws.close(CLOSE.unauthorized, "first frame is not auth");
          state = "checking";
          o.authorize({ credential, origin, setup })
            .catch((e) => {
              log(`${setup.name}: authorize failed: ${e instanceof Error ? e.message : e}`);
              return null;
            })
            .then((who) => {
              clearTimeout(timer);
              if (state === "closed") return;
              if (!who) return ws.close(CLOSE.unauthorized, "not allowed to open this setup");
              child = start(ws, setup, who, resume, model);
              if (!child) return;
              state = "open";
              for (const l of held.splice(0)) forward(l);
            });
        }
      }
    });
    ws.on("close", () => {
      state = "closed";
      clearTimeout(timer);
      stop(child);
    });
  });

  function setupOf(name: string | undefined): Setup | undefined {
    return o.setups.find((s) => s.name === name);
  }

  function start(
    ws: WebSocket,
    setup: Setup,
    who: string,
    resume: string | undefined,
    model: string | undefined,
  ): ChildProcess | undefined {
    if (resume && !ledger.list(setup.name, who).some((r) => r.session === resume)) {
      ws.close(CLOSE.unauthorized, "not your session");
      return undefined;
    }
    let l: ReturnType<typeof launch>;
    try {
      const binDirs = o.binDirs?.(setup) ?? o.launch.binDirs;
      l = launch(setup, o.credential, {
        ...o.launch,
        resume,
        model,
        ...(binDirs ? { binDirs } : {}),
      });
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
    log(`${setup.name}: started pid ${child.pid} for ${who}${resume ? ` resume ${resume}` : ""}`);

    let noted = false;
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
      const session = initSession(frame);
      if (session && !noted) {
        noted = true;
        ledger.add({ setup: setup.name, session, who, at: new Date().toISOString() });
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

  async function answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    if (!allowed(origin)) return send(res, 403, { error: "origin not allowed" });
    if (origin) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("access-control-allow-methods", "GET");
      res.setHeader("access-control-allow-headers", "authorization");
      // Chrome's local network access: a public origin asking 127.0.0.1
      res.setHeader("access-control-allow-private-network", "true");
      res.writeHead(204).end();
      return;
    }
    if (req.method !== "GET") return send(res, 405, { error: "GET only" });
    const url = new URL(req.url ?? "/", "http://relay");
    if (url.pathname === "/setups")
      return send(
        res,
        200,
        o.setups.map((s) => ({
          name: s.name,
          title: s.title,
          app: s.app,
          model: s.model,
          models: [s.model, ...(s.models ?? []).filter((m) => m !== s.model)],
          tools: s.tools,
          skills: s.skills,
        })),
      );
    const m = SESSION_PATH.exec(url.pathname);
    const setup = m && url.pathname.includes("/sessions") ? setupOf(m[1]) : undefined;
    if (!setup) return send(res, 404, { error: "not found" });
    const credential = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const who = credential
      ? await o.authorize({ credential, origin, setup }).catch(() => null)
      : null;
    if (!who) return send(res, 401, { error: "not allowed to open this setup" });
    const mine = ledger.list(setup.name, who);
    const cwd = setupCwd(setup, o.launch.root);
    const session = m?.[2];
    try {
      if (!session) {
        const rows = await Promise.all(
          mine.slice(0, 50).map(async (r) => ({
            session: r.session,
            at: r.at,
            ...(await o.history?.info(r.session, cwd).catch(() => undefined)),
          })),
        );
        return send(res, 200, rows);
      }
      if (!mine.some((r) => r.session === session))
        return send(res, 404, { error: "no such session" });
      return send(res, 200, (await o.history?.messages(session, cwd)) ?? []);
    } catch (e) {
      log(`${setup.name}: history failed: ${e instanceof Error ? e.message : e}`);
      return send(res, 500, { error: "could not read the session" });
    }
  }

  return {
    server,
    close: () =>
      new Promise<void>((res) => {
        for (const c of live) stop(c);
        for (const c of server.clients) c.terminate();
        server.close(() => http.close(() => res()));
      }),
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

/** `{type:"auth", credential:{type:"oauth", token}}`: the SDK's authMessage shape. */
function authToken(line: string): string | null {
  try {
    const m = JSON.parse(line) as { type?: string; credential?: { token?: unknown } };
    const got = m.type === "auth" ? m.credential?.token : undefined;
    return typeof got === "string" && got ? got : null;
  } catch {
    return null;
  }
}

/** The session id from the CLI's `system/init`. */
function initSession(frame: unknown): string | undefined {
  const f = frame as { type?: string; subtype?: string; session_id?: unknown };
  return f.type === "system" && f.subtype === "init" && typeof f.session_id === "string"
    ? f.session_id
    : undefined;
}
