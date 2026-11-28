// CDC relay drills (wren designs/2026-11-27-central-queue.md, phase 4): rt.events rows reach
// RT_EVENTS once committed, through a killed walsender, a stalled NATS, a dropped or lost slot and
// a hand-over between two relays.
import { type JetStreamManager, jetstream, jetstreamManager } from "@nats-io/jetstream";
import { connect, type NatsConnection } from "@nats-io/transport-node";
import { startNatsContainer, startPostgresContainer } from "@wren/db/testing";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EVENTS_STREAM,
  publishEvent,
  RELAY_SLOT,
  type Relay,
  type RelayOptions,
  type RunEvent,
  startRelay,
} from "../../src/pg/events.js";
import { migrate, serveDoor } from "../../src/pg/index.js";

let sql: postgres.Sql;
let url = "";
let natsUrl = "";
let nats: Awaited<ReturnType<typeof startNatsContainer>>;
let nc: NatsConnection;
let jsm: JetStreamManager;
const relays: Relay[] = [];
const logs: string[] = [];
let stop = async () => {};

beforeAll(async () => {
  const [pg, started] = await Promise.all([
    startPostgresContainer(undefined, undefined, [
      "wal_level=logical",
      "wal_sender_timeout=2s", // keepalives each second: the idle ack shows fast
      "max_slot_wal_keep_size=32MB", // a stopped slot is lost after a few segments
    ]),
    startNatsContainer(),
  ]);
  url = pg.getConnectionUri();
  nats = started;
  natsUrl = nats.url;
  sql = postgres(url, { max: 8, onnotice: () => {} });
  await migrate(sql);
  nc = await connect({ servers: natsUrl });
  jsm = await jetstreamManager(nc);
  stop = async () => {
    await Promise.all(relays.map((r) => r.stop()));
    await nc.close();
    await sql.end({ timeout: 5 });
    await Promise.all([pg.stop(), nats.stop()]);
  };
}, 120_000);
afterAll(() => stop(), 60_000);

const relay = (extra: Partial<RelayOptions> = {}) => {
  const r = startRelay({
    sql,
    replicationUrl: url,
    natsUrl,
    retryMs: 200,
    standbyMs: 300,
    log: (m, x) => logs.push(`${m} ${JSON.stringify(x ?? {})}`),
    ...extra,
  });
  relays.push(r);
  return r;
};

let n = 0;
const insert = async (q: postgres.Sql | postgres.TransactionSql | postgres.ReservedSql) => {
  const [r] = await q<{ seq: string }[]>`
    INSERT INTO rt.events (invocation_id, service, handler, key, status, attempt, failures, failure)
    VALUES (${`inv_${++n}`}, 'Svc.A', 'run', 'k', 'running', 1, 0, ${sql.json({ why: "x" })})
    RETURNING seq`;
  return Number(r?.seq);
};

const streamed = async () => {
  const info = await jsm.streams.info(EVENTS_STREAM).catch(() => null);
  const out: { subject: string; e: RunEvent }[] = [];
  if (!info?.state.messages) return out;
  for (let s = info.state.first_seq; s <= info.state.last_seq; s++) {
    const m = await jsm.streams.getMessage(EVENTS_STREAM, { seq: s });
    if (m) out.push({ subject: m.subject, e: m.json<RunEvent>() });
  }
  return out;
};
const seqs = async () => (await streamed()).map((x) => x.e.seq);
const until = async (what: string, f: () => Promise<boolean> | boolean, ms = 30_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await f()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out: ${what}\n${logs.slice(-15).join("\n")}`);
};
const has = async (want: number[]) => {
  const got = new Set(await seqs());
  return want.every((s) => got.has(s));
};
const slotRow = async () =>
  (
    await sql<{ active: boolean; wal_status: string | null }[]>`
      SELECT active, wal_status FROM pg_replication_slots WHERE slot_name = ${RELAY_SLOT}`
  )[0];
const stopAll = async () => {
  await Promise.all(relays.splice(0).map((r) => r.stop()));
  await until("slot released", async () => !(await slotRow())?.active);
};

describe("CDC relay", () => {
  it("sends committed inserts in commit order; a rollback sends nothing", async () => {
    const r = relay();
    await until("streaming", () => r.status().state === "streaming");
    const ab = await sql.begin(async (tx) => [await insert(tx), await insert(tx)]);
    await sql
      .begin(async (tx) => {
        await insert(tx);
        throw new Error("roll back");
      })
      .catch(() => {});
    const c = await insert(sql);
    await until("three events", () => has([...ab, c]));
    const all = await streamed();
    expect(all.map((x) => x.e.seq)).toEqual([...ab, c]);
    expect(all[0]?.subject).toBe("rt.events.Svc_A.running");
    expect(all[0]?.e).toMatchObject({ service: "Svc.A", status: "running", failure: { why: "x" } });
    expect(r.status().published).toBe(3);
  }, 60_000);

  it("acks the server's position while idle, so the slot holds no WAL", async () => {
    await sql`CREATE TABLE IF NOT EXISTS public.noise (x int)`;
    await sql`INSERT INTO public.noise SELECT generate_series(1, 1000)`;
    const [{ lsn } = { lsn: "" }] = await sql<
      { lsn: string }[]
    >`SELECT pg_current_wal_lsn()::text lsn`;
    await until("slot caught up", async () => {
      const [r] = await sql<{ behind: string }[]>`
        SELECT pg_wal_lsn_diff(${lsn}::pg_lsn, confirmed_flush_lsn)::text behind
        FROM pg_replication_slots WHERE slot_name = ${RELAY_SLOT}`;
      return Number(r?.behind) <= 0;
    });
  }, 60_000);

  it("a killed walsender mid-transaction: the commit still arrives", async () => {
    const tx = await sql.reserve();
    await tx`BEGIN`;
    const a = await insert(tx);
    await sql`SELECT pg_terminate_backend(active_pid) FROM pg_replication_slots WHERE slot_name = ${RELAY_SLOT}`;
    const b = await insert(tx);
    await tx`COMMIT`;
    tx.release();
    const c = await insert(sql);
    await until("killed tx sent", () => has([a, b, c]));
    expect(relays[0]?.status().state).toBe("streaming");
  }, 60_000);

  it("a replayed event is stored once", async () => {
    const before = await streamed();
    const last = before[before.length - 1]?.e as RunEvent;
    const ack = await publishEvent(jetstream(nc), last);
    expect(ack.duplicate).toBe(true);
    expect((await streamed()).length).toBe(before.length);
  });

  it("NATS stalled: rows wait in the slot and arrive after", async () => {
    const r = relays[0] as Relay;
    await nats.pause();
    let rows: number[] = [];
    try {
      rows = [await insert(sql), await insert(sql)];
      await until("relay retrying", () => r.status().state === "retrying", 30_000);
    } finally {
      await nats.unpause();
    }
    await until("rows after the stall", () => has(rows), 60_000);
    const all = await seqs();
    expect(new Set(all).size).toBe(all.length);
  }, 120_000);

  it("a dropped slot: the new one backfills from the table", async () => {
    await stopAll();
    await sql`SELECT pg_drop_replication_slot(${RELAY_SLOT})`;
    const gone = [await insert(sql), await insert(sql)];
    const r = relay();
    await until("backfilled", () => has(gone));
    await until("streaming", () => r.status().state === "streaming");
    expect(r.status().backfilled).toBeGreaterThanOrEqual(2);
    const after = await insert(sql);
    await until("streams after backfill", () => has([after]));
    const all = await seqs();
    expect(new Set(all).size).toBe(all.length);
  }, 60_000);

  it("a lost slot: dropped, made again, backfilled", async () => {
    await stopAll();
    const gone = [await insert(sql), await insert(sql)];
    // push WAL past max_slot_wal_keep_size, then a checkpoint removes the segments the slot needs
    for (let i = 0; i < 6; i++) {
      await sql`INSERT INTO public.noise SELECT generate_series(1, 10)`;
      await sql`SELECT pg_switch_wal()`;
    }
    await sql`CHECKPOINT`;
    expect((await slotRow())?.wal_status).toBe("lost");
    const r = relay();
    await until("backfilled after loss", () => has(gone));
    await until("streaming", () => r.status().state === "streaming");
    expect((await slotRow())?.wal_status).not.toBe("lost");
    expect(logs.some((l) => l.startsWith("relay slot lost"))).toBe(true);
  }, 60_000);

  it("two relays: one reads the slot, the other waits and takes over", async () => {
    await stopAll();
    const a = relay();
    const b = relay();
    const states = () => [a.status().state, b.status().state].sort();
    await until("one streams, one waits", () => states().join() === "standby,streaming");
    const [live, spare] = a.status().state === "streaming" ? [a, b] : [b, a];
    await live.stop();
    relays.splice(relays.indexOf(live), 1);
    await until("spare takes over", () => spare.status().state === "streaming");
    const s = await insert(sql);
    await until("spare sends", () => has([s]));
  }, 60_000);

  it("the door streams events as SSE: replay from a time, then live, by subject", async () => {
    const door = await serveDoor({ sql, natsUrl });
    try {
      expect((await fetch(`${door.url}/rt/events?since=nope`)).status).toBe(400);
      const ac = new AbortController();
      const r = await fetch(
        `${door.url}/rt/events?since=${new Date(0).toISOString()}&subject=rt.events.Svc_B.*`,
        { signal: ac.signal },
      );
      expect(r.headers.get("content-type")).toBe("text/event-stream");
      await sql`
        INSERT INTO rt.events (invocation_id, service, handler, key, status, attempt, failures)
        VALUES ('inv_b', 'Svc.B', 'run', null, 'paused', 2, 2)`;
      const reader = (r.body as ReadableStream<Uint8Array>)
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let text = "";
      while (!text.includes("data: ")) text += (await reader.read()).value ?? "";
      ac.abort();
      const data = JSON.parse(/data: (.*)/.exec(text)?.[1] ?? "{}") as RunEvent;
      expect(data).toMatchObject({ service: "Svc.B", status: "paused", invocation_id: "inv_b" });
      expect(text).not.toContain("Svc.A");
    } finally {
      await door.close();
    }
  }, 60_000);
});
