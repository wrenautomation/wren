/**
 * The pg runtime in the shape of `RestateTestEnvironment` (designs/2026-11-09-own-runtime.md,
 * "Tests and lints first"): an integration suite written for Restate runs unchanged on pg.
 *   baseUrl()          the door, serving every given service
 *   adminAPIBaseUrl()  Restate's admin subset tests use: POST /query (rt_admin views),
 *                      PATCH /invocations/{id}/{resume|kill|cancel}, POST /services/{svc}/state
 *   stateOf(svc, key)  Restate's StateProxy (get, getAll, set, setAll) on rt.state
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type Serde, serde as serdes } from "@restatedev/restate-sdk";
import postgres from "postgres";
import { rtAdmin, rtPatch } from "./admin.js";
import { Dispatcher } from "./dispatcher.js";
import { serveDoor } from "./door.js";
import { DEFAULT_LEASE_MS, remoteTurn, servedTurn } from "./executor.js";
import { Registry } from "./registry.js";
import { migrate } from "./schema.js";
import { register, setPgServices } from "./store.js";
import { fromWire, toWire } from "./wire.js";

export interface PgStateProxy {
  get<T>(name: string, serde?: Serde<T>): Promise<T | null>;
  getAll<T extends Record<string, unknown>>(serde?: Serde<unknown>): Promise<T>;
  set<T>(name: string, value: T, serde?: Serde<T>): Promise<void>;
  setAll(values: Record<string, unknown>, serde?: Serde<unknown>): Promise<void>;
}

export interface PgTestEnvironment {
  baseUrl(): string;
  adminAPIBaseUrl(): string;
  stateOf(service: { name: string }, key: string): PgStateProxy;
  stop(): Promise<void>;
}

export async function startPgTestEnvironment(o: {
  /** An empty test database; schema `rt` goes in it. */
  url: string;
  services: readonly unknown[];
  /** Restate's `disableRetries`: a failed handler ends on its first error. */
  disableRetries?: boolean;
}): Promise<PgTestEnvironment> {
  const sql = postgres(o.url, { max: 10, onnotice: () => {} });
  await migrate(sql);
  const registry = new Registry(o.services);
  if (o.disableRetries)
    for (const h of registry.list()) h.retry = { maxAttempts: 1, onMaxAttempts: "kill" };
  await register(sql, registry);
  const names = [...registry.services.keys()];
  await setPgServices(sql, names, "test");
  const log = () => {};
  const dispatcher = new Dispatcher({
    sql,
    concurrency: 16,
    pollMs: 50,
    lane: { only: names },
    // prod's Lambda path, wire both ways: load and finish here, the turn on the "Lambda" side
    run: (c) =>
      remoteTurn(sql, c, DEFAULT_LEASE_MS, async (ask) =>
        fromWire(toWire(await servedTurn({ sql, registry, log }, fromWire(toWire(ask))))),
      ),
    log,
  });
  await dispatcher.start();
  const door = await serveDoor({ sql });
  const query = rtAdmin(sql);
  const patch = rtPatch(sql);
  const admin = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const send = (code: number, v: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(v));
    };
    try {
      if (req.method === "POST" && path === "/query")
        return send(200, { rows: await query(body.query as string) });
      if (req.method === "PATCH" && (await patch(path))) return send(200, {});
      const state = /^\/services\/([^/]+)\/state$/.exec(path);
      if (req.method === "POST" && state) {
        const service = decodeURIComponent(state[1] as string);
        const key = body.object_key as string;
        const entries = Object.entries((body.new_state ?? {}) as Record<string, number[]>);
        await sql.begin(async (tx) => {
          await tx`DELETE FROM rt.state WHERE service = ${service} AND key = ${key}`;
          for (const [name, bytes] of entries)
            await tx`INSERT INTO rt.state (service, key, name, value)
              VALUES (${service}, ${key}, ${name}, ${Buffer.from(bytes)})`;
        });
        return send(202, {});
      }
      send(404, { message: `pg test admin: no ${req.method} ${path}` });
    } catch (e) {
      send(500, { message: (e as Error).message });
    }
  });
  await new Promise<void>((ok) => admin.listen(0, "127.0.0.1", ok));
  const adminUrl = `http://127.0.0.1:${(admin.address() as AddressInfo).port}`;
  const json = serdes.json as Serde<unknown>;
  const stateOf = ({ name: service }: { name: string }, key: string): PgStateProxy => ({
    async get<T>(name: string, s?: Serde<T>) {
      const [r] = await sql<{ value: Buffer }[]>`
        SELECT value FROM rt.state WHERE service = ${service} AND key = ${key} AND name = ${name}`;
      return r ? (s ?? (json as Serde<T>)).deserialize(new Uint8Array(r.value)) : null;
    },
    async getAll<T extends Record<string, unknown>>(s?: Serde<unknown>) {
      const rows = await sql<{ name: string; value: Buffer }[]>`
        SELECT name, value FROM rt.state WHERE service = ${service} AND key = ${key}`;
      return Object.fromEntries(
        rows.map((r) => [r.name, (s ?? json).deserialize(new Uint8Array(r.value))]),
      ) as T;
    },
    async set<T>(name: string, value: T, s?: Serde<T>) {
      const bytes = Buffer.from((s ?? (json as Serde<T>)).serialize(value));
      await sql`INSERT INTO rt.state (service, key, name, value) VALUES (${service}, ${key}, ${name}, ${bytes})
        ON CONFLICT (service, key, name) DO UPDATE SET value = EXCLUDED.value, at = now()`;
    },
    async setAll(values: Record<string, unknown>, s?: Serde<unknown>) {
      // Restate's setAll replaces the key's whole state
      await sql.begin(async (tx) => {
        await tx`DELETE FROM rt.state WHERE service = ${service} AND key = ${key}`;
        for (const [name, v] of Object.entries(values))
          await tx`INSERT INTO rt.state (service, key, name, value)
            VALUES (${service}, ${key}, ${name}, ${Buffer.from((s ?? json).serialize(v))})`;
      });
    },
  });
  return {
    baseUrl: () => door.url,
    adminAPIBaseUrl: () => adminUrl,
    stateOf,
    async stop() {
      await door.close();
      await new Promise<void>((ok) => admin.close(() => ok()));
      await dispatcher.stop();
      await sql.end({ timeout: 5 });
    },
  };
}
