/**
 * The relay: one WebSocket per session at `ws://127.0.0.1:<port>/s/<setup>?resume=<id>&model=<m>`, one
 * `claude` child per socket. Frames are the CLI's own stream-json (NDJSON), which the Agent SDK's
 * `./browser` `query({websocket})` speaks, so the page holds the whole SDK and the relay parses
 * only to filter (filter.ts), to guard the credential (guard.ts) and to note the session id.
 * HTTP on the same port: `GET /setups`, a person's own sessions (designs/2026-11-04-multi-user-runtime.md,
 * Decisions 4 and 5), and an image or video by path for its preview (`GET /s/<setup>/file`). `authorize` decides who may open which setup; the relay holds no access model.
 */
import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFileSync, createReadStream, createWriteStream, mkdirSync, rmSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, sep } from "node:path";
import { createInterface } from "node:readline";
import { type WebSocket, WebSocketServer } from "ws";
import { EFFORTS, inbound, modeAllowed, outbound } from "./filter.js";
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

/** Who opened a setup: an id for the ledger (an email, `local`); `owner` is the Mac's owner. */
export interface Person {
  who: string;
  owner: boolean;
}

/** Who may open `setup`, or null for no. */
export type Authorize = (a: Asker) => Promise<Person | null>;

/** A setup's past sessions, read from the CLI's own store (the SDK's session readers). */
export interface History {
  info(session: string, cwd: string): Promise<{ title?: string; at?: string } | undefined>;
  messages(session: string, cwd: string): Promise<unknown[]>;
  /** The person's own name for a chat; the CLI keeps it in the session file. */
  rename(session: string, cwd: string, title: string): Promise<void>;
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
  /** Root for chat files (`POST /s/<setup>/files`), one folder per person; none = no uploads. */
  uploads?: string;
  /** Bytes per file; default 500 MB. */
  uploadCap?: number;
  log?: (line: string) => void;
  /** Dir for one JSONL per session, both ways (`{at, from, frame}`): a story's fixture, scrubbed first. */
  tape?: string;
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
const FILES_PATH = /^\/s\/([\w-]+)\/files$/;
const UPLOAD_CAP = 500 * 1024 * 1024;
const FILE_PATH = /^\/s\/([\w-]+)\/file$/;
const SHOW_CAP = 50 * 1024 * 1024;
/** What a preview may show; the type is the real file's, after links. */
const SHOWN: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

/** Chat files on this Mac, never inside a repo folder. */
export const UPLOADS_DIR = join(homedir(), ".config", "wren", "agent-uploads");

/** A person's upload folder: a hash, so no email lands in a path. */
export const uploadDir = (root: string, who: string): string =>
  join(root, createHash("sha256").update(who).digest("hex").slice(0, 16));

/** A file name safe for one path segment; null when nothing is left. */
export function fileName(raw: string): string | null {
  const n = basename(raw.replace(/\\/g, "/"))
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strips them
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  return n && n !== "." && n !== ".." ? n : null;
}

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
    const effort = url.searchParams.get("effort") ?? undefined;
    if (effort && !EFFORTS.includes(effort as (typeof EFFORTS)[number]))
      return ws.close(CLOSE.setup, `no effort ${effort}`.slice(0, 120));
    // checked once the person is known: bypass is the owner's only
    const mode = url.searchParams.get("mode") ?? undefined;
    let owner = false;
    let child: ChildProcess | undefined;
    let state: "auth" | "checking" | "open" | "closed" = "auth";
    // the SDK sends initialize and the first turn right after auth: held in order until let in
    const held: string[] = [];
    const timer = setTimeout(() => ws.close(CLOSE.unauthorized, "no auth frame"), AUTH_MS);

    const tape = o.tape ? taper(o.tape, setup.name) : undefined;
    // the relay's own replies: taped too, so a replay shows what the page saw
    const said = (f: unknown) => {
      const line = JSON.stringify(f);
      tape?.("relay", line);
      ws.send(`${line}\n`);
    };
    const forward = (line: string) => {
      tape?.("page", line);
      const r = inbound(line, setup, owner);
      if (r.kind === "forward") child?.stdin?.write(`${r.line}\n`);
      else if (r.kind === "reply") said(r.frame);
      else if (r.kind === "answer") for (const f of r.frames) said(f);
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
            .then((p) => {
              clearTimeout(timer);
              if (state === "closed") return;
              if (!p) return ws.close(CLOSE.unauthorized, "not allowed to open this setup");
              if (mode && !modeAllowed(setup, mode, p.owner))
                return ws.close(CLOSE.setup, `permission mode ${mode} is not allowed here`);
              owner = p.owner;
              child = start(ws, setup, p, resume, { model, effort, mode }, tape);
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
    { who, owner }: Person,
    resume: string | undefined,
    pick: { model?: string | undefined; effort?: string | undefined; mode?: string | undefined },
    tape?: Tape,
  ): ChildProcess | undefined {
    if (resume && !ledger.list(setup.name, who).some((r) => r.session === resume)) {
      ws.close(CLOSE.unauthorized, "not your session");
      return undefined;
    }
    let l: ReturnType<typeof launch>;
    try {
      const binDirs = o.binDirs?.(setup) ?? o.launch.binDirs;
      const mine = o.uploads ? uploadDir(o.uploads, who) : undefined;
      // made before spawn: --add-dir needs it, and a file sent mid-chat reads without a restart
      if (mine) mkdirSync(mine, { recursive: true, mode: 0o700 });
      l = launch(setup, o.credential, {
        ...o.launch,
        resume,
        ...pick,
        owner,
        ...(binDirs ? { binDirs } : {}),
        ...(mine ? { addDirs: [mine] } : {}),
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

    // `/clear` starts a new session in the same child: each id goes in the ledger
    const noted = new Set<string>();
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
      if (session && !noted.has(session)) {
        noted.add(session);
        ledger.add({ setup: setup.name, session, who, at: new Date().toISOString() });
      }
      const out = outbound(frame, setup, owner);
      const sent = out === frame ? line : JSON.stringify(out);
      tape?.("cli", sent);
      if (ws.readyState === ws.OPEN) ws.send(`${sent}\n`);
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
      res.setHeader("access-control-allow-methods", "GET, POST, PATCH");
      res.setHeader("access-control-allow-headers", "authorization, content-type");
      // Chrome's local network access: a public origin asking 127.0.0.1
      res.setHeader("access-control-allow-private-network", "true");
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://relay");
    if (req.method === "POST" && FILES_PATH.test(url.pathname)) return upload(req, res, url);
    if (req.method === "PATCH") return rename(req, res, url);
    if (req.method !== "GET") return send(res, 405, { error: "GET only" });
    if (FILE_PATH.test(url.pathname)) return show(req, res, url);
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
          ...(s.mode ? { mode: s.mode } : {}),
        })),
      );
    const m = SESSION_PATH.exec(url.pathname);
    const setup = m && url.pathname.includes("/sessions") ? setupOf(m[1]) : undefined;
    if (!setup) return send(res, 404, { error: "not found" });
    const credential = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const who = credential
      ? (await o.authorize({ credential, origin, setup }).catch(() => null))?.who
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

  /** `{title}` for one of the person's own sessions; an empty title is refused. */
  async function rename(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const m = SESSION_PATH.exec(url.pathname);
    const setup = m?.[2] ? setupOf(m[1]) : undefined;
    if (!setup || !m?.[2] || !o.history) return send(res, 404, { error: "not found" });
    const credential = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const who = credential
      ? (await o.authorize({ credential, origin: req.headers.origin, setup }).catch(() => null))
          ?.who
      : null;
    if (!who) return send(res, 401, { error: "not allowed to open this setup" });
    const session = m[2];
    if (!ledger.list(setup.name, who).some((r) => r.session === session))
      return send(res, 404, { error: "no such session" });
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 2048) return send(res, 413, { error: "title too long" });
    }
    let title = "";
    try {
      const t = (JSON.parse(body) as { title?: unknown }).title;
      title = typeof t === "string" ? t.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    } catch {}
    if (!title) return send(res, 400, { error: "a title is needed" });
    try {
      await o.history.rename(session, setupCwd(setup, o.launch.root), title);
      log(`${setup.name}: ${who} renamed ${session}`);
      return send(res, 200, { session, title });
    } catch (e) {
      log(`${setup.name}: rename failed: ${e instanceof Error ? e.message : e}`);
      return send(res, 500, { error: "could not rename the chat" });
    }
  }

  /** `?path=` (absolute or `~/`): an image or video for its preview. The owner, any file of theirs;
   * anyone else, their own uploads and the setup's folder. */
  async function show(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const setup = setupOf(FILE_PATH.exec(url.pathname)?.[1]);
    if (!setup) return send(res, 404, { error: "not found" });
    const credential = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const person = credential
      ? await o.authorize({ credential, origin: req.headers.origin, setup }).catch(() => null)
      : null;
    if (!person) return send(res, 401, { error: "not allowed to open this setup" });
    const raw = url.searchParams.get("path") ?? "";
    const path = raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
    if (!isAbsolute(path)) return send(res, 400, { error: "a full path is needed" });
    let real: string;
    try {
      real = await realpath(path);
    } catch {
      return send(res, 404, { error: "no such file" });
    }
    const type = SHOWN[extname(real).slice(1).toLowerCase()];
    if (!type) return send(res, 415, { error: "images and videos only" });
    if (!person.owner) {
      const roots = [
        setupCwd(setup, o.launch.root),
        ...(o.uploads ? [uploadDir(o.uploads, person.who)] : []),
      ];
      const realRoots = await Promise.all(roots.map((r) => realpath(r).catch(() => null)));
      if (!realRoots.some((r) => r && (real === r || real.startsWith(r + sep))))
        return send(res, 403, { error: "that file is outside this chat's folders" });
    }
    const st = await stat(real).catch(() => null);
    if (!st?.isFile()) return send(res, 404, { error: "no such file" });
    if (st.size > SHOW_CAP) return send(res, 413, { error: "too big to preview" });
    res.writeHead(200, {
      "content-type": type,
      "content-length": String(st.size),
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    });
    createReadStream(real)
      .on("error", () => res.destroy())
      .pipe(res);
  }

  /** Raw body, `?name=`; streamed to disk under the person's folder; answers the path. */
  async function upload(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const setup = setupOf(FILES_PATH.exec(url.pathname)?.[1]);
    if (!setup || !o.uploads) return send(res, 404, { error: "not found" });
    const credential = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const who = credential
      ? (await o.authorize({ credential, origin: req.headers.origin, setup }).catch(() => null))
          ?.who
      : null;
    if (!who) return send(res, 401, { error: "not allowed to open this setup" });
    const name = fileName(url.searchParams.get("name") ?? "");
    if (!name) return send(res, 400, { error: "name the file" });
    const cap = o.uploadCap ?? UPLOAD_CAP;
    if (Number(req.headers["content-length"] ?? 0) > cap)
      return send(res, 413, { error: `files stop at ${Math.round(cap / 1024 / 1024)} MB` });
    const dir = join(uploadDir(o.uploads, who), randomUUID());
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, name);
    const out = createWriteStream(path, { mode: 0o600 });
    let bytes = 0;
    let over = false;
    const drop = () => rmSync(dir, { recursive: true, force: true });
    req.on("data", (c: Buffer) => {
      bytes += c.length;
      if (bytes > cap && !over) {
        over = true;
        req.unpipe(out);
        out.destroy();
        drop();
        send(res, 413, { error: `files stop at ${Math.round(cap / 1024 / 1024)} MB` });
        req.resume();
      }
    });
    req.pipe(out);
    out.on("finish", () => {
      if (over) return;
      log(`${setup.name}: ${who} sent ${name} (${bytes} B)`);
      send(res, 200, { path, name, bytes });
    });
    out.on("error", (e) => {
      if (over) return;
      drop();
      log(`${setup.name}: upload failed: ${e.message}`);
      send(res, 500, { error: "could not store the file" });
    });
    req.on("aborted", () => {
      out.destroy();
      drop();
    });
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

type Tape = (from: "page" | "cli" | "relay", line: string) => void;

/** One file per session; the auth frame never reaches it (taped after auth only). */
function taper(dir: string, setup: string): Tape {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${setup}-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  return (from, line) => {
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch {
      return;
    }
    appendFileSync(file, `${JSON.stringify({ at: Date.now(), from, frame })}\n`, { mode: 0o600 });
  };
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
