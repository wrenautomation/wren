/**
 * Saved views and prefs on a real Postgres (`../../src/saved-views.ts`), through the console's
 * handlers: each viewer keeps his own, a shared view needs `manage` where it's shared, a client's
 * people see only their client's, the demo keeps nothing. Synthetic logins throughout.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addMember, addOperator, clients, operators } from "../../src/clients/index.js";
import { consoleApi } from "../../src/console.js";
import type { PortalRefusal } from "../../src/portal.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, ["saved_views", "viewer_prefs", "client_members", "operators", "clients"]);
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme", database: "wren_client_acme" },
    { id: "beta", name: "Beta", database: "wren_client_beta" },
  ]);
  await addOperator(pg.db, "ada@example.test");
  await addOperator(pg.db, "olly@example.test");
  await pg.db
    .update(operators)
    .set({ role: "operator" })
    .where(eq(operators.email, "olly@example.test"));
  await addMember(pg.db, "acme", "owen@acme.test", { role: "owner" });
  await addMember(pg.db, "acme", "vic@acme.test", { role: "viewer" });
});

const api = () => consoleApi({ main: pg.db, views: [] });
const ADMIN = { email: "ada@example.test", operator: true, team: { role: "admin", clients: null } };
const OPERATOR = {
  email: "olly@example.test",
  operator: true,
  team: { role: "operator", clients: null },
};
const OWNER = { email: "owen@acme.test" };
const VIEWER = { email: "vic@acme.test" };
const R = "test.lead";

const refused = async (p: Promise<unknown>, status: number) => {
  const err = (await p.catch((e: unknown) => e)) as PortalRefusal;
  expect(err.status).toBe(status);
};

describe("saved views", () => {
  it("keeps each viewer's own, shows shared ones to everyone, and sharing needs manage", async () => {
    const mine = await api().saveView({
      viewer: OPERATOR as never,
      record: R,
      name: "Open, newest",
      params: "state=open&sort=-at&after=abc&lead=12",
    });
    expect(mine).toMatchObject({ name: "Open, newest", shared: false, mine: true });
    // Paging never sticks to a view.
    expect(mine.params).toBe("state=open&sort=-at&lead=12");
    await refused(
      api().saveView({
        viewer: OPERATOR as never,
        record: R,
        name: "Team",
        params: "",
        shared: true,
      }),
      403,
    );
    const team = await api().saveView({
      viewer: ADMIN as never,
      record: R,
      name: "Team",
      params: "q=acme",
      shared: true,
    });
    expect(
      (await api().savedViews({ viewer: OPERATOR as never, record: R })).map((v) => v.name),
    ).toEqual(["Open, newest", "Team"]);
    expect(
      (await api().savedViews({ viewer: ADMIN as never, record: R })).map((v) => v.name),
    ).toEqual(["Team"]);
    // The operator can't rename or delete the shared one; the admin can.
    await refused(
      api().saveView({ viewer: OPERATOR as never, record: R, id: team.id, name: "x" }),
      403,
    );
    await refused(api().removeView({ viewer: OPERATOR as never, id: team.id }), 403);
    await refused(api().removeView({ viewer: ADMIN as never, id: mine.id }), 404);
    const moved = await api().moveViews({
      viewer: OPERATOR as never,
      record: R,
      ids: [team.id, mine.id],
    });
    // His order only: the admin still sees the shared one where it was.
    expect(moved.map((v) => v.name)).toEqual(["Team", "Open, newest"]);
    await api().removeView({ viewer: OPERATOR as never, id: mine.id });
    expect(await api().savedViews({ viewer: OPERATOR as never, record: R })).toHaveLength(1);
  });

  it("keeps a client's views to that client; its owner may share, its viewer may not", async () => {
    await api().saveView({
      viewer: OWNER as never,
      record: R,
      name: "Ours",
      params: "",
      shared: true,
    });
    await refused(
      api().saveView({
        viewer: VIEWER as never,
        record: R,
        name: "Mine",
        params: "",
        shared: true,
      }),
      403,
    );
    await api().saveView({ viewer: VIEWER as never, record: R, name: "Mine", params: "" });
    expect(
      (await api().savedViews({ viewer: VIEWER as never, record: R })).map((v) => v.name),
    ).toEqual(["Ours", "Mine"]);
    // The team in Wren's own apps sees none of the client's; at the client it sees the shared one.
    expect(await api().savedViews({ viewer: ADMIN as never, record: R })).toEqual([]);
    expect(
      (await api().savedViews({ viewer: ADMIN as never, client: "acme", record: R })).map(
        (v) => v.name,
      ),
    ).toEqual(["Ours"]);
    await refused(api().savedViews({ viewer: OWNER as never, client: "beta", record: R }), 403);
  });

  it("keeps prefs per viewer, resets with null, and the demo keeps nothing", async () => {
    await api().setPref({ viewer: OWNER as never, key: "list:test.lead", value: { cols: "a,b" } });
    await api().setPref({ viewer: OWNER as never, key: "rail", value: { pins: ["inbox"] } });
    expect(await api().prefs({ viewer: OWNER as never, keys: ["list:test.lead"] })).toEqual({
      "list:test.lead": { cols: "a,b" },
    });
    expect(await api().prefs({ viewer: VIEWER as never })).toEqual({});
    await api().setPref({ viewer: OWNER as never, key: "rail", value: null });
    expect(Object.keys(await api().prefs({ viewer: OWNER as never }))).toEqual(["list:test.lead"]);
    await refused(api().setPref({ viewer: OWNER as never, key: "bad key!", value: 1 }), 400);
    await refused(api().setPref({ viewer: { demo: true } as never, key: "rail", value: 1 }), 403);
    expect(await api().prefs({ viewer: { demo: true } as never })).toEqual({});
  });
});
