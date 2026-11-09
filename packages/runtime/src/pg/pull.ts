/**
 * Pulled services: a worker outside (autobrowse's desk on the Mac) claims their rows over HTTPS
 * and runs each handler whole, with no journal of its own (designs/2026-11-09-own-runtime.md,
 * "Phase 5"). Nothing reaches into it, and calls wait in Postgres while it sleeps.
 *   POST /rt/register {services: [{name, handlers: [{name, private?}]}]}
 *   POST /rt/claim    {services, max?, waitMs?}  → {calls: [{id, attempt, service, handler, input, headers}]}
 *   POST /rt/renew    {id, attempt}               → {cancel}   409: lost the lease
 *   POST /rt/finish   {id, attempt, value? | error + terminal?, retry?}
 * Values and inputs are base64: the bytes as the caller sent them.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type postgres from "postgres";
import type { RetryPolicy } from "./registry.js";
import { claim, finish, isFenced, type Lane, load, renew } from "./store.js";
import type { ErrorJson } from "./turn.js";

export interface PullOptions {
  sql: postgres.Sql;
  /** The services an outside worker may register and claim. Empty: the routes refuse all. */
  pulled: readonly string[];
  leaseMs: number;
  /** Wakes a waiting claim early (NOTIFY rt_wake). */
  onWake: (f: () => void) => () => void;
}

const MAX_WAIT_MS = 25_000;
const MAX_CLAIM = 16;

type Send = (res: ServerResponse, status: number, body: string) => void;
type Json = Record<string, unknown>;

/** A 400; true, as the route answered. */
const bad = (send: Send, res: ServerResponse, message: string) => {
  send(res, 400, JSON.stringify({ message }));
  return true;
};

/** True when `parts` is a pull route; the reply is sent. */
export async function pullRoute(
  o: PullOptions,
  parts: string[],
  req: IncomingMessage,
  res: ServerResponse,
  body: (req: IncomingMessage) => Promise<Buffer>,
  send: Send,
): Promise<boolean> {
  if (parts[0] !== "rt" || parts.length !== 2) return false;
  if (req.method !== "POST") {
    send(res, 405, JSON.stringify({ message: "POST only" }));
    return true;
  }
  let b: Json;
  try {
    b = JSON.parse((await body(req)).toString() || "{}") as Json;
  } catch {
    bad(send, res, "body is not JSON");
    return true;
  }
  const allowed = new Set(o.pulled);
  const op = parts[1];
  if (op === "register") {
    const services = b.services as {
      name: string;
      handlers: { name: string; private?: boolean }[];
    }[];
    if (!Array.isArray(services)) return bad(send, res, "services: array");
    const no = services.map((s) => s.name).filter((n) => !allowed.has(n));
    if (no.length) {
      send(res, 403, JSON.stringify({ message: `not pulled: ${no.join(", ")}` }));
      return true;
    }
    const defs = services.flatMap((s) =>
      s.handlers.map((h) => ({ service: s.name, handler: h.name, private: h.private === true })),
    );
    await o.sql.begin(async (tx) => {
      // a handler the worker no longer has is gone from the door too
      await tx`DELETE FROM rt.handlers WHERE service IN ${tx(services.map((s) => s.name))}`;
      for (const d of defs)
        await tx`INSERT INTO rt.handlers (service, handler, object, exclusive, private)
          VALUES (${d.service}, ${d.handler}, false, false, ${d.private})`;
      // from now on the door queues its calls and the bridge leaves its rows
      for (const s of services)
        await tx`INSERT INTO rt.pg_services (service, build) VALUES (${s.name}, 'pulled')
          ON CONFLICT (service) DO NOTHING`;
    });
    send(res, 200, JSON.stringify({ handlers: defs.length }));
    return true;
  }
  if (op === "claim") {
    const asked = (Array.isArray(b.services) ? (b.services as string[]) : []).filter((s) =>
      allowed.has(s),
    );
    const max = Math.min(Math.max(1, Number(b.max) || 1), MAX_CLAIM);
    const waitMs = Math.min(Math.max(0, Number(b.waitMs) || 0), MAX_WAIT_MS);
    const lane: Lane = { only: asked, lock: false };
    const end = Date.now() + waitMs;
    // req is spent once its body is read; the response closes when the caller leaves
    let gone = false;
    res.on("close", () => {
      gone = true;
    });
    let got = await claim(o.sql, max, o.leaseMs, Date.now(), lane);
    while (!got.length && Date.now() < end && asked.length && !gone) {
      await new Promise<void>((r) => {
        const t = setTimeout(done, Math.min(1_000, end - Date.now()));
        const off = o.onWake(done);
        function done() {
          clearTimeout(t);
          off();
          r();
        }
      });
      got = await claim(o.sql, max, o.leaseMs, Date.now(), lane);
    }
    const calls = [];
    for (const c of got) {
      const l = await load(o.sql, c.id, c.attempt);
      if (!l) continue;
      calls.push({
        id: c.id,
        attempt: c.attempt,
        service: c.service,
        handler: c.handler,
        input: Buffer.from(l.inv.input ?? []).toString("base64"),
        headers: l.inv.headers ?? {},
        cancel: l.inv.cancel === true,
      });
    }
    send(res, 200, JSON.stringify({ calls }));
    return true;
  }
  const id = String(b.id ?? "");
  const attempt = Number(b.attempt);
  if (!id || !Number.isInteger(attempt)) return bad(send, res, "id and attempt");
  if (op === "renew") {
    try {
      await renew(o.sql, id, attempt, o.leaseMs);
    } catch (e) {
      if (!isFenced(e)) throw e;
      send(res, 409, JSON.stringify({ message: "lease lost" }));
      return true;
    }
    const [r] = await o.sql<{ cancel: boolean }[]>`
      SELECT cancel FROM rt.invocations WHERE id = ${id}`;
    send(res, 200, JSON.stringify({ cancel: r?.cancel === true }));
    return true;
  }
  if (op === "finish") {
    const l = await load(o.sql, id, attempt);
    if (!l || !allowed.has(l.inv.service)) {
      send(res, 409, JSON.stringify({ message: "lease lost" }));
      return true;
    }
    const error = b.error as ErrorJson | undefined;
    if (error !== undefined && typeof error?.message !== "string")
      return bad(send, res, "error.message");
    const outcome = error
      ? b.terminal === true
        ? ({ type: "done", error } as const)
        : ({ type: "failed", error } as const)
      : ({
          type: "done",
          value: new Uint8Array(Buffer.from(String(b.value ?? ""), "base64")),
        } as const);
    try {
      await finish(o.sql, l.inv, null, outcome, b.retry as RetryPolicy | undefined, o.leaseMs);
    } catch (e) {
      if (!isFenced(e)) throw e;
      send(res, 409, JSON.stringify({ message: "lease lost" }));
      return true;
    }
    send(res, 200, "{}");
    return true;
  }
  send(res, 404, JSON.stringify({ message: `no route rt/${op}` }));
  return true;
}
