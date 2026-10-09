/**
 * Access tokens for MCP on a real Postgres (`../../src/tokens.ts`): made once and kept as a hash,
 * read back as their person, pinned only where that person belongs, dead once removed or past
 * their end. Synthetic throughout.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accessTokens, addMember, addOperator, clients } from "../../src/clients/index.js";
import { consoleApi } from "../../src/console.js";
import type { PortalRefusal } from "../../src/portal.js";
import { checkToken, makeToken, TOKENS_MAX, tokenHash } from "../../src/tokens.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

beforeEach(async () => {
  await truncate(pg.db, ["access_tokens", "client_members", "operators", "clients"]);
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme", database: "wren_client_acme" },
    { id: "beta", name: "Beta", database: "wren_client_beta" },
  ]);
  await addOperator(pg.db, "ada@example.test");
  await addMember(pg.db, "acme", "owen@acme.test", { role: "owner" });
});

const api = () => consoleApi({ main: pg.db, views: [] });
const OWEN = { email: "owen@acme.test" };
const refused = async (p: Promise<unknown>, status: number) => {
  const err = (await p.catch((e: unknown) => e)) as PortalRefusal;
  expect(err.status).toBe(status);
};

describe("tokens", () => {
  it("shows the token once, keeps its hash, and reads it back as its person", async () => {
    const made = await makeToken(pg.db, "ada@example.test", { name: "Claude Code", days: 30 });
    expect(made.token).toMatch(/^wren_[A-Za-z0-9_-]{43}$/);
    expect(made.prefix).toBe(made.token.slice(0, 9));
    const [row] = await pg.db.select().from(accessTokens).where(eq(accessTokens.id, made.id));
    expect(row?.hash).toBe(tokenHash(made.token));
    expect(JSON.stringify(row)).not.toContain(made.token);
    expect(await checkToken(pg.db, made.token)).toEqual({
      email: "ada@example.test",
      operator: true,
      client: null,
    });
    const [used] = await pg.db.select().from(accessTokens).where(eq(accessTokens.id, made.id));
    expect(used?.lastUsedAt).not.toBeNull();
    expect(await checkToken(pg.db, `${made.token.slice(0, -1)}x`)).toBeNull();
    expect(await checkToken(pg.db, "not a token")).toBeNull();
  });

  it("a client login's token is pinned to its workspace; never another's", async () => {
    const made = (await api().tokenMake({
      viewer: OWEN,
      client: "acme",
      asClient: true,
      name: "Cursor",
    } as never)) as { token: string; client: string };
    expect(made.client).toBe("acme");
    expect(await checkToken(pg.db, made.token)).toMatchObject({ operator: false, client: "acme" });
    await refused(api().tokenMake({ viewer: OWEN, pin: "beta", name: "x" } as never), 403);
    await refused(api().tokenMake({ viewer: OWEN, name: " " } as never), 400);
    await refused(api().tokenMake({ viewer: OWEN, name: "x", days: 400 } as never), 400);
    await refused(api().tokenMake({ viewer: { demo: true }, name: "x" } as never), 403);
  });

  it("lists only the person's live tokens; removed or ended, a token is dead", async () => {
    const a = await makeToken(pg.db, "owen@acme.test", { name: "A" });
    const b = await makeToken(pg.db, "owen@acme.test", { name: "B" });
    await makeToken(pg.db, "ada@example.test", { name: "Ada's" });
    const list = (await api().tokens({ viewer: OWEN } as never)) as { name: string }[];
    expect(list.map((t) => t.name)).toEqual(["B", "A"]);
    expect(JSON.stringify(list)).not.toContain("hash");

    // Someone else's token can't be removed by id.
    await refused(
      api().tokenRevoke({ viewer: { email: "ada@example.test" }, id: a.id } as never),
      404,
    );
    await api().tokenRevoke({ viewer: OWEN, id: a.id } as never);
    expect(await checkToken(pg.db, a.token)).toBeNull();
    await refused(api().tokenRevoke({ viewer: OWEN, id: a.id } as never), 404);

    await pg.db.execute(
      sql`update access_tokens set expires_at = now() - interval '1 minute' where id = ${b.id}`,
    );
    expect(await checkToken(pg.db, b.token)).toBeNull();
  });

  it("caps a person's live tokens", async () => {
    for (let i = 0; i < TOKENS_MAX; i++)
      await makeToken(pg.db, "ada@example.test", { name: `t${i}` });
    await refused(makeToken(pg.db, "ada@example.test", { name: "one more" }), 409);
  });
});
