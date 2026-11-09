/**
 * The door: Restate's ingress HTTP protocol over the Postgres runtime, so
 * `@restatedev/restate-sdk-clients`, the CLI and the portal call it unchanged.
 *   POST /{svc}[/{key}]/{handler}[/send[?delay=Nms]]    header idempotency-key
 *   POST /restate/a/{id}/resolve | /reject
 *   GET  /restate/invocation/{id}/attach | /output
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type postgres from "postgres";
import { newInvocationId, parseAwakeableId } from "./ids.js";
import { handlers, resolveAwakeable, result, submit } from "./store.js";

export interface DoorOptions {
  sql: postgres.Sql;
  port?: number;
  host?: string;
  /** Checked when set; in prod Caddy checks it in front. */
  bearer?: string;
}

const DROP = new Set([
  "host",
  "connection",
  "content-length",
  "authorization",
  "cookie",
  "transfer-encoding",
]);

const body = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => parts.push(c));
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });

const send = (
  res: ServerResponse,
  status: number,
  data: string | Uint8Array,
  type = "application/json",
) => {
  res.writeHead(status, { "content-type": type });
  res.end(data);
};

export async function serveDoor(o: DoorOptions): Promise<{ url: string; close(): Promise<void> }> {
  const sql = o.sql;
  let kinds = new Map<string, { object: boolean; exclusive: Map<string, boolean> }>();
  const refresh = async () => {
    const next = new Map<string, { object: boolean; exclusive: Map<string, boolean> }>();
    for (const h of await handlers(sql)) {
      const s = next.get(h.service) ?? { object: h.object, exclusive: new Map() };
      s.exclusive.set(h.handler, h.exclusive);
      next.set(h.service, s);
    }
    kinds = next;
  };
  const known = async (service: string, handler?: string) => {
    const hit = () =>
      kinds.get(service) && (!handler || kinds.get(service)?.exclusive.has(handler));
    if (!hit()) await refresh();
    return hit() ? kinds.get(service) : undefined;
  };

  // one LISTEN for every waiting call
  const waiters = new Map<string, Set<() => void>>();
  const listener = await sql.listen("rt_done", (id) => {
    for (const w of waiters.get(id) ?? []) w();
  });
  const settled = async (id: string) => {
    for (;;) {
      let wake = () => {};
      const ping = new Promise<void>((r) => {
        wake = r;
      });
      const set = waiters.get(id) ?? new Set();
      set.add(wake);
      waiters.set(id, set);
      try {
        const r = await result(sql, id);
        if (!r) return undefined;
        if (r.status === "done" || r.status === "killed") return r;
        await Promise.race([ping, new Promise((t) => setTimeout(t, 2000))]);
      } finally {
        set.delete(wake);
        if (set.size === 0) waiters.delete(id);
      }
    }
  };
  const reply = async (res: ServerResponse, id: string) => {
    const r = await settled(id);
    if (!r) return send(res, 404, JSON.stringify({ message: `no invocation ${id}` }));
    if (r.error) {
      const code = r.error.code && r.error.code >= 400 && r.error.code < 600 ? r.error.code : 500;
      return send(
        res,
        code,
        JSON.stringify({ code: r.error.code ?? 500, message: r.error.message }),
      );
    }
    send(res, 200, r.result ?? new Uint8Array());
  };

  const route = async (req: IncomingMessage, res: ServerResponse) => {
    if (o.bearer && req.headers.authorization !== `Bearer ${o.bearer}`)
      return send(res, 401, JSON.stringify({ message: "unauthorized" }));
    const url = new URL(req.url ?? "/", "http://door");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

    if (parts[0] === "restate") {
      if (
        parts[1] === "a" &&
        parts[2] &&
        req.method === "POST" &&
        (parts[3] === "resolve" || parts[3] === "reject")
      ) {
        const a = parseAwakeableId(parts[2]);
        if (!a) return send(res, 404, JSON.stringify({ message: "unknown awakeable" }));
        const b = await body(req);
        await resolveAwakeable(sql, {
          id: parts[2],
          ...a,
          value: parts[3] === "resolve" ? b : null,
          error: parts[3] === "reject" ? { message: b.toString(), code: 500 } : null,
        });
        return send(res, 202, "");
      }
      if (parts[1] === "invocation" && parts[2] && (parts[3] === "attach" || parts[3] === "output"))
        return reply(res, parts[2]);
      return send(res, 404, JSON.stringify({ message: "not found" }));
    }

    if (req.method !== "POST") return send(res, 405, JSON.stringify({ message: "POST only" }));
    let isSend = false;
    let p = parts;
    const svc = p[0] ? await known(p[0]) : undefined;
    if (!svc) return send(res, 404, JSON.stringify({ message: `unknown service ${p[0]}` }));
    const want = svc.object ? 3 : 2;
    if (p.length === want + 1 && p[want] === "send") {
      isSend = true;
      p = p.slice(0, want);
    }
    if (p.length !== want) return send(res, 404, JSON.stringify({ message: "bad path" }));
    const [service, key, handler] = svc.object
      ? [p[0] as string, p[1] as string, p[2] as string]
      : [p[0] as string, null, p[1] as string];
    if (!svc.exclusive.has(handler))
      return send(res, 404, JSON.stringify({ message: `unknown handler ${service}/${handler}` }));
    const delay = Number(/^(\d+)ms$/.exec(url.searchParams.get("delay") ?? "")?.[1] ?? 0);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers))
      if (!DROP.has(k) && typeof v === "string" && !k.startsWith("x-restateclient")) headers[k] = v;
    const idem = (req.headers["idempotency-key"] as string | undefined) ?? null;
    const { id, fresh } = await submit(sql, {
      id: newInvocationId(),
      service,
      handler,
      key,
      input: await body(req),
      headers,
      idemKey: idem,
      runAt: new Date(Date.now() + delay),
    });
    if (isSend)
      return send(
        res,
        202,
        JSON.stringify({ invocationId: id, status: fresh ? "Accepted" : "PreviouslyAccepted" }),
      );
    return reply(res, id);
  };

  const server = createServer((req, res) => {
    route(req, res).catch((e: unknown) => {
      if (!res.headersSent)
        send(res, 500, JSON.stringify({ message: String((e as Error)?.message ?? e) }));
      else res.end();
    });
  });
  await new Promise<void>((r) => server.listen(o.port ?? 0, o.host ?? "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${o.host ?? "127.0.0.1"}:${port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await listener.unlisten();
    },
  };
}
