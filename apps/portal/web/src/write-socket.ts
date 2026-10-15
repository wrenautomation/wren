/**
 * Sends told live (designs/2026-10-15-one-write-path.md): one socket per tab to this person's
 * `WriteWatch` (`/api/live/writes`). Each state the server reads of a send, the retry reason
 * too, goes to `WRITES.heard`. While it's open, `WRITES` asks `/api/writes/status` only now and
 * then; closed, it asks as before. A host without the watch (the local preview) never opens it,
 * and the tab just asks.
 */
import { focusManager, onlineManager, type WireState, type Writes } from "@wren/ui";

export const WRITES_LIVE_PATH = "/api/live/writes";
export const WRITES_PROTOCOL = "wren-writes";
/** A ping this often; no pong within `PONG_MS` and the socket is taken for dead. */
export const PING_MS = 30_000;
export const PONG_MS = 10_000;
/** Back off from 1 s to a minute; a host that never opened one is tried every five. */
export const RETRY_MAX_MS = 60_000;
export const NEVER_OPENED_MS = 5 * 60_000;

export interface SocketLike {
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: unknown) => void) | null;
  onerror?: ((e: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface WriteSocketEnv {
  /** The sign-in token; null where there's none (no socket then). */
  token: () => Promise<string | null>;
  open: (url: string, protocols: string[]) => SocketLike;
  url: string;
  writes: Pick<Writes, "heard" | "pushed">;
  timer?: {
    set: (fn: () => void, ms: number) => unknown;
    clear: (t: unknown) => void;
  };
}

/** One message from the watch, or null when it isn't one. */
export function newsOf(raw: unknown): { requestId: string; state: WireState } | null {
  if (typeof raw !== "string" || raw === "pong") return null;
  try {
    const m = JSON.parse(raw) as {
      type?: unknown;
      requestId?: unknown;
      state?: { state?: unknown } | null;
    };
    if (m?.type !== "write" || typeof m.requestId !== "string" || !m.state) return null;
    const s = m.state.state;
    if (s !== "sending" && s !== "sent" && s !== "failed" && s !== "unknown") return null;
    return { requestId: m.requestId, state: m.state as WireState };
  } catch {
    return null;
  }
}

export class WriteSocket {
  private socket: SocketLike | null = null;
  private tries = 0;
  private opened = false;
  private stopped = false;
  private wait: unknown = null;
  private ping: unknown = null;
  private pong: unknown = null;
  private readonly timer: NonNullable<WriteSocketEnv["timer"]>;

  constructor(private readonly env: WriteSocketEnv) {
    this.timer = env.timer ?? {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    };
  }

  start() {
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    const s = this.socket;
    this.socket = null;
    s?.close();
    this.env.writes.pushed(false);
  }

  /** Back in the tab, or online again: try now rather than at the next backoff. */
  nudge() {
    if (this.stopped || this.socket) return;
    if (this.wait !== null) this.timer.clear(this.wait);
    this.wait = null;
    void this.connect();
  }

  private async connect() {
    if (this.stopped || this.socket) return;
    let token: string | null = null;
    try {
      token = await this.env.token();
    } catch {
      return this.later();
    }
    if (this.stopped || this.socket) return;
    if (!token) return;
    let ws: SocketLike;
    try {
      ws = this.env.open(this.env.url, [WRITES_PROTOCOL, token]);
    } catch {
      return this.later();
    }
    this.socket = ws;
    ws.onopen = () => {
      if (this.socket !== ws) return;
      this.tries = 0;
      this.opened = true;
      this.env.writes.pushed(true);
      this.beat(ws);
    };
    ws.onmessage = (e) => {
      if (this.socket !== ws) return;
      if (e.data === "pong") {
        if (this.pong !== null) this.timer.clear(this.pong);
        this.pong = null;
        return;
      }
      const news = newsOf(e.data);
      if (news) this.env.writes.heard(news.requestId, news.state);
    };
    ws.onclose = () => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.clearTimers();
      this.env.writes.pushed(false);
      this.later();
    };
  }

  private beat(ws: SocketLike) {
    this.ping = this.timer.set(() => {
      if (this.socket !== ws) return;
      try {
        ws.send("ping");
      } catch {
        return ws.onclose?.(null);
      }
      this.pong = this.timer.set(() => {
        // No answer: the socket is gone though it never said so.
        if (this.socket === ws) {
          ws.onclose?.(null);
          ws.close();
        }
      }, PONG_MS);
      this.beat(ws);
    }, PING_MS);
  }

  private later() {
    if (this.stopped) return;
    const ms = this.opened
      ? Math.min(RETRY_MAX_MS, 1000 * 2 ** this.tries++)
      : this.tries++ < 3
        ? 1000 * 2 ** this.tries
        : NEVER_OPENED_MS;
    this.wait = this.timer.set(() => {
      this.wait = null;
      void this.connect();
    }, ms);
  }

  private clearTimers() {
    for (const t of [this.wait, this.ping, this.pong]) if (t !== null) this.timer.clear(t);
    this.wait = this.ping = this.pong = null;
  }
}

/** The tab's socket, started once the write path is: back in the tab or online, it tries again. */
export function startWriteSocket(env: Omit<WriteSocketEnv, "open" | "url">): WriteSocket | null {
  if (typeof WebSocket === "undefined" || typeof location === "undefined") return null;
  const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${WRITES_LIVE_PATH}`;
  const s = new WriteSocket({
    ...env,
    url,
    open: (u, p) => new WebSocket(u, p) as unknown as SocketLike,
  });
  s.start();
  focusManager.subscribe((focused) => focused && s.nudge());
  onlineManager.subscribe((online) => online && s.nudge());
  return s;
}
