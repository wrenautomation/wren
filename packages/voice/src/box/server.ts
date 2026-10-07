/**
 * The call loop's home on the box: a long-lived process holding each call's media socket, so
 * every stage streams in one place, beside Restate and Postgres. Lambda can't hold a socket.
 *
 * `GET /health` says whether it's set up. `/media?token=…` upgrades to Telnyx's media stream
 * and runs one call on it; the token is ours, put in the stream URL when we answer or dial.
 * Until setup gives it ears and a mouth, it refuses every call with 503: nothing answers.
 */
import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AgentSettings } from "../agent.js";
import { type CallResult, type Pipeline, runCall } from "../call.js";
import type { ToolPorts } from "../tools.js";
import { type TelnyxControl, TelnyxTransport } from "../transports/telnyx.js";
import type { Transport } from "../types.js";
import { accept } from "./ws.js";

export interface VoiceServerOptions {
  port: number;
  host?: string;
  /** The stream URL's shared token; with none, every call is refused. */
  token: string | null;
  control: TelnyxControl;
  /** Ears, brain and mouth for a call on `transport`; null until setup picks the vendors. */
  pipeline: (transport: Transport) => Pipeline | null;
  agent: () => Promise<AgentSettings>;
  ports: ToolPorts;
  save: (result: CallResult) => Promise<void>;
  log?: (line: string) => void;
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function startVoiceServer(o: VoiceServerOptions): Promise<Server> {
  const log = o.log ?? (() => {});
  let live = 0;
  const ready = () => o.token !== null && o.pipeline(new NoTransport()) !== null;
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(ready() ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ready: ready(), calls: live }));
      return;
    }
    res.writeHead(404).end();
  });
  server.on("upgrade", (req, sock) => {
    const url = new URL(req.url ?? "/", "http://box");
    const token = url.searchParams.get("token") ?? "";
    if (url.pathname !== "/media" || !o.token || !same(token, o.token)) {
      sock.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const socket = accept(req, sock);
    if (!socket) {
      sock.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    const transport = new TelnyxTransport(socket, o.control);
    const pipeline = o.pipeline(transport);
    if (!pipeline) {
      socket.close();
      return;
    }
    live++;
    void (async () => {
      try {
        const result = await runCall({ pipeline, agent: await o.agent(), ports: o.ports });
        await o.save(result);
        log(`voice: call ${result.call.id} ${result.outcome}, ${result.turns.length} turns`);
      } catch (err) {
        log(`voice: call failed: ${(err as Error).message}`);
        socket.close();
      } finally {
        live--;
      }
    })();
  });
  return new Promise((ok) => server.listen(o.port, o.host ?? "127.0.0.1", () => ok(server)));
}

/** Asked only whether a pipeline exists. */
class NoTransport implements Transport {
  readonly name = "none";
  readonly carries = "audio" as const;
  readonly endpointing = "ours" as const;
  async open() {}
  send() {}
  clear() {}
  async transfer() {}
  async hangup() {}
}
