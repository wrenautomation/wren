/**
 * The Postgres runtime beside Restate (designs/2026-11-09-own-runtime.md, "Phase 3").
 * `PG_SERVICES` run on it; Restate serves a proxy of each. The box hosts the loops:
 *   box lane     pg services in BOX_SERVICES, in this process, pinned to this build
 *   lambda lane  other pg services, one Lambda invoke per turn, pinned to a version ARN
 *   bridge lane  rows for services still on Restate, forwarded to Restate's loopback ingress
 *   replier      resolves each finished proxy call's Restate awakeable
 */
import { readFileSync, statSync } from "node:fs";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  bridgeTurn,
  Dispatcher,
  type Ingress,
  migrate,
  postgres,
  proxy,
  Registry,
  register,
  renameService,
  replier,
  returnState,
  runTurn,
} from "@wren/runtime/pg";
import type { Logger } from "pino";
import type { AnyService } from "./services.js";

/** Services on the Postgres runtime. A deploy flips one; pg keeps every service registered. */
/** AuditLogSeal first: a 15-min loop, low risk, on the Lambda lane. */
const PG_SERVICES: readonly string[] = ["AuditLogSeal"];

/**
 * Old name → new, for pg services only (WA-1219: a rename lands with the move). Restate keeps a
 * proxy under the old name: its scheduled calls and state reach the new one. Drop an entry once
 * Restate holds nothing under the old name.
 */
const RENAMED: Readonly<Record<string, string>> = { AuditSeal: "AuditLogSeal" };

const LEASE_MS = 60_000;

/** The Restate side: each pg service becomes a proxy of the same name. */
export function restateSide(services: AnyService[], sql: () => postgres.Sql): AnyService[] {
  return services.flatMap((s) => {
    if (!PG_SERVICES.includes(s.name)) return [s];
    const olds = Object.keys(RENAMED).filter((o) => RENAMED[o] === s.name);
    return [s.name, ...olds].map((as) => proxy(s as never, sql, as) as unknown as AnyService);
  });
}

/** Postgres for the runtime. No prepared statements: Lambda goes through PgBouncer (transaction mode). */
export const rtSql = (url: string, max: number, app: string) =>
  postgres(url, {
    max,
    prepare: false,
    onnotice: () => {},
    connection: { application_name: app, idle_in_transaction_session_timeout: 120_000 },
  });

/** The current Lambda version ARN; CI writes it at register. Read again when the file changes. */
function arnFile(path: string) {
  let mtime = 0;
  let arn: string | undefined;
  return () => {
    try {
      const m = statSync(path).mtimeMs;
      if (m !== mtime) {
        arn = readFileSync(path, "utf8").trim() || undefined;
        mtime = m;
      }
    } catch {}
    return arn;
  };
}

export async function startRt(o: {
  all: AnyService[];
  box: readonly string[];
  /** Straight to Postgres: LISTEN needs a session, which PgBouncer's transaction mode drops. */
  databaseUrl: string;
  build: string;
  /** The slot this one replaces; it keeps finishing its own rows. */
  buildLive?: string;
  ingress: Ingress;
  /** Restate's admin, self-hosted only: a flip back returns object state through it. */
  admin?: string;
  arnPath?: string;
  log: Logger;
}) {
  const sql = rtSql(o.databaseUrl, 12, "wren-rt-box");
  await migrate(sql);
  const registry = new Registry(o.all as never);
  await register(sql, registry);
  // a failed rename must not stop the box: rows left under the old name take the bridge lane
  for (const [from, to] of Object.entries(RENAMED))
    try {
      const moved = await renameService(sql, from, to);
      if (moved.rows || moved.state) o.log.info({ from, to, ...moved }, "rt: renamed");
    } catch (e) {
      o.log.error({ err: String(e), from, to }, "rt: rename failed");
    }
  if (o.admin)
    for (const { service } of await sql<
      { service: string }[]
    >`SELECT DISTINCT service FROM rt.state`)
      if (!PG_SERVICES.includes(service)) {
        const n = await returnState(sql, o.admin, service);
        o.log.info({ service, keys: n }, "rt: state returned to Restate");
      }
  const log = (m: string, e?: unknown) =>
    o.log.warn({ err: e ? String(e) : undefined }, `rt: ${m}`);
  const onBox = PG_SERVICES.filter((s) => o.box.includes(s));
  const onLambda = PG_SERVICES.filter((s) => !o.box.includes(s));
  // rows pinned to a stopped slot (two deploys ago) replay on this build, as Restate's `force` does
  if (onBox.length)
    await sql`UPDATE rt.invocations SET build = ${o.build}
      WHERE service IN ${sql(onBox)} AND status NOT IN ('done', 'killed')
        AND build NOT IN ${sql([o.build, ...(o.buildLive ? [o.buildLive] : [])])}`;
  const arn = arnFile(o.arnPath ?? "/etc/wren/worker-arn");
  const lambda = new LambdaClient({});

  const boxLane = new Dispatcher({
    sql,
    concurrency: 6,
    leaseMs: LEASE_MS,
    lane: { only: onBox, build: o.build, strict: true },
    run: (c) => runTurn({ sql, registry, leaseMs: LEASE_MS, log }, c),
    log,
  });
  const lambdaLane = new Dispatcher({
    sql,
    // under the worker's reserved concurrency (lambda_max_concurrency), which Restate shares until phase 6
    concurrency: Number(process.env.WREN_RT_LAMBDA_CONCURRENCY ?? 4),
    leaseMs: LEASE_MS,
    lane: { only: onLambda, ...(arn() ? { build: arn() as string } : {}) },
    run: async (c) => {
      const fn = c.build ?? arn();
      if (!fn) throw new Error("no worker ARN yet");
      const r = await lambda.send(
        new InvokeCommand({
          FunctionName: fn,
          InvocationType: "RequestResponse",
          Payload: Buffer.from(
            JSON.stringify({ rt: { id: c.id, attempt: c.attempt, leaseMs: LEASE_MS } }),
          ),
        }),
      );
      // a crashed turn keeps its lease and is claimed again when it runs out
      if (r.FunctionError) log(`lambda turn ${c.id} #${c.attempt}: ${r.FunctionError}`);
    },
    log,
  });
  const bridgeLane = new Dispatcher({
    sql,
    concurrency: 40,
    leaseMs: LEASE_MS,
    lane: { except: PG_SERVICES, lock: false },
    run: (c) => bridgeTurn({ sql, ingress: o.ingress, leaseMs: LEASE_MS }, c),
    log,
  });
  // a new ARN pins new Lambda rows to it
  const repin = setInterval(() => {
    const a = arn();
    if (a) lambdaLane.setLane({ only: onLambda, build: a });
  }, 30_000);
  repin.unref();
  await Promise.all([boxLane.start(), lambdaLane.start(), bridgeLane.start()]);
  let reply: { stop(): Promise<void> } | null = await replier({ sql, ingress: o.ingress, log });
  o.log.info({ pg: PG_SERVICES, onBox, onLambda, build: o.build }, "rt ready");

  return {
    sql,
    /** A newer slot took over: finish this build's own box rows only. */
    async superseded() {
      clearInterval(repin);
      boxLane.setLane({ only: onBox, build: o.build, strict: true, fresh: false });
      await Promise.all([lambdaLane.stop(), bridgeLane.stop(), reply?.stop()]);
      reply = null;
    },
    async stop() {
      clearInterval(repin);
      await Promise.all([boxLane.stop(), lambdaLane.stop(), bridgeLane.stop(), reply?.stop()]);
      await sql.end({ timeout: 5 });
    },
  };
}

/** Lambda: one turn of a pg row, when the box's lambda lane invokes with `{rt}`. */
export const isRtEvent = (
  e: unknown,
): e is { rt: { id: string; attempt: number; leaseMs: number } } =>
  typeof e === "object" && e !== null && "rt" in e;

export function lambdaTurns(all: AnyService[], sql: postgres.Sql) {
  const registry = new Registry(all as never);
  return (e: { rt: { id: string; attempt: number; leaseMs: number } }) =>
    runTurn({ sql, registry, leaseMs: e.rt.leaseMs }, e.rt);
}
