// Attach vs the target's finish, in the one order that loses a wake without the share lock
// (store.ts attachLocks): finish's attach UPDATE runs, then the attacher's flush checks and commits,
// then finish commits. A held lock on the target's parent pauses finish at that point.
import { startTestPostgres } from "@wren/db/testing";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import { kill } from "../../src/pg/admin.js";
import { migrate } from "../../src/pg/index.js";
import { finish, flush } from "../../src/pg/store.js";
import type { Invocation, Writes } from "../../src/pg/turn.js";

let sql: postgres.Sql;
let stopPg: () => Promise<void>;
beforeAll(async () => {
  const pg = await startTestPostgres();
  sql = postgres(pg.url, { max: 6, onnotice: () => {} });
  await migrate(sql);
  stopPg = () => pg.stop();
}, 120_000);
afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await stopPg?.();
});

const inv = (id: string, parent: string | null = null): Invocation => ({
  id,
  service: "S",
  handler: "h",
  key: null,
  input: new Uint8Array(),
  headers: {},
  attempt: 1,
  failures: 0,
  cancel: false,
  parent_id: parent,
  parent_seq: parent ? 0 : null,
  caller_waits: false,
});
const running = (id: string, parent: string | null = null) => sql`
  INSERT INTO rt.invocations (id, service, handler, input, status, attempt, parent_id, parent_seq)
  VALUES (${id}, 'S', 'h', '\\x', 'running', 1, ${parent}, ${parent ? 0 : null})`;

it("an attach written while its target finishes still settles", async () => {
  await running("inv_p");
  await sql`INSERT INTO rt.journal (invocation_id, seq, kind, ref) VALUES ('inv_p', 0, 'call', 'inv_t')`;
  await running("inv_t", "inv_p");
  await running("inv_a");

  // hold the parent row: finish(T) stops at its parent wake, after its attach UPDATE
  let release = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  let locked = () => {};
  const isLocked = new Promise<void>((r) => {
    locked = r;
  });
  const blocker = sql.begin(async (tx) => {
    await tx`SELECT 1 FROM rt.invocations WHERE id = 'inv_p' FOR UPDATE`;
    locked();
    await held;
  });
  await isLocked;
  const done = finish(
    sql,
    inv("inv_t", "inv_p"),
    null,
    { type: "done", value: Buffer.from('"ok"') },
    undefined,
    10_000,
  );
  await new Promise((r) => setTimeout(r, 300));

  const w: Writes = {
    journal: new Map([
      [
        0,
        {
          seq: 0,
          kind: "attach",
          name: "",
          done: false,
          value: null,
          error: null,
          wake_at: null,
          ref: "inv_t",
          tries: 0,
          first_at: null,
        },
      ],
    ]),
    sets: new Map(),
    clears: new Set(),
    clearAll: false,
    children: [],
    awakes: [],
    cancels: [],
    uncancel: false,
  };
  const flushed = flush(sql, inv("inv_a"), w, 10_000);
  // the attacher waits on the target's lock, or commits now (the lost-wake order)
  await Promise.race([flushed, new Promise((r) => setTimeout(r, 300))]);
  release();
  await blocker;
  await done;
  await flushed;

  const [row] = await sql<{ done: boolean; value: Buffer | null }[]>`
    SELECT done, value FROM rt.journal WHERE invocation_id = 'inv_a' AND seq = 0`;
  expect(row?.done).toBe(true);
  expect(Buffer.from(row?.value ?? []).toString()).toBe('"ok"');
});

it("a killed target settles its attaches with 409", async () => {
  await running("inv_k");
  await running("inv_b");
  await sql`INSERT INTO rt.journal (invocation_id, seq, kind, ref) VALUES ('inv_b', 0, 'attach', 'inv_k')`;
  expect(await kill(sql, "inv_k")).toBe(1);
  const [row] = await sql<{ done: boolean; code: number }[]>`
    SELECT done, (error->>'code')::int AS code FROM rt.journal WHERE invocation_id = 'inv_b' AND seq = 0`;
  const [k] = await sql<
    { t: string }[]
  >`SELECT jsonb_typeof(error) AS t FROM rt.invocations WHERE id = 'inv_k'`;
  expect(k?.t).toBe("object");
  expect(row).toEqual({ done: true, code: 409 });
  const [b] = await sql<{ wake: boolean }[]>`SELECT wake FROM rt.invocations WHERE id = 'inv_b'`;
  expect(b?.wake).toBe(true);
});
