/**
 * The door: Restate's ingress HTTP protocol over the Postgres runtime, so
 * `@restatedev/restate-sdk-clients`, the CLI and the portal call it unchanged.
 *   POST /{svc}[/{key}]/{handler}[/send[?delay=10s]]    header idempotency-key
 *   POST /restate/a/{id}/resolve | /reject   (also /restate/awakeables/...)
 *   GET  /restate/invocation/{id}/attach | /output    (output: 470 while it runs, as Restate)
 *   GET  /restate/invocation/{svc}[/{key}]/{handler}/{idempotency-key}/attach | /output
 *   GET  /restate/health
 * With `restate` set (phase 4): services not in `rt.pg_services`, and ids pg does not hold, pass
 * through to Restate's ingress as they are, so the door can front all ingress.
 */
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
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
  /** Restate's ingress: what pg does not serve goes there. Unset: pg serves every registered service. */
  restate?: string;
  /** Old service name → new: callers that still use the old name reach the new one direct. */
  renamed?: Readonly<Record<string, string>>;
}

/** How long the door trusts its copy of `rt.handlers` and `rt.pg_services`. */
const FRESH_MS = 5_000;

const MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** Restate's `delay`: humantime (`10s`, `1h30m`, `500ms`) or ISO 8601 (`PT10S`). Null: not a duration. */
export function parseDelay(v: string | null): number | null {
  if (!v) return 0;
  if (/^(\d+(ms|s|m|h|d))+$/.test(v))
    return [...v.matchAll(/(\d+)(ms|s|m|h|d)/g)].reduce(
      (t, [, n, u]) => t + Number(n) * MS[u as keyof typeof MS],
      0,
    );
  const iso = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(v);
  if (iso && v.length > 1 && !/T$/i.test(v)) {
    const [, d, h, m, sec] = iso;
    return Math.round(
      Number(d ?? 0) * MS.d +
        Number(h ?? 0) * MS.h +
        Number(m ?? 0) * MS.m +
        Number(sec ?? 0) * 1000,
    );
  }
  return null;
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
  type Kind = { object: boolean; exclusive: Map<string, boolean>; private: Set<string> };
  let kinds = new Map<string, Kind>();
  let onPg = new Set<string>();
  let at = 0;
  const refresh = async () => {
    const next = new Map<string, Kind>();
    for (const h of await handlers(sql)) {
      const s = next.get(h.service) ?? {
        object: h.object,
        exclusive: new Map(),
        private: new Set(),
      };
      s.exclusive.set(h.handler, h.exclusive);
      if (h.private) s.private.add(h.handler);
      next.set(h.service, s);
    }
    const pg = o.restate
      ? new Set(
          (await sql<{ service: string }[]>`SELECT service FROM rt.pg_services`).map(
            (r) => r.service,
          ),
        )
      : null;
    kinds = next;
    if (pg) onPg = pg;
    at = Date.now();
  };
  /** The service's kinds when pg serves it here; undefined: pass through (or unknown). */
  const served = async (service: string, handler: string) => {
    if (Date.now() - at > FRESH_MS) await refresh();
    const hit = () => (!o.restate || onPg.has(service) ? kinds.get(service) : undefined);
    if (hit() && !hit()?.exclusive.has(handler)) await refresh();
    return hit();
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
  const reply = async (res: ServerResponse, id: string, wait = true) => {
    if (!wait) {
      const now = await result(sql, id);
      if (now && now.status !== "done" && now.status !== "killed")
        return send(res, 470, JSON.stringify({ message: "not ready" }));
    }
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

  /** Restate's ingress answers this one, as it came. */
  const pass = (req: IncomingMessage, res: ServerResponse) =>
    new Promise<void>((done) => {
      if (!o.restate) {
        send(res, 404, JSON.stringify({ message: "not found" }));
        return done();
      }
      const headers = { ...req.headers };
      delete headers.host;
      delete headers.connection;
      const up = httpRequest(
        new URL(req.url ?? "/", o.restate),
        { method: req.method ?? "GET", headers },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
          r.on("end", done);
          r.on("error", () => {
            res.destroy();
            done();
          });
        },
      );
      up.on("error", (e) => {
        if (!res.headersSent) send(res, 502, JSON.stringify({ message: `restate: ${e.message}` }));
        else res.destroy();
        done();
      });
      // a caller that leaves stops the wait upstream
      res.on("close", () => {
        if (!res.writableFinished) up.destroy();
      });
      req.pipe(up);
    });

  const held = async (id: string) =>
    (await sql`SELECT 1 FROM rt.invocations WHERE id = ${id}`).length > 0;
  /** `[id]` or `[svc, (key,) handler, idem]`: the pg invocation it names, if pg holds it. */
  const named = async (p: string[]): Promise<string | undefined> => {
    if (p.length === 1) return (await held(p[0] as string)) ? p[0] : undefined;
    if (p.length !== 3 && p.length !== 4) return undefined;
    const [asked, ...rest] = p as [string, ...string[]];
    const service = o.renamed?.[asked] ?? asked;
    const [key, handler, idem] = rest.length === 3 ? rest : [null, ...rest];
    const svc = await served(service, handler as string);
    if (!svc || svc.object !== (key !== null)) return undefined;
    const [row] = await sql<{ id: string }[]>`
      SELECT id FROM rt.invocations WHERE service = ${service} AND handler = ${handler as string}
        AND coalesce(key, '') = ${key ?? ""} AND idem_key = ${idem as string}`;
    return row?.id;
  };

  const route = async (req: IncomingMessage, res: ServerResponse) => {
    if (o.bearer && req.headers.authorization !== `Bearer ${o.bearer}`)
      return send(res, 401, JSON.stringify({ message: "unauthorized" }));
    const url = new URL(req.url ?? "/", "http://door");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    // a pass-through keeps the old name: req.url is not changed
    const alias = parts[0] ? o.renamed?.[parts[0]] : undefined;
    if (alias) parts[0] = alias;

    if (parts[0] === "restate") {
      if (parts[1] === "health" && parts.length === 2) {
        await sql`SELECT 1`;
        return send(res, 200, "{}");
      }
      if (
        (parts[1] === "a" || parts[1] === "awakeables") &&
        parts[2] &&
        req.method === "POST" &&
        (parts[3] === "resolve" || parts[3] === "reject")
      ) {
        const a = parseAwakeableId(parts[2]);
        if (!a) return pass(req, res);
        const b = await body(req);
        await resolveAwakeable(sql, {
          id: parts[2],
          ...a,
          value: parts[3] === "resolve" ? b : null,
          error: parts[3] === "reject" ? { message: b.toString(), code: 500 } : null,
        });
        return send(res, 202, "");
      }
      const op = parts.at(-1);
      if (
        parts[1] === "invocation" &&
        req.method === "GET" &&
        (op === "attach" || op === "output")
      ) {
        // not in pg: Restate's (a call from before the move, or a service still there)
        const id = await named(parts.slice(2, -1));
        return id ? reply(res, id, op === "attach") : pass(req, res);
      }
      return pass(req, res);
    }

    if (parts.length < 2) return pass(req, res);
    const tail = parts.at(-1) === "send" ? parts.slice(0, -1) : parts;
    const handler = tail.at(-1) as string;
    const svc = await served(parts[0] as string, handler);
    if (!svc) return pass(req, res);
    if (req.method !== "POST") return send(res, 405, JSON.stringify({ message: "POST only" }));
    const want = svc.object ? 3 : 2;
    const isSend = parts.length === want + 1 && parts[want] === "send";
    if (parts.length !== (isSend ? want + 1 : want))
      return send(res, 404, JSON.stringify({ message: "bad path" }));
    const [service, key] = svc.object
      ? [parts[0] as string, parts[1] as string]
      : [parts[0] as string, null];
    if (!svc.exclusive.has(handler))
      return send(res, 404, JSON.stringify({ message: `unknown handler ${service}/${handler}` }));
    if (svc.private.has(handler))
      return send(res, 400, JSON.stringify({ message: `${service}/${handler} is private` }));
    const delay = parseDelay(url.searchParams.get("delay"));
    if (delay === null) return send(res, 400, JSON.stringify({ message: "bad delay" }));
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
  // a sync call waits as long as its handler runs; idle links outlive Caddy's keepalive
  server.requestTimeout = 0;
  server.keepAliveTimeout = 150_000;
  server.headersTimeout = 160_000;
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
