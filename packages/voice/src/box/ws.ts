/**
 * The smallest WebSocket server the media stream needs (RFC 6455): the upgrade handshake, text
 * frames both ways, fragments, ping and close. No dependency, so the box bundle stays one file.
 * Binary frames are read as text: Telnyx sends JSON. A frame over 1 MB closes the socket.
 */
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { MediaSocket } from "../transports/telnyx.js";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX = 1 << 20;

export const acceptKey = (key: string) =>
  createHash("sha1")
    .update(key + GUID)
    .digest("base64");

/** One encoded frame, unmasked (server to client). */
export function frameOf(opcode: number, payload: Buffer): Buffer {
  const n = payload.length;
  const head =
    n < 126
      ? Buffer.from([0x80 | opcode, n])
      : n < 65536
        ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 0xff])
        : (() => {
            const b = Buffer.alloc(10);
            b[0] = 0x80 | opcode;
            b[1] = 127;
            b.writeBigUInt64BE(BigInt(n), 2);
            return b;
          })();
  return Buffer.concat([head, payload]);
}

/** Answer an upgrade: the handshake written, a socket back, or null when it isn't a WebSocket. */
export function accept(req: IncomingMessage, sock: Duplex): MediaSocket | null {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || req.headers.upgrade?.toLowerCase() !== "websocket") return null;
  sock.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      "",
      "",
    ].join("\r\n"),
  );
  return new Socket(sock);
}

class Socket implements MediaSocket {
  private buf = Buffer.alloc(0);
  private parts: Buffer[] = [];
  private onText: (t: string) => void = () => {};
  private onEnd: () => void = () => {};
  private closed = false;

  constructor(private readonly sock: Duplex) {
    sock.on("data", (d: Buffer) => this.read(d));
    sock.on("close", () => this.gone());
    sock.on("error", () => this.gone());
  }

  onMessage(fn: (text: string) => void) {
    this.onText = fn;
  }

  onClose(fn: () => void) {
    this.onEnd = fn;
  }

  send(text: string) {
    if (!this.closed) this.sock.write(frameOf(0x1, Buffer.from(text)));
  }

  close() {
    if (this.closed) return;
    this.sock.write(frameOf(0x8, Buffer.from([0x03, 0xe8])));
    this.sock.end();
    this.gone();
  }

  private gone() {
    if (this.closed) return;
    this.closed = true;
    this.onEnd();
  }

  private read(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0] as number;
      const b1 = this.buf[1] as number;
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let at = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX)) return this.close();
        len = Number(big);
        at = 10;
      }
      if (len > MAX) return this.close();
      const maskAt = at;
      if (masked) at += 4;
      if (this.buf.length < at + len) return;
      const payload = Buffer.from(this.buf.subarray(at, at + len));
      if (masked)
        for (let i = 0; i < len; i++)
          payload[i] = (payload[i] as number) ^ (this.buf[maskAt + (i % 4)] as number);
      this.buf = this.buf.subarray(at + len);
      if (op === 0x8) return this.close();
      if (op === 0x9) {
        this.sock.write(frameOf(0xa, payload));
        continue;
      }
      if (op === 0xa) continue;
      if (op === 0x0 || op === 0x1 || op === 0x2) {
        this.parts.push(payload);
        if (this.parts.reduce((n, p) => n + p.length, 0) > MAX) return this.close();
        if (fin) {
          const text = Buffer.concat(this.parts).toString("utf8");
          this.parts = [];
          this.onText(text);
        }
      }
    }
  }
}
