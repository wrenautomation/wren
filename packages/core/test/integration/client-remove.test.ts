/** `wren clients rm`: the dry run counts, the removal takes the row, cascades, state, database and login. */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addClient,
  clientDomains,
  clientRemoval,
  findClient,
  removeClient,
} from "../../src/clients/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres({ own: true });
});
afterAll(() => pg.stop());

const exists = async (q: string) =>
  ((await pg.db.execute<{ n: number }>(sql.raw(q)))[0]?.n ?? 0) > 0;

describe("clients rm", () => {
  it("counts first, then removes the client and only the client", async () => {
    await addClient(pg.db, pg.url, { id: "gone_co", name: "Gone Co" });
    await addClient(pg.db, pg.url, { id: "gone", name: "Kept" });
    await pg.db.insert(clientDomains).values({
      hostname: "gone.test",
      clientId: "gone_co",
      cfId: "cf1",
      status: "pending",
      sslStatus: "pending",
      records: {} as never,
      addedBy: "test",
    });

    const plan = await clientRemoval(pg.db, pg.url, "gone_co");
    expect(plan.main).toMatchObject({ clients: 1, client_domains: 1 });
    expect(plan.database.name).toBe("wren_client_gone_co");
    expect(await findClient(pg.db, "gone_co")).not.toBeNull();

    await removeClient(pg.db, "gone_co", "test");
    expect(await findClient(pg.db, "gone_co")).toBeNull();
    expect(
      await exists("select count(*)::int n from pg_database where datname = 'wren_client_gone_co'"),
    ).toBe(false);
    expect(
      await exists("select count(*)::int n from pg_roles where rolname = 'wren_client_gone_co'"),
    ).toBe(false);
    // an id that is a prefix of another's is untouched
    expect(await findClient(pg.db, "gone")).not.toBeNull();
    expect(
      await exists("select count(*)::int n from pg_database where datname = 'wren_client_gone'"),
    ).toBe(true);
  });
});
