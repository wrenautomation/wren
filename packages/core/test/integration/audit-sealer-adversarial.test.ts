/**
 * Adversarial cover for sealEverywhere: it seals main and every client through
 * the client's own login, the logged hash is what verify reports, and one bad
 * database fails the pass without silencing the rest. Tests marked "BUG" assert
 * how it should behave, so they fail now and pass once the source is fixed.
 */
import {
  clientDatabaseName,
  clientDatabaseUrl,
  createDb,
  type Db,
  type DbHandle,
  sealAudit,
  verifyAudit,
} from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sealEverywhere } from "../../src/audit.js";
import { addClient, clients } from "../../src/clients/index.js";

const ACME = clientDatabaseName("acme");
const BETA = clientDatabaseName("beta");
const GHOST = clientDatabaseName("ghost");

let pg: TestPostgres;
const handles = new Map<string, DbHandle>();

function open({ database }: { database: string }): Db {
  let h = handles.get(database);
  if (!h) {
    h = createDb(clientDatabaseUrl(pg.url, database), { max: 1, app: "sealer-test" });
    handles.set(database, h);
  }
  return h.db;
}

const makeDeps = (log: (line: string) => void = () => {}) => ({ main: pg.db, open, log });
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
let mark = 0;
const suppress = (db: Db) =>
  db.execute(
    sql`insert into suppressions (kind, value, reason) values ('email', ${`s${mark++}@x.example`}, 'manual')`,
  );
const sealCount = async (db: Db) =>
  (await db.execute<{ n: number }>(sql`select count(*)::int n from audit_seals`))[0]?.n ?? 0;
const addGhost = () =>
  pg.db.insert(clients).values({
    id: "ghost",
    name: "Ghost",
    database: GHOST,
    accounts: {},
    products: {},
    portalEmails: [],
  });
const removeGhost = () => pg.db.delete(clients).where(eq(clients.id, "ghost"));

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme" });
  await addClient(pg.db, pg.url, { id: "beta", name: "Beta" });
}, 180_000);
afterAll(async () => {
  for (const h of handles.values()) await h.close();
  await pg.stop();
});

describe("a clean pass", () => {
  it("seals main and every client, and the logged hash is what verify reports", async () => {
    await suppress(pg.db);
    await suppress(open({ database: ACME }));
    await suppress(open({ database: BETA }));
    const lines: string[] = [];
    const stats = await sealEverywhere(makeDeps((l) => lines.push(l)));
    expect(stats).toMatchObject({ sealed: 3, databases: 3 });
    expect(lines).toHaveLength(3);
    for (const [name, db] of [
      ["main", pg.db],
      [ACME, open({ database: ACME })],
      [BETA, open({ database: BETA })],
    ] as const) {
      const line = lines.find((l) => l.includes(`audit seal ${name} `));
      const hash = line?.split("hash ")[1];
      expect((await verifyAudit(db)).lastHash).toBe(hash);
    }
  });
});

describe("one unreachable database", () => {
  it("fails the pass, naming the database", async () => {
    await addGhost();
    try {
      await expect(sealEverywhere(makeDeps())).rejects.toThrow(/ghost/);
    } finally {
      await removeGhost();
    }
  });

  // BUG: the catch keeps only DrizzleQueryError.message ("Failed query: ..."),
  // dropping err.cause, so the pass never says WHY a client was unreachable
  // (core/src/audit.ts, the catch in sealEverywhere).
  it("says why the database was unreachable", async () => {
    await addGhost();
    try {
      await expect(sealEverywhere(makeDeps())).rejects.toThrow(
        /does not exist|password authentication failed/,
      );
    } finally {
      await removeGhost();
    }
  });
});

describe("a stuck database must not hold up the others", () => {
  // BUG: the pass seals databases one after another with no per-database
  // timeout, so a client that blocks on its own seal lock stalls every client
  // after it (core/src/audit.ts, the sequential loop in sealEverywhere).
  it("seals beta within 15s while an acme login holds the seal lock", async () => {
    await suppress(open({ database: BETA }));
    const baseline = await sealCount(open({ database: BETA }));
    // max:1 keeps one connection, so this session-level advisory lock stays held.
    const locker = createDb(clientDatabaseUrl(pg.url, ACME), { max: 1, app: "sealer-lock" });
    try {
      await locker.db.execute(sql`select pg_advisory_lock(hashtext('wren audit seal'))`);
      const pass = sealEverywhere(makeDeps()).catch(() => {});
      const sealedInTime = await Promise.race([
        (async () => {
          while ((await sealCount(open({ database: BETA }))) <= baseline) await delay(250);
          return true;
        })(),
        delay(15_000).then(() => false),
      ]);
      await locker.db.execute(sql`select pg_advisory_unlock_all()`);
      await pass;
      expect(sealedInTime).toBe(true);
    } finally {
      await locker.close();
    }
  }, 60_000);
});

describe("a client whose login defaults to a stricter isolation", () => {
  // BUG: sealAudit runs audit_seal() in whatever isolation the session opens
  // with, and audit_seal() refuses anything but READ COMMITTED. A client role
  // set to repeatable read breaks the whole pass; the seal should force its own
  // isolation (packages/db audit/index.ts sealAudit; install.ts lines 99-101).
  it("still seals when a client defaults to repeatable read", async () => {
    const cached = handles.get(BETA);
    if (cached) {
      await cached.close();
      handles.delete(BETA);
    }
    await pg.db.execute(
      sql.raw(`alter role "${BETA}" set default_transaction_isolation = 'repeatable read'`),
    );
    try {
      await suppress(open({ database: BETA }));
      await expect(sealEverywhere(makeDeps())).resolves.toMatchObject({ databases: 3 });
    } finally {
      await pg.db.execute(sql.raw(`alter role "${BETA}" reset default_transaction_isolation`));
      const c2 = handles.get(BETA);
      if (c2) {
        await c2.close();
        handles.delete(BETA);
      }
    }
  });
});

// Confirms the seal helper itself behaves for the clean cases above.
describe("sealAudit sanity", () => {
  it("returns null on a second pass with no new events", async () => {
    await sealAudit(pg.db);
    expect(await sealAudit(pg.db)).toBeNull();
  });
});
