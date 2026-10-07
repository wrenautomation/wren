/**
 * Flags on a real Postgres (`../../src/flag-store.ts`): the team adds, edits and removes them
 * through the console, rules are checked as words, a site flag's change pushes the whole site
 * set to the edge, and `me` carries each login's portal variants. Synthetic logins throughout.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addMember, addOperator, clients, operators } from "../../src/clients/index.js";
import { consoleApi } from "../../src/console.js";
import { editRecord } from "../../src/edits.js";
import { flagRecord, flagsFor, siteEdge } from "../../src/flag-store.js";
import type { FlagDef } from "../../src/flags.js";
import { type PortalRefusal, portalMe } from "../../src/portal.js";
import { flags } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

let pushed: FlagDef[][] = [];
const edge = async (all: readonly FlagDef[]) => {
  pushed.push([...all]);
};
beforeEach(async () => {
  pushed = [];
  await truncate(pg.db, ["flags", "changes", "client_members", "operators", "clients"]);
  await pg.db.insert(clients).values({ id: "acme", name: "Acme", database: "wren_client_acme" });
  await addOperator(pg.db, "ada@example.test");
  await addOperator(pg.db, "otto@example.test");
  await pg.db
    .update(operators)
    .set({ role: "operator" })
    .where(eq(operators.email, "otto@example.test"));
  await addMember(pg.db, "acme", "owen@acme.test", { role: "owner" });
});

const api = () => consoleApi({ main: pg.db, views: [], edge });
const ADMIN = { email: "ada@example.test", operator: true, team: { role: "admin", clients: null } };
const OPERATOR = {
  email: "otto@example.test",
  operator: true,
  team: { role: "operator", clients: null },
};
const OWNER = { email: "owen@acme.test" };
const refused = async (p: Promise<unknown>, status: number) => {
  const err = (await p.catch((e: unknown) => e)) as PortalRefusal;
  expect(err.status).toBe(status);
};
const card = flagRecord(edge);
const by = "ada@example.test";

describe("flags", () => {
  it("adds, edits rules as words, and refuses what doesn't parse", async () => {
    await api().flagAdd({ viewer: ADMIN as never, key: "voice", about: "the voice app" });
    await refused(api().flagAdd({ viewer: ADMIN as never, key: "voice" }), 409);
    await refused(api().flagAdd({ viewer: ADMIN as never, key: "Bad Key" }), 400);
    await refused(api().flagAdd({ viewer: ADMIN as never, key: "x", variants: "on,on" }), 400);
    await refused(api().flagAdd({ viewer: OPERATOR as never, key: "y" }), 403);
    expect(pushed).toEqual([]);

    await editRecord(pg.db, card, "voice", {
      patch: { rules: "on: roles operator\non: clients acme; people owen@acme.test" },
      by,
    });
    await refused(editRecord(pg.db, card, "voice", { patch: { rules: "maybe: 5%" }, by }), 400);
    await refused(editRecord(pg.db, card, "voice", { patch: { fallback: "maybe" }, by }), 400);

    const team = await portalMe(pg.db, OPERATOR as never, "Demo");
    expect(team.team?.flags).toEqual({ voice: "on" });
    const admin = await portalMe(pg.db, ADMIN as never, "Demo");
    expect(admin.team?.flags).toEqual({ voice: "off" });
    const owner = await portalMe(pg.db, OWNER as never, "Demo");
    expect(owner.clients[0]?.flags).toEqual({ voice: "on" });

    await editRecord(pg.db, card, "voice", { patch: { state: "killed" }, by });
    expect(
      await flagsFor(pg.db, { id: null, roles: ["team", "operator"], client: null, person: null }),
    ).toEqual({ voice: "off" });
    // Portal flags never reach the edge.
    expect(pushed).toEqual([]);
  });

  it("pushes the site set on every site change, and stops when the last one goes", async () => {
    await api().flagAdd({ viewer: ADMIN as never, key: "voice" });
    await api().flagAdd({
      viewer: ADMIN as never,
      key: "hero",
      surface: "site",
      variants: "a, b",
    });
    expect(pushed.at(-1)?.map((f) => f.key)).toEqual(["hero"]);
    await editRecord(pg.db, card, "hero", { patch: { rules: "b: 50%" }, by });
    expect(pushed.at(-1)?.[0]).toMatchObject({
      key: "hero",
      rules: [{ variant: "b", percent: 50 }],
    });
    // A portal flag moved to both is pushed; the site never sees `surface`.
    await editRecord(pg.db, card, "voice", { patch: { surface: "both" }, by });
    expect(pushed.at(-1)?.map((f) => f.key)).toEqual(["hero", "voice"]);
    expect(pushed.at(-1)?.[0]).not.toHaveProperty("surface");
    // The site's flags stay out of `me`.
    expect((await portalMe(pg.db, ADMIN as never, "Demo")).team?.flags).toEqual({ voice: "off" });

    const n = pushed.length;
    await api().flagRemove({ viewer: ADMIN as never, ids: ["hero", "voice"] });
    expect(pushed.length).toBe(n + 1);
    expect(pushed.at(-1)).toEqual([]);
  });

  it("a failed push never fails the change, and siteEdge posts with the token", async () => {
    const calls: { url: string; auth: string | null; body: unknown }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({
        url,
        auth: new Headers(init.headers).get("authorization"),
        body: JSON.parse(String(init.body)),
      });
      return new Response("no", { status: 503 });
    }) as unknown as typeof fetch;
    const down = siteEdge("https://site.example/", "tok-test", fetcher);
    await consoleApi({ main: pg.db, views: [], edge: down }).flagAdd({
      viewer: ADMIN as never,
      key: "hero",
      surface: "site",
    });
    expect(calls).toEqual([
      {
        url: "https://site.example/api/edge",
        auth: "Bearer tok-test",
        body: { flags: [expect.objectContaining({ key: "hero", fallback: "off" })], surveys: [] },
      },
    ]);
    expect(await pg.db.select({ key: flags.key }).from(flags)).toEqual([{ key: "hero" }]);
  });
});
