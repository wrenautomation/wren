/**
 * CDC relay (wren designs/2026-11-27-central-queue.md, phase 4): `rt.events` rows, in commit order,
 * from a logical slot (pgoutput, publication `rt_events`) to the NATS JetStream stream `RT_EVENTS`.
 *
 * - At least once: each insert is published (msg id = seq) before its commit's LSN is acked; a
 *   crash replays from the last acked commit. JetStream drops a repeat inside its window; past it,
 *   consumers dedupe by `seq`. `seq` is insert order, not commit order: never a high-water mark.
 * - One reader per slot (Postgres refuses a second): the other box slot waits as standby.
 * - A new or lost slot backfills from the table first, from an hour before the stream's last event.
 * - Never fatal to the worker: every failure ends the attempt, and the next one starts after a backoff.
 */
import {
  DiscardPolicy,
  type JetStreamClient,
  type JetStreamManager,
  jetstream,
  jetstreamManager,
  RetentionPolicy,
  StorageType,
} from "@nats-io/jetstream";
import { connect, type NatsConnection, nanos } from "@nats-io/transport-node";
import type { ClientConfig } from "pg";
import { LogicalReplicationService, PgoutputPlugin } from "pg-logical-replication";
import type postgres from "postgres";

export const RELAY_SLOT = "rt_events_relay";
export const RELAY_PUBLICATION = "rt_events";
export const EVENTS_STREAM = "RT_EVENTS";
/** `rt.events.<service>.<status>` */
export const EVENTS_SUBJECT = "rt.events";

const HOUR_MS = 3_600_000;
/** backfill reaches this far before the stream's last event: a commit can land after a later `at` */
const BACKFILL_OVERLAP_MS = HOUR_MS;
/** received, not yet published: past this the attempt ends and Postgres resends from the last ack */
const MAX_QUEUE = 5_000;
const PUBLISH_TIMEOUT_MS = 5_000;

/** One `rt.events` row as published. */
export interface RunEvent {
  seq: number;
  invocation_id: string;
  service: string;
  handler: string;
  key: string | null;
  status: string;
  attempt: number;
  failures: number;
  failure: unknown;
  lease_until: string | null;
  build: string | null;
  at: string;
}

export type RelayState =
  | "starting"
  | "waiting" // wal_level is not logical
  | "standby" // the other box slot reads the slot
  | "backfill"
  | "streaming"
  | "retrying"
  | "stopped";

export interface RelayStatus {
  state: RelayState;
  published: number;
  backfilled: number;
  lastAck: string | null;
  lastError: string | null;
}

export interface RelayOptions {
  /** admin queries: slot status, slot create, backfill */
  sql: postgres.Sql;
  /** direct Postgres (5432), never PgBouncer: a replication connection */
  replicationUrl: string;
  natsUrl: string;
  slot?: string;
  log: (msg: string, extra?: Record<string, unknown>) => void;
  /** first backoff; doubles to 60 s */
  retryMs?: number;
  /** a standby looks at the slot again after this; default 10 s */
  standbyMs?: number;
}

export interface Relay {
  status(): RelayStatus;
  stop(): Promise<void>;
}

const token = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");
export const eventSubject = (e: { service: string; status: string }) =>
  `${EVENTS_SUBJECT}.${token(e.service)}.${token(e.status)}`;

const iso = (v: unknown) =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

/** A pgoutput or table row as published; int8 arrives as a string. */
function toRunEvent(r: Record<string, unknown>): RunEvent {
  return {
    seq: Number(r.seq),
    invocation_id: String(r.invocation_id),
    service: String(r.service),
    handler: String(r.handler),
    key: (r.key as string | null) ?? null,
    status: String(r.status),
    attempt: Number(r.attempt),
    failures: Number(r.failures),
    failure: r.failure ?? null,
    lease_until: iso(r.lease_until),
    build: (r.build as string | null) ?? null,
    at: iso(r.at) as string,
  };
}

/**
 * node-pg reads `sslmode=require` as verify-full; the box's cert is self-signed and postgres.js
 * reads `require` as encrypt-only. Same meaning here.
 */
function replicationConfig(url: string): ClientConfig {
  const u = new URL(url);
  const mode = u.searchParams.get("sslmode");
  u.searchParams.delete("sslmode");
  const ssl = mode === "require" || mode === "prefer" ? { rejectUnauthorized: false } : undefined;
  return {
    connectionString: u.toString(),
    ...(ssl ? { ssl } : {}),
    application_name: "wren-rt-relay",
  };
}

/** The stream: file storage, kept 14 days or 1 GiB (the table keeps everything). */
export async function ensureEventsStream(jsm: JetStreamManager): Promise<void> {
  const config = {
    subjects: [`${EVENTS_SUBJECT}.>`],
    storage: StorageType.File,
    retention: RetentionPolicy.Limits,
    discard: DiscardPolicy.Old,
    max_age: nanos(14 * 24 * HOUR_MS),
    max_bytes: 1024 * 1024 * 1024,
    duplicate_window: nanos(HOUR_MS),
    num_replicas: 1,
  };
  try {
    await jsm.streams.info(EVENTS_STREAM);
    await jsm.streams.update(EVENTS_STREAM, config);
  } catch (e) {
    if (!/stream not found/i.test(String(e))) throw e;
    await jsm.streams.add({ name: EVENTS_STREAM, ...config });
  }
}

export async function publishEvent(js: JetStreamClient, e: RunEvent) {
  return js.publish(eventSubject(e), JSON.stringify(e), {
    msgID: String(e.seq),
    timeout: PUBLISH_TIMEOUT_MS,
  });
}

interface Slot {
  wal_status: string | null;
  active: boolean;
}

export function startRelay(o: RelayOptions): Relay {
  const slot = o.slot ?? RELAY_SLOT;
  const first = o.retryMs ?? 5_000;
  const st: RelayStatus = {
    state: "starting",
    published: 0,
    backfilled: 0,
    lastAck: null,
    lastError: null,
  };
  let stopped = false;
  let nc: NatsConnection | null = null;
  let service: LogicalReplicationService | null = null;
  let wake: (() => void) | null = null;
  const set = (s: RelayState, extra?: Record<string, unknown>) => {
    if (st.state !== s) o.log(`relay ${s}`, { slot, ...extra });
    st.state = s;
  };
  const sleep = (ms: number) =>
    new Promise<void>((r) => {
      const t = setTimeout(r, ms);
      t.unref?.();
      wake = () => {
        clearTimeout(t);
        r();
      };
    });

  const nats = async () => {
    if (nc && !nc.isClosed()) return nc;
    nc = await connect({
      servers: o.natsUrl,
      name: "wren-rt-relay",
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2_000,
    });
    return nc;
  };

  const slotRow = async (): Promise<Slot | undefined> =>
    (
      await o.sql<Slot[]>`
        SELECT wal_status, active FROM pg_replication_slots WHERE slot_name = ${slot}`
    )[0];

  /** Rows the stream may lack, from an hour before its last event; JetStream drops repeats in its window. */
  const backfill = async (js: JetStreamClient, jsm: JetStreamManager) => {
    const info = await jsm.streams.info(EVENTS_STREAM);
    if (!info.state.last_seq) return; // first start: the stream begins at the slot
    let since = info.state.last_ts ? new Date(info.state.last_ts) : new Date(0);
    try {
      const last = await jsm.streams.getMessage(EVENTS_STREAM, { seq: info.state.last_seq });
      if (last) since = new Date((last.json() as RunEvent).at);
    } catch {
      // aged out: the stream's own last time
    }
    const from = new Date(since.getTime() - BACKFILL_OVERLAP_MS);
    set("backfill", { from: from.toISOString() });
    let after = 0;
    for (;;) {
      const rows = await o.sql<Record<string, unknown>[]>`
        SELECT * FROM rt.events WHERE at >= ${from} AND seq > ${after} ORDER BY seq LIMIT 1000`;
      if (!rows.length) break;
      for (const r of rows) {
        if (stopped) return;
        await publishEvent(js, toRunEvent(r));
        st.backfilled++;
      }
      after = Number(rows[rows.length - 1]?.seq);
    }
    o.log("relay backfilled", { slot, rows: st.backfilled, from: from.toISOString() });
  };

  /** One attempt: until the stream ends, fails, or the relay stops. */
  const attempt = async (): Promise<"waiting" | "standby" | "ended"> => {
    const [lvl] = await o.sql<{ wal_level: string }[]>`SHOW wal_level`;
    if (lvl?.wal_level !== "logical") {
      set("waiting", { wal_level: lvl?.wal_level });
      return "waiting";
    }
    const conn = await nats();
    const jsm = await jetstreamManager(conn);
    const js = jetstream(conn);
    await ensureEventsStream(jsm);

    let row = await slotRow();
    if (row?.wal_status === "lost") {
      o.log("relay slot lost: dropped, made again, backfilled", { slot });
      await o.sql`SELECT pg_drop_replication_slot(${slot})`;
      row = undefined;
    }
    if (!row) {
      try {
        await o.sql`SELECT pg_create_logical_replication_slot(${slot}, 'pgoutput')`;
      } catch (e) {
        // the other box slot made it first
        if ((e as { code?: string }).code !== "42710") throw e;
        set("standby");
        return "standby";
      }
      await backfill(js, jsm);
    } else if (row.active) {
      set("standby");
      return "standby";
    }
    if (stopped) return "ended";

    const svc = new LogicalReplicationService(replicationConfig(o.replicationUrl), {
      acknowledge: { auto: false, timeoutSeconds: 0 }, // its timer acks what was received, not published
      flowControl: { enabled: false },
    });
    service = svc;
    const queue: Record<string, unknown>[] = [];
    let busy = false;
    let inTx = false;
    let failed: unknown = null;
    const fail = (e: unknown) => {
      if (failed) return;
      failed = e ?? new Error("relay failed");
      void svc.stop();
    };
    const handle = async (m: Record<string, unknown>) => {
      switch (m.tag) {
        case "begin":
          inTx = true;
          return;
        case "insert": {
          const rel = m.relation as { schema: string; name: string };
          if (rel.schema !== "rt" || rel.name !== "events") return;
          await publishEvent(js, toRunEvent(m.new as Record<string, unknown>));
          st.published++;
          return;
        }
        case "commit": {
          const lsn = m.commitEndLsn as string;
          await svc.acknowledge(lsn);
          st.lastAck = lsn;
          inTx = false;
          return;
        }
      }
    };
    const drain = async () => {
      if (busy) return;
      busy = true;
      try {
        while (queue.length && !failed) await handle(queue.shift() as Record<string, unknown>);
      } catch (e) {
        fail(e);
      } finally {
        busy = false;
      }
    };
    svc.on("error", fail);
    svc.on("start", () => set("streaming"));
    svc.on("data", (_lsn: string, m: Record<string, unknown>) => {
      if (failed) return;
      queue.push(m);
      if (queue.length > MAX_QUEUE) fail(new Error(`relay queue over ${MAX_QUEUE}`));
      else void drain();
    });
    // idle: ack the server's position so the slot keeps no WAL; busy: answer with the last ack
    svc.on("heartbeat", (lsn: string, _t: number, respond: boolean) => {
      if (failed) return;
      if (!busy && !queue.length && !inTx) {
        st.lastAck = lsn;
        void svc.acknowledge(lsn);
      } else if (respond) void svc.acknowledge(st.lastAck ?? "0/0");
    });
    try {
      await svc.subscribe(
        new PgoutputPlugin({ protoVersion: 1, publicationNames: [RELAY_PUBLICATION] }),
        slot,
      );
    } catch (e) {
      fail(e);
    } finally {
      service = null;
      await svc.destroy().catch(() => {});
    }
    if (failed && !stopped) throw failed;
    return "ended";
  };

  const run = async () => {
    let backoff = first;
    while (!stopped) {
      const began = Date.now();
      let next = backoff;
      try {
        const out = await attempt();
        if (out === "waiting") next = 5 * 60_000;
        else if (out === "standby") next = o.standbyMs ?? 10_000;
      } catch (e) {
        st.lastError = e instanceof Error ? e.message : String(e);
        set("retrying", { error: st.lastError });
      }
      if (stopped) break;
      // a long healthy run starts the backoff over
      backoff = Date.now() - began > 60_000 ? first : Math.min(backoff * 2, 60_000);
      await sleep(next);
    }
  };
  const done = run().catch((e: unknown) => o.log("relay loop ended", { error: String(e) }));

  return {
    status: () => ({ ...st }),
    async stop() {
      stopped = true;
      wake?.();
      await service?.stop().catch(() => {});
      await done;
      await nc?.close().catch(() => {});
      set("stopped");
    },
  };
}
