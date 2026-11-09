/**
 * Two runtimes side by side (designs/2026-11-09-own-runtime.md, "Phase 3").
 *   Restate → pg: `proxy(def)` is served on Restate in place of a pg service; it writes the pg row
 *     and waits on a Restate awakeable, which `replier` resolves when the row finishes.
 *   pg → Restate: a row whose service is not on pg runs as `bridgeTurn`: send to Restate's ingress
 *     with idempotency-key = row id, then attach. The wait is on the box.
 */
import { createHash } from "node:crypto";
import * as sdk from "@restatedev/restate-sdk";
import type postgres from "postgres";
import { KIND, wrapperOf } from "./registry.js";
import { type Claim, finish, isFenced, load, renew, seedState, submit } from "./store.js";
import type { ErrorJson } from "./turn.js";

const B32 = "0123456789abcdefghjkmnpqrstvwxyz";
/** The pg row a Restate proxy call makes: a function of the Restate invocation, so a retry finds it. */
export const proxyRowId = (restateId: string) => {
  const h = createHash("sha256").update(`restate/${restateId}`).digest();
  let out = "inv_";
  for (let i = 0; i < 26; i++) out += B32[(h[i] as number) & 31];
  return out;
};

/** What a replier sends and a proxy reads: the row's bytes or its error, with the code kept. */
type Reply = { ok: true; value: string } | { ok: false; error: ErrorJson };

type Def = { name: string; service?: object; object?: object };
/** Headers worth carrying into the pg row (tracing and callers' own); never auth. */
const KEEP = (k: string) =>
  !/^(authorization|cookie|host|content-length|connection|x-restate)/i.test(k);

/** A Restate definition with `def`'s name and handlers that forward each call to the pg runtime. */
/** `as`: the Restate name, when the service was renamed; its state and callers move to `def.name`. */
export function proxy(
  def: Def,
  sql: () => postgres.Sql,
  as: string = def.name,
): sdk.ServiceDefinition<string, unknown> {
  const routes = (def.service ?? def.object ?? {}) as Record<string, unknown>;
  const isObject = def.object !== undefined;
  const forward = async (
    ctx: sdk.Context & { key?: string },
    input: Uint8Array,
    moveState?: sdk.ObjectContext,
  ) => {
    const req = ctx.request();
    const id = proxyRowId(req.id);
    const { id: reply, promise } = ctx.awakeable<Uint8Array>(sdk.serde.binary);
    const headers: Record<string, string> = {};
    for (const [k, v] of req.headers) if (KEEP(k)) headers[k] = v;
    // exclusive: this key's Restate state moves to pg, ordered by Restate's own key lock
    const state: { name: string; value: Uint8Array }[] = [];
    if (moveState)
      for (const name of await moveState.stateKeys())
        state.push({ name, value: (await moveState.get(name, sdk.serde.binary)) as Uint8Array });
    await ctx.run("rt submit", async () => {
      if (state.length) await seedState(sql(), def.name, ctx.key as string, state);
      await submit(sql(), {
        id,
        service: def.name,
        handler: req.target.handler,
        key: isObject ? (ctx.key ?? null) : null,
        input,
        headers,
        idemKey: null,
        runAt: new Date(),
        reply,
      });
    });
    moveState?.clearAll();
    let bytes: Uint8Array;
    try {
      bytes = await promise;
    } catch (e) {
      if (e instanceof sdk.CancelledError)
        await ctx.run("rt cancel", async () => {
          await sql()`SELECT rt.cancel(${id}, now())`;
        });
      throw e;
    }
    const r = JSON.parse(Buffer.from(bytes).toString()) as Reply;
    if (r.ok) return Buffer.from(r.value, "base64");
    throw new sdk.TerminalError(r.error.message, { errorCode: r.error.code ?? 500 });
  };
  // bytes pass through as they are; the content type is JSON, which every caller sends
  const raw: sdk.Serde<Uint8Array> = {
    contentType: "application/json",
    serialize: (b) => b,
    deserialize: (b) => b,
  };
  const handlers: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(routes)) {
    const w = wrapperOf(fn);
    const opts = {
      input: raw,
      output: raw,
      ...(w?.options?.ingressPrivate ? { ingressPrivate: true } : {}),
    };
    handlers[name] = !isObject
      ? sdk.handlers.handler(opts, (ctx: sdk.Context, input: Uint8Array) => forward(ctx, input))
      : w?.kind === KIND.EXCLUSIVE
        ? sdk.handlers.object.exclusive(opts, (ctx: sdk.ObjectContext, input: Uint8Array) =>
            forward(ctx as unknown as sdk.Context & { key: string }, input, ctx),
          )
        : sdk.handlers.object.shared(opts, (ctx: sdk.ObjectSharedContext, input: Uint8Array) =>
            forward(ctx as unknown as sdk.Context & { key: string }, input),
          );
  }
  return (
    isObject
      ? sdk.object({ name: as, handlers: handlers as never })
      : sdk.service({ name: as, handlers: handlers as never })
  ) as sdk.ServiceDefinition<string, unknown>;
}

/**
 * Flip back: object state pg holds for `service` returns to Restate (admin API), key by key, and
 * leaves pg. Run before Restate serves the service again.
 */
export async function returnState(sql: postgres.Sql, admin: string, service: string) {
  const rows = await sql<{ key: string; name: string; value: Buffer }[]>`
    SELECT key, name, value FROM rt.state WHERE service = ${service} ORDER BY key, name`;
  const byKey = new Map<string, Record<string, number[]>>();
  for (const r of rows) {
    const s = byKey.get(r.key) ?? {};
    s[r.name] = [...r.value];
    byKey.set(r.key, s);
  }
  for (const [key, state] of byKey) {
    const res = await fetch(`${admin}/services/${encodeURIComponent(service)}/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ object_key: key, new_state: state }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok)
      throw new Error(`restate state ${service}/${key}: HTTP ${res.status} ${await res.text()}`);
    await sql`DELETE FROM rt.state WHERE service = ${service} AND key = ${key}`;
  }
  return byKey.size;
}

export interface Ingress {
  url: string;
  headers?: Record<string, string>;
}

const ATTACH_MS = 240_000; // under undici's 300 s headers timeout; re-attach after

/** Run one bridge row on Restate: send (idempotent on the row id), then attach until it ends. */
export async function bridgeTurn(
  o: { sql: postgres.Sql; ingress: Ingress; leaseMs: number },
  c: Pick<Claim, "id" | "attempt">,
): Promise<string> {
  const loaded = await load(o.sql, c.id, c.attempt);
  if (!loaded) return "gone";
  const inv = loaded.inv;
  const [row] = await o.sql<{ key: string | null; input: Buffer; remote: string | null }[]>`
    SELECT key, input, remote FROM rt.invocations WHERE id = ${inv.id}`;
  if (!row) return "gone";
  let fenced = false;
  const beat = setInterval(() => {
    renew(o.sql, inv.id, inv.attempt, o.leaseMs).catch((e: unknown) => {
      if (isFenced(e)) fenced = true;
    });
  }, o.leaseMs / 3);
  beat.unref();
  const h = { ...o.ingress.headers };
  try {
    let remote = row.remote;
    if (!remote) {
      const path = [inv.service, ...(row.key !== null ? [row.key] : []), inv.handler, "send"]
        .map(encodeURIComponent)
        .join("/");
      const res = await fetch(`${o.ingress.url}/${path}`, {
        method: "POST",
        // no input: no content type, or Restate refuses the empty body
        headers: {
          ...h,
          ...(row.input.length ? { "content-type": "application/json" } : {}),
          "idempotency-key": inv.id,
        },
        body: new Uint8Array(row.input),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok)
        throw new Error(`restate send ${res.status}: ${(await res.text()).slice(0, 300)}`);
      remote = ((await res.json()) as { invocationId: string }).invocationId;
      await o.sql`UPDATE rt.invocations SET remote = ${remote} WHERE id = ${inv.id}`;
    }
    for (;;) {
      if (fenced) return "fenced";
      let res: Response;
      try {
        res = await fetch(`${o.ingress.url}/restate/invocation/${remote}/attach`, {
          headers: h,
          signal: AbortSignal.timeout(ATTACH_MS),
        });
      } catch (e) {
        if ((e as Error).name === "TimeoutError") continue;
        throw e;
      }
      const body = new Uint8Array(await res.arrayBuffer());
      if (res.ok) {
        await finish(o.sql, inv, null, { type: "done", value: body }, undefined, o.leaseMs);
        return "done";
      }
      // 4xx/5xx with a JSON body is the handler's TerminalError; anything else retries
      let err: { message?: string; code?: number } | undefined;
      try {
        err = JSON.parse(Buffer.from(body).toString());
      } catch {}
      if (!err?.message) throw new Error(`restate attach ${res.status}`);
      const error = { message: err.message, code: err.code ?? res.status };
      await finish(o.sql, inv, null, { type: "done", error }, undefined, o.leaseMs);
      return "done";
    }
  } catch (e) {
    if (fenced || isFenced(e)) return "fenced";
    await finish(
      o.sql,
      inv,
      null,
      { type: "failed", error: { message: String((e as Error)?.message ?? e) } },
      undefined,
      o.leaseMs,
    ).catch(() => {});
    return "failed";
  } finally {
    clearInterval(beat);
  }
}

/**
 * Resolves the Restate awakeable of each finished proxy row, then marks it replied.
 * NOTIFY rt_done for speed; a sweep every `sweepMs` for what a restart missed.
 */
export async function replier(o: {
  sql: postgres.Sql;
  ingress: Ingress;
  sweepMs?: number;
  log?: (msg: string, err?: unknown) => void;
}): Promise<{ stop(): Promise<void> }> {
  const log = o.log ?? ((m, e) => console.error(`rt replier: ${m}`, e ?? ""));
  let running = false;
  let again = false;
  const sweep = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const rows = await o.sql<
          { id: string; reply: string; result: Buffer | null; error: ErrorJson | null }[]
        >`
          SELECT id, reply, result, error FROM rt.invocations
          WHERE reply IS NOT NULL AND replied_at IS NULL AND status IN ('done', 'killed')
          ORDER BY completed_at LIMIT 100`;
        for (const r of rows) {
          const body: Reply = r.error
            ? { ok: false, error: r.error }
            : { ok: true, value: (r.result ?? Buffer.alloc(0)).toString("base64") };
          try {
            const res = await fetch(`${o.ingress.url}/restate/a/${r.reply}/resolve`, {
              method: "POST",
              headers: { ...o.ingress.headers, "content-type": "application/json" },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(30_000),
            });
            // 404: the proxy call is gone (cancelled or purged); nothing waits on it
            if (!res.ok && res.status !== 404) {
              log(`resolve ${r.id} → HTTP ${res.status}`);
              continue;
            }
            await o.sql`UPDATE rt.invocations SET replied_at = now() WHERE id = ${r.id}`;
          } catch (e) {
            log(`resolve ${r.id} failed`, e);
          }
        }
        if (rows.length === 100) again = true;
      } while (again);
    } catch (e) {
      log("sweep failed", e);
    } finally {
      running = false;
    }
  };
  const listener = await o.sql.listen("rt_done", () => void sweep());
  const timer = setInterval(() => void sweep(), o.sweepMs ?? 30_000);
  timer.unref();
  void sweep();
  return {
    async stop() {
      clearInterval(timer);
      await listener.unlisten();
    },
  };
}
