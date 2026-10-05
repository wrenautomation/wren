/** The spine's store on Postgres: an arrival is kept once, owned by its call; waits release once. */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { events, hooks } from "../../src/schema.js";
import { addHook, pgSpineStore } from "../../src/spine.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const a = {
  workflow: "top",
  node: "x.a",
  port: "leads",
  event: { subject: "lead:1", kind: "lead" as const, data: { cut: "half \uD83D" } },
};

describe("pgSpineStore", () => {
  it("keeps an arrival once, gives it back to the call that owns it, and records a failure", async () => {
    const store = pgSpineStore(pg.db);
    const id = await store.claim(a, "inv1");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await store.claim(a, "inv1")).toBe(id);
    expect(await store.claim(a, "inv2")).toBeNull();
    await store.fail(a, "the model is down");
    const [row] = await pg.db
      .select()
      .from(events)
      .where(eq(events.id, id as string));
    expect(row).toMatchObject({ by: "inv1", error: "the model is down", data: { cut: "half " } });
  });

  it("releases a waiting arrival to one call, and again to that call only", async () => {
    const store = pgSpineStore(pg.db);
    const w = { ...a, node: "out", port: "replied" };
    const id = (await store.claim(w, "inv1", new Date(Date.now() + 60_000))) as string;
    expect(await store.release(id, "inv2")).toEqual({
      ...w,
      event: { ...w.event, data: { cut: "half " } },
    });
    expect(await store.release(id, "inv2")).not.toBeNull();
    expect(await store.release(id, "inv3")).toBeNull();
    expect(await store.claim(w, "inv2")).toBe(id);
  });
});

describe("addHook", () => {
  it("keeps only the token's hash", async () => {
    const token = await addHook(pg.db, {
      name: "test form",
      client: null,
      workflow: "top",
      input: "leads",
      subject: "email",
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await pg.db.select().from(hooks);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token);
  });
});
