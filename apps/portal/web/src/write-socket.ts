/**
 * Sends told live (designs/2026-10-15-one-write-path.md): one socket per tab to this person's
 * `WriteWatch` (`/api/live/writes`). Each state the server reads of a send, the retry reason
 * too, goes to `WRITES.heard`. While it's open, `WRITES` asks `/api/writes/status` only now and
 * then; closed, it asks as before. A host without the watch (the local preview) never opens it,
 * and the tab just asks. The loop is shared (./live-socket.ts).
 */
import type { WireState, Writes } from "@wren/ui";
import { LiveSocket, type LiveSocketEnv, startLive } from "./live-socket.js";

export { PING_MS, PONG_MS, type SocketLike } from "./live-socket.js";

export const WRITES_LIVE_PATH = "/api/live/writes";
export const WRITES_PROTOCOL = "wren-writes";

type WriteSocketEnv = Omit<LiveSocketEnv, "protocol" | "frame" | "up"> & {
  writes: Pick<Writes, "heard" | "pushed">;
};

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

const handlers = (writes: WriteSocketEnv["writes"]) => ({
  protocol: WRITES_PROTOCOL,
  frame: (raw: unknown) => {
    const news = newsOf(raw);
    if (news) writes.heard(news.requestId, news.state);
  },
  up: (open: boolean) => writes.pushed(open),
});

export class WriteSocket extends LiveSocket {
  constructor({ writes, ...rest }: WriteSocketEnv) {
    super({ ...rest, ...handlers(writes) });
  }
}

/** The tab's write socket, started once the write path is. */
export const startWriteSocket = ({
  writes,
  ...rest
}: Omit<WriteSocketEnv, "open" | "url">): LiveSocket | null =>
  startLive({ ...rest, ...handlers(writes) }, WRITES_LIVE_PATH);
