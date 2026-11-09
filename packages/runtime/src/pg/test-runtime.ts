/**
 * The pg runtime for an integration suite (designs/2026-11-09-own-runtime.md, "Tests and lints first").
 *   baseUrl()          the door, serving every given service
 *   admin              admin SQL on the rt_admin views; PATCH-style /invocations/{id}/{resume|kill|cancel}
 *   stateOf(svc, key)  get, getAll, set, setAll on rt.state
 */
import { type Serde, serde as serdes } from "@restatedev/restate-sdk";
import postgres from "postgres";
import { rtAdmin, rtPatch } from "./admin.js";
import { Dispatcher } from "./dispatcher.js";
import { serveDoor } from "./door.js";
import { DEFAULT_LEASE_MS, remoteTurn, servedTurn } from "./executor.js";
import { Registry } from "./registry.js";
import { migrate } from "./schema.js";
import { register } from "./store.js";
import { fromWire, toWire } from "./wire.js";

export interface PgStateProxy {
  get<T>(name: string, serde?: Serde<T>): Promise<T | null>;
  getAll<T extends Record<string, unknown>>(serde?: Serde<unknown>): Promise<T>;
  set<T>(name: string, value: T, serde?: Serde<T>): Promise<void>;
  setAll(values: Record<string, unknown>, serde?: Serde<unknown>): Promise<void>;
}

export interface PgTestEnvironment {
  baseUrl(): string;
  admin: {
    query(q: string): Promise<Record<string, unknown>[]>;
    /** False when the path names no rt row. */
    patch(path: string): Promise<boolean>;
  };
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
    admin: { query: rtAdmin(sql), patch: rtPatch(sql) },
    stateOf,
    async stop() {
      await door.close();
      await dispatcher.stop();
      await sql.end({ timeout: 5 });
    },
  };
}
