/** The three isolation helpers against a real Postgres: what each level allows. */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  atomic,
  createDb,
  type DbHandle,
  type Queryable,
  serializable,
  snapshot,
  sqlState,
} from "../../src/index.js";
import { startTestPostgres, type TestPostgres } from "../../src/testing.js";

let pg: TestPostgres;
let wide: DbHandle;

beforeAll(async () => {
  pg = await startTestPostgres();
  wide = createDb(pg.url, { max: 4 });
  await pg.db.execute(sql`CREATE TABLE seats (id serial PRIMARY KEY, who text NOT NULL)`);
}, 120_000);

afterAll(async () => {
  await wide?.close();
  await pg?.stop();
});

beforeEach(async () => {
  await pg.db.execute(sql`TRUNCATE seats`);
});

const count = async (db: Queryable) =>
  ((await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM seats`))[0] as { n: number })
    .n;

/** Two writers each check a cap of one seat, both read before either writes: write skew. */
async function race(level: typeof atomic) {
  let read = 0;
  let release!: () => void;
  const bothRead = new Promise<void>((r) => {
    release = r;
  });
  const take = (who: string) =>
    level(wide.db, async (tx) => {
      const n = await count(tx);
      if (++read === 2) release();
      await bothRead;
      if (n < 1) await tx.execute(sql`INSERT INTO seats (who) VALUES (${who})`);
    });
  await Promise.all([take("a"), take("b")]);
  return count(pg.db);
}

describe("isolation levels", () => {
  it("level 2 lets both writers through the cap", async () => {
    expect(await race(atomic)).toBe(2);
  });

  it("level 4 aborts one writer, retries it, and the cap holds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await race(serializable)).toBe(1);
    expect(warn.mock.calls.some(([m]) => String(m).includes("40001"))).toBe(true);
    warn.mockRestore();
  });

  it("level 4 gives up after 5 tries and throws the failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let tries = 0;
    const err = await serializable(pg.db, async () => {
      tries++;
      throw Object.assign(new Error("Failed query"), { cause: { code: "40001" } });
    }).catch((e: unknown) => e);
    expect(sqlState(err)).toBe("40001");
    expect(tries).toBe(5);
    warn.mockRestore();
  });

  it("level 3 sees one snapshot and refuses writes", async () => {
    await pg.db.execute(sql`INSERT INTO seats (who) VALUES ('a')`);
    const seen = await snapshot(wide.db, async (tx) => {
      const before = await count(tx);
      await pg.db.execute(sql`INSERT INTO seats (who) VALUES ('b')`);
      return [before, await count(tx)];
    });
    expect(seen).toEqual([1, 1]);
    const err = await snapshot(pg.db, (tx) =>
      tx.execute(sql`INSERT INTO seats (who) VALUES ('c')`),
    ).catch((e: unknown) => e);
    expect(sqlState(err)).toBe("25006");
  });

  it("a helper inside a transaction runs on it: the outer level wins", async () => {
    const level = await atomic(pg.db, (outer) =>
      serializable(outer, async (tx) => {
        const [row] = await tx.execute<{ l: string }>(
          sql`SELECT current_setting('transaction_isolation') AS l`,
        );
        return row?.l;
      }),
    );
    expect(level).toBe("read committed");
  });

  it("every connection drops a transaction left idle for 10 minutes", async () => {
    const [row] = await pg.db.execute<{ t: string }>(
      sql`SELECT current_setting('idle_in_transaction_session_timeout') AS t`,
    );
    expect(row?.t).toBe("10min");
  });
});
