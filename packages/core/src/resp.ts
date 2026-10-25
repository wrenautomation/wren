/**
 * A small Valkey (Redis protocol, RESP2) client: one connection, commands in order, replies
 * matched by position. Enough for a cache (GET, SET PX, DEL); no pub/sub, no cluster.
 *
 * The box's certificate is self-signed, so a `rediss://` URL pins it: `?fp=<sha256>` is the
 * certificate's SHA-256 fingerprint (`openssl x509 -fingerprint -sha256`). The password is
 * written only after the pin matches. Without `fp` the certificate must chain to a known CA.
 */
import net from "node:net";
import tls from "node:tls";

export type Reply = string | number | null | Reply[];

/** An error reply from the server (`-ERR ...`). */
export class RespError extends Error {}

export interface RespClient {
  send(...args: string[]): Promise<Reply>;
  close(): void;
}

interface RespOptions {
  /** Per command, from send to reply; the connection is dropped when one runs over. */
  timeoutMs?: number;
}

/** `redis[s]://[user]:password@host:port[/?fp=<sha256>]` */
export function respClient(url: string, o: RespOptions = {}): RespClient {
  const u = new URL(url);
  if (u.protocol !== "redis:" && u.protocol !== "rediss:")
    throw new Error(`cache url: redis:// or rediss://, got ${u.protocol}`);
  const secure = u.protocol === "rediss:";
  const host = u.hostname;
  const port = Number(u.port || 6379);
  const user = decodeURIComponent(u.username || "default");
  const password = u.password ? decodeURIComponent(u.password) : null;
  const pin =
    u.searchParams
      .get("fp")
      ?.toUpperCase()
      .replace(/[^0-9A-F]/g, "") ?? null;
  const timeoutMs = o.timeoutMs ?? 500;

  let sock: net.Socket | null = null;
  let buf: Buffer = Buffer.alloc(0);
  const waiting: {
    resolve: (r: Reply) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }[] = [];

  const drop = (err: Error) => {
    sock?.destroy();
    sock = null;
    buf = Buffer.alloc(0);
    for (const w of waiting.splice(0)) {
      clearTimeout(w.timer);
      w.reject(err);
    }
  };

  const onData = (chunk: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      let r: ReturnType<typeof parse>;
      try {
        r = parse(buf, 0);
      } catch (e) {
        return drop(e as Error);
      }
      if (!r) return;
      buf = buf.subarray(r.next);
      const w = waiting.shift();
      if (!w) return drop(new Error("cache: a reply nobody asked for"));
      clearTimeout(w.timer);
      if (waiting.length === 0) sock?.unref();
      if (r.value instanceof RespError) w.reject(r.value);
      else w.resolve(r.value);
    }
  };

  const connect = (): net.Socket => {
    const s = secure
      ? tls.connect({
          host,
          port,
          // SNI takes a name, never an IP: the box is reached by its IP.
          ...(net.isIP(host) ? {} : { servername: host }),
          rejectUnauthorized: pin === null,
        })
      : net.connect({ host, port });
    // Nothing is written until the pin matches: the password never reaches another server.
    const hello = () => {
      if (pin && s instanceof tls.TLSSocket) {
        const fp = s.getPeerCertificate().fingerprint256?.replace(/:/g, "") ?? "";
        if (fp !== pin) return drop(new Error("cache: certificate does not match its pin"));
      }
      s.uncork();
    };
    s.cork();
    s.once(secure ? "secureConnect" : "connect", hello);
    // A dropped socket's late events must not touch the one that replaced it.
    s.on("data", (chunk: Buffer) => sock === s && onData(chunk));
    s.on("error", (e) => sock === s && drop(e));
    s.on("close", () => sock === s && drop(new Error("cache: connection closed")));
    return s;
  };

  const write = (args: string[]): Promise<Reply> =>
    new Promise((resolve, reject) => {
      if (!sock) sock = connect();
      const s = sock;
      const timer = setTimeout(
        () => drop(new Error(`cache: no reply in ${timeoutMs} ms`)),
        timeoutMs,
      );
      timer.unref();
      waiting.push({ resolve, reject, timer });
      // Held while a reply is owed; idle, it never keeps the process up (the CLI exits).
      s.ref();
      s.write(encode(args));
    });

  return {
    send(...args) {
      if (sock || password === null) return write(args);
      // AUTH first on a new connection. Its failure is the one to report, and drops the
      // connection so the next command tries again.
      const auth = write(["AUTH", user, password]);
      const cmd = write(args);
      return Promise.allSettled([auth, cmd]).then(([a, c]) => {
        if (a.status === "rejected") {
          drop(a.reason as Error);
          throw a.reason;
        }
        if (c.status === "rejected") throw c.reason;
        return c.value;
      });
    },
    close() {
      drop(new Error("cache: closed"));
    },
  };
}

export function encode(args: string[]): Buffer {
  const parts = [`*${args.length}\r\n`];
  for (const a of args) parts.push(`$${Buffer.byteLength(a)}\r\n${a}\r\n`);
  return Buffer.from(parts.join(""));
}

/** One reply from `at`, or undefined when the buffer holds only part of it. */
export function parse(
  b: Buffer,
  at: number,
): { value: Reply | RespError; next: number } | undefined {
  const eol = b.indexOf("\r\n", at);
  if (eol < 0) return undefined;
  const line = b.toString("utf8", at + 1, eol);
  const next = eol + 2;
  switch (b[at]) {
    case 0x2b: // +
      return { value: line, next };
    case 0x2d: // -
      return { value: new RespError(line), next };
    case 0x3a: // :
      return { value: Number(line), next };
    case 0x24: {
      // $
      const n = Number(line);
      if (n < 0) return { value: null, next };
      if (b.length < next + n + 2) return undefined;
      return { value: b.toString("utf8", next, next + n), next: next + n + 2 };
    }
    case 0x2a: {
      // *
      const n = Number(line);
      if (n < 0) return { value: null, next };
      const out: Reply[] = [];
      let failed: RespError | null = null;
      let i = next;
      for (let k = 0; k < n; k++) {
        const r = parse(b, i);
        if (!r) return undefined;
        if (r.value instanceof RespError) failed ??= r.value;
        else out.push(r.value);
        i = r.next;
      }
      return { value: failed ?? out, next: i };
    }
    default:
      throw new Error(`cache: unknown reply type ${String.fromCharCode(b[at] ?? 0)}`);
  }
}
