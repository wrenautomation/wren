/**
 * Sends told live (designs/2026-10-15-one-write-path.md): one `WriteWatch` Durable Object per
 * signed-in person and site. A send the Worker hands to Restate is watched here: an alarm reads
 * its state (`readWrite`) with backoff and pushes each change, the retry reason too, to that
 * person's tabs over `/api/live/writes`. A tab that connects late gets every open write's last
 * state at once. Without the binding (the local preview) the route is 404 and tabs poll.
 *
 * The token rides in `Sec-WebSocket-Protocol` (`wren-writes, <token>`), as live notes do; the
 * origin must be this host.
 */
import { json } from "./edge.js";
import type { Env } from "./env.js";
import type { Site } from "./hosts.js";
import type { Viewer } from "./worker.js";
import { REQUEST_ID, readWrite, WRITE_KEY, type WriteState, writeTarget } from "./writes.js";

export const WRITES_LIVE_PATH = "/api/live/writes";
export const WRITES_PROTOCOL = "wren-writes";

/** First read a second after the send, then twice as long each time nothing moved, up to 10 s. */
export const FIRST_MS = 1000;
export const MAX_MS = 10_000;
/** A watch gives up after a day (Restate keeps the answer that long). */
export const GIVE_UP_MS = 24 * 3600_000;
/** Restate never heard of it this long after the send: the tab sends again, under a new watch. */
export const UNKNOWN_MS = 2 * 60_000;
/** A finished write stays this long, so a tab that reconnects still hears how it ended. */
export const KEEP_DONE_MS = 10 * 60_000;
export const WATCH_MAX = 200;
/** A sent write's answer rides along only below this size. */
const ANSWER_MAX = 32_000;

export interface Watch {
  requestId: string;
  path: string;
  key: string;
  svc: string;
  route: string;
  since: number;
  /** The next read; null when finished. */
  next: number | null;
  wait: number;
  state: WriteState | null;
  /** When it finished (sent or failed), to drop it later. */
  done: number | null;
}

/** What a tab hears: one write's state. */
export interface WriteNews {
  type: "write";
  path: string;
  requestId: string;
  state: WriteState;
}

/** The watch for one person on one site. */
export const watchName = (email: string, site: Site) =>
  `${email.toLowerCase()}\n${site.kind === "client" ? `client:${site.client}` : site.kind}`;

/** Watch a send the Worker just handed to Restate. Never throws. */
export async function watchWrite(
  env: Env,
  email: string,
  site: Site,
  w: { requestId: string; path: string; key: string },
): Promise<void> {
  if (!env.WRITE_WATCH) return;
  try {
    const ns = env.WRITE_WATCH;
    await ns.get(ns.idFromName(watchName(email, site))).fetch(
      new Request("https://write-watch/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(w),
      }),
    );
  } catch {
    // The tab polls instead.
  }
}

/** The socket's door: from our own page, signed in, never on the demo. */
export async function writesSocketRoute(
  req: Request,
  env: Env,
  site: Site,
  viewerOf: (req: Request) => Promise<Viewer | Response>,
): Promise<Response> {
  const url = new URL(req.url);
  if (site.kind === "demo" || !env.WRITE_WATCH) return json({ error: "not found" }, 404);
  if ((req.headers.get("upgrade") ?? "").toLowerCase() !== "websocket")
    return json({ error: "WebSocket only" }, 426);
  let from = "";
  try {
    from = new URL(req.headers.get("origin") ?? "").host;
  } catch {
    // No origin: refused below.
  }
  if (from !== url.host) return json({ error: "wrong origin" }, 403);
  const [proto, token] = (req.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((s) => s.trim());
  if (proto !== WRITES_PROTOCOL || !token) return json({ error: "Sign in." }, 401);
  const viewer = await viewerOf(
    new Request(req.url, { headers: { authorization: `Bearer ${token}` } }),
  );
  if (viewer instanceof Response) return viewer;
  if ("demo" in viewer) return json({ error: "Sign in." }, 401);
  const ns = env.WRITE_WATCH;
  return ns
    .get(ns.idFromName(watchName(viewer.email, site)))
    .fetch(new Request("https://write-watch/socket", { headers: { upgrade: "websocket" } }));
}

/** The bits of a socket the watch uses (a test hands in fakes). */
export interface WatchSocket {
  send(frame: string): void;
  close(code?: number, reason?: string): void;
}

const slim = (state: WriteState): WriteState =>
  state.state === "sent" && JSON.stringify(state.answer ?? null).length > ANSWER_MAX
    ? { state: "sent", answer: null }
    : state;

export class WriteWatch implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly bindings: Env,
    private readonly now: () => number = Date.now,
  ) {}

  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === "/watch" && req.method === "POST") {
      let asked: { requestId?: unknown; path?: unknown; key?: unknown };
      try {
        asked = (await req.json()) as typeof asked;
      } catch {
        return json({ error: "not json" }, 400);
      }
      const ok = await this.watch({
        requestId: String(asked.requestId ?? ""),
        path: String(asked.path ?? ""),
        key: String(asked.key ?? ""),
      });
      return ok ? json({ watching: true }) : json({ error: "not a write" }, 400);
    }
    if (pathname === "/socket") {
      if ((req.headers.get("upgrade") ?? "").toLowerCase() !== "websocket")
        return json({ error: "WebSocket only" }, 426);
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.state.acceptWebSocket(server);
      await this.greet(server);
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { "sec-websocket-protocol": WRITES_PROTOCOL },
      });
    }
    return json({ error: "not found" }, 404);
  }

  /** Start watching a send. False when it isn't one. */
  async watch(w: { requestId: string; path: string; key: string }): Promise<boolean> {
    const target = writeTarget(w.path);
    if (!target || !REQUEST_ID.test(w.requestId) || !WRITE_KEY.test(w.key)) return false;
    const now = this.now();
    const store = this.state.storage;
    const id = `w:${w.requestId}`;
    const had = await store.get<Watch>(id);
    const watch: Watch = {
      ...w,
      ...target,
      since: had?.since ?? now,
      next: now + FIRST_MS,
      wait: FIRST_MS,
      state: had?.state ?? null,
      done: null,
    };
    await store.put(id, watch);
    // The oldest go past the cap.
    const all = [...(await store.list<Watch>({ prefix: "w:" })).entries()];
    if (all.length > WATCH_MAX) {
      all.sort((a, b) => a[1].since - b[1].since);
      await store.delete(all.slice(0, all.length - WATCH_MAX).map(([k]) => k));
    }
    await this.arm();
    return true;
  }

  /** A socket that just connected: every write's last state. */
  async greet(socket: WatchSocket) {
    for (const w of (await this.state.storage.list<Watch>({ prefix: "w:" })).values())
      if (w.state) this.tell(socket, w);
  }

  private tell(socket: WatchSocket, w: Watch) {
    if (!w.state) return;
    const news: WriteNews = {
      type: "write",
      path: w.path,
      requestId: w.requestId,
      state: slim(w.state),
    };
    try {
      socket.send(JSON.stringify(news));
    } catch {
      // Gone: its close comes.
    }
  }

  /** Read each write that's due; tell the tabs what moved; set the next alarm. */
  async alarm() {
    const now = this.now();
    const store = this.state.storage;
    const all = await store.list<Watch>({ prefix: "w:" });
    for (const [id, w] of all) {
      if (w.done !== null) {
        if (now - w.done > KEEP_DONE_MS) await store.delete(id);
        continue;
      }
      if (now - w.since > GIVE_UP_MS) {
        await store.delete(id);
        continue;
      }
      if (w.next === null || w.next > now) continue;
      const got = await readWrite(this.bindings, w.svc, w.route, w.key);
      const moved = got !== null && JSON.stringify(got) !== JSON.stringify(w.state);
      if (got) w.state = got;
      const finished = got?.state === "sent" || got?.state === "failed";
      const lost = got?.state === "unknown" && now - w.since > UNKNOWN_MS;
      if (finished || lost) {
        w.next = null;
        w.done = now;
      } else {
        w.wait = moved ? FIRST_MS : Math.min(w.wait * 2, MAX_MS);
        w.next = now + w.wait;
      }
      await store.put(id, w);
      if (moved) for (const s of this.state.getWebSockets()) this.tell(s, w);
    }
    await this.arm();
  }

  /** The alarm at the soonest due read, or at the soonest finished write's drop. */
  private async arm() {
    let soonest = Number.POSITIVE_INFINITY;
    for (const w of (await this.state.storage.list<Watch>({ prefix: "w:" })).values())
      soonest = Math.min(
        soonest,
        w.next ?? (w.done !== null ? w.done + KEEP_DONE_MS + 1 : Number.POSITIVE_INFINITY),
      );
    if (Number.isFinite(soonest)) await this.state.storage.setAlarm(soonest);
    else await this.state.storage.deleteAlarm();
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") socket.send("pong");
  }

  webSocketClose(socket: WebSocket, code: number) {
    try {
      socket.close(code === 1005 ? 1000 : code, "bye");
    } catch {
      // Already closed.
    }
  }

  webSocketError(socket: WebSocket) {
    try {
      socket.close(1011, "error");
    } catch {
      // Already closed.
    }
  }
}
