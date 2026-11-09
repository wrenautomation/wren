/**
 * One tab socket to a Durable Object behind the portal Worker, with the shared loop: the token in
 * `Sec-WebSocket-Protocol`, backoff, a ping every 30 s, a dead one noticed, a nudge on focus and
 * online. Writes (./write-socket.ts) and topics (./topic-socket.ts) ride on it.
 */
import { focusManager, onlineManager } from "@wren/ui";

/** A ping this often; no pong within `PONG_MS` and the socket is taken for dead. */
export const PING_MS = 30_000;
export const PONG_MS = 10_000;
/** Back off from 1 s to a minute; a host that never opened one is tried every five. */
const RETRY_MAX_MS = 60_000;
const NEVER_OPENED_MS = 5 * 60_000;

export interface SocketLike {
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: unknown) => void) | null;
  onerror?: ((e: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface Timer {
  set: (fn: () => void, ms: number) => unknown;
  clear: (t: unknown) => void;
}

export interface LiveSocketEnv {
  /** The sign-in token; null where there's none (no socket then). */
  token: () => Promise<string | null>;
  open: (url: string, protocols: string[]) => SocketLike;
  url: string;
  protocol: string;
  /** Each frame but the pong. */
  frame: (raw: unknown) => void;
  /** Open, or closed. */
  up: (open: boolean) => void;
  timer?: Timer;
}

export class LiveSocket {
  private socket: SocketLike | null = null;
  private tries = 0;
  private opened = false;
  private stopped = false;
  private wait: unknown = null;
  private ping: unknown = null;
  private pong: unknown = null;
  private readonly timer: Timer;

  constructor(private readonly cfg: LiveSocketEnv) {
    this.timer = cfg.timer ?? {
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
    this.cfg.up(false);
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
      token = await this.cfg.token();
    } catch {
      return this.later();
    }
    if (this.stopped || this.socket) return;
    if (!token) return;
    let ws: SocketLike;
    try {
      ws = this.cfg.open(this.cfg.url, [this.cfg.protocol, token]);
    } catch {
      return this.later();
    }
    this.socket = ws;
    ws.onopen = () => {
      if (this.socket !== ws) return;
      this.tries = 0;
      this.opened = true;
      this.cfg.up(true);
      this.beat(ws);
    };
    ws.onmessage = (e) => {
      if (this.socket !== ws) return;
      if (e.data === "pong") {
        if (this.pong !== null) this.timer.clear(this.pong);
        this.pong = null;
        return;
      }
      this.cfg.frame(e.data);
    };
    ws.onclose = () => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.clearTimers();
      this.cfg.up(false);
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
        // no answer: gone though it never said so
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

/** A tab's socket at `path`: started now, nudged back in the tab or online. Null without WebSocket. */
export function startLive(
  cfg: Omit<LiveSocketEnv, "open" | "url">,
  path: string,
): LiveSocket | null {
  if (typeof WebSocket === "undefined" || typeof location === "undefined") return null;
  const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`;
  const s = new LiveSocket({
    ...cfg,
    url,
    open: (u, p) => new WebSocket(u, p) as unknown as SocketLike,
  });
  s.start();
  focusManager.subscribe((focused) => focused && s.nudge());
  onlineManager.subscribe((online) => online && s.nudge());
  return s;
}
