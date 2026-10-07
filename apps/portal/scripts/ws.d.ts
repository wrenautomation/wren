/** The few parts of `ws` the preview uses (no @types/ws in the repo). */
declare module "ws" {
  import type { IncomingMessage } from "node:http";
  import type { Duplex } from "node:stream";

  export class WebSocket {
    send(data: string): void;
    close(code?: number, reason?: string): void;
    on(event: "message", fn: (data: unknown) => void): this;
    on(event: "close", fn: () => void): this;
  }
  export class WebSocketServer {
    constructor(options: { noServer: true });
    handleUpgrade(
      req: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      done: (ws: WebSocket) => void,
    ): void;
  }
}
