/**
 * The access guard through Restate (designs/2026-10-05-access.md, A2): each refusal the doc names,
 * on the console's real routes, with roles read fresh from the database.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addClient,
  addMember,
  addOperator,
  operators,
  removeOperator,
} from "../../src/clients/index.js";
import { makeConsolePortal } from "../../src/console.js";
import { defineRecord, text } from "../../src/records.js";
import { startTestRestate } from "../../src/testing.js";

type Console = ReturnType<typeof makeConsolePortal>;
const as = (email: string) => ({ viewer: { email } });
const ADMIN = as("ada@example.test");
const OPERATOR = as("olly@example.test");
const SCOPED = as("sam@example.test");
const TEAM_VIEWER = as("tess@example.test");
const OWNER = as("owen@acme.test");
const MEMBER_VIEWER = as("vic@acme.test");

/** A Money record: only `money` at Wren opens it. */
const spend = defineRecord({
  id: "books.test_spend",
  app: "work",
  channel: null,
  needs: "money",
  name: { one: "spend", many: "spend" },
  rows: async () => [{ id: "1", label: "hosting" }],
  key: "id",
  title: "label",
  fields: { label: text() },
  views: [{ id: "all", label: "All" }],
});
/** One public handler that sends: an effect. */
const SERVICES = {
  services: [
    { name: "Mailer", ty: "Service", handlers: [{ name: "send", metadata: { effect: "sends" } }] },
  ],
};

let pg: TestPostgres;
let env: RestateTestEnvironment;
const portal = () =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .serviceClient<Console>({ name: "ConsolePortal" });

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme" });
  await addClient(pg.db, pg.url, { id: "beta", name: "Beta" });
  await addMember(pg.db, "acme", OWNER.viewer.email, { role: "owner" });
  await addMember(pg.db, "acme", MEMBER_VIEWER.viewer.email, { role: "viewer" });
  for (const v of [ADMIN, OPERATOR, SCOPED, TEAM_VIEWER]) await addOperator(pg.db, v.viewer.email);
  const set = (v: { viewer: { email: string } }, row: object) =>
    pg.db.update(operators).set(row).where(eq(operators.email, v.viewer.email));
  await set(OPERATOR, { role: "operator" });
  await set(SCOPED, { role: "operator", clients: ["beta"] });
  await set(TEAM_VIEWER, { role: "viewer" });
  env = await startTestRestate({
    services: [
      makeConsolePortal({
        main: pg.db,
        mainUrl: pg.url,
        views: [],
        moneyViews: ["books_test_view"],
        records: [spend],
        adminGet: async () => SERVICES,
      }),
    ],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

describe("access, read fresh per call", () => {
  it("a client viewer reads but is refused a write", async () => {
    const types = await portal().recordsTypes({ ...MEMBER_VIEWER, client: "acme" });
    expect(types.map((t) => t.id)).toEqual(["console.component"]);
    await expect(portal().setLook({ ...MEMBER_VIEWER, look: "slate" })).rejects.toThrow(
      "your role can't do that",
    );
    // The owner of the same client may.
    expect(await portal().setLook({ ...OWNER, look: "slate" })).toMatchObject({ client: "acme" });
  });

  it("a scoped operator can't open another client, or Wren's own apps", async () => {
    const record = "console.component";
    expect((await portal().recordsList({ ...SCOPED, client: "beta", record })).rows.length).toBe(0);
    await expect(portal().recordsList({ ...SCOPED, client: "acme", record })).rejects.toThrow(
      "no access",
    );
    await expect(portal().loops(SCOPED)).rejects.toThrow("no access");
    // Naming its own client doesn't open Wren's records.
    const types = await portal().recordsTypes({ ...SCOPED, client: "beta" });
    expect(types.map((t) => t.id)).not.toContain(spend.id);
  });

  it("a team viewer can't call a handler; an operator can't call one with an effect", async () => {
    const send = { service: "Mailer", handler: "send", confirm: "send", input: {} };
    await expect(portal().call({ ...TEAM_VIEWER, ...send })).rejects.toThrow(
      "your role can't do that",
    );
    await expect(portal().call({ ...OPERATOR, ...send })).rejects.toThrow(
      "it sends: your role can't do that",
    );
  });

  it("an operator can't open Money; an admin can", async () => {
    const ids = async (v: { viewer: { email: string } }) =>
      (await portal().recordsTypes(v)).map((t) => t.id);
    expect(await ids(OPERATOR)).not.toContain(spend.id);
    expect(await ids(ADMIN)).toContain(spend.id);
    await expect(portal().recordsList({ ...OPERATOR, record: spend.id })).rejects.toThrow();
    expect((await portal().recordsList({ ...ADMIN, record: spend.id })).rows).toHaveLength(1);
    await expect(portal().view({ ...OPERATOR, view: "books_test_view" })).rejects.toThrow(
      "your role can't see that",
    );
  });

  it("removal refuses the next call", async () => {
    expect(await portal().recordsTypes(OPERATOR)).not.toHaveLength(0);
    await removeOperator(pg.db, OPERATOR.viewer.email);
    await expect(portal().recordsTypes(OPERATOR)).rejects.toThrow("no access");
  });
});

describe("the Team page", () => {
  const NEW = "nina@example.test";
  const signedIn = async (email: string) => {
    await pg.db.execute(sql`insert into auth."user" (id, name, email) values (${email}, 'x', ${email})
      on conflict do nothing`);
    await pg.db.execute(sql`insert into auth.session (id, token, user_id, expires_at)
      values (${`s-${email}`}, ${`t-${email}`}, ${email}, now() + interval '1 day')
      on conflict do nothing`);
  };
  const sessions = async (email: string) =>
    (await pg.db.execute(sql`select 1 from auth.session where user_id = ${email}`)).length;

  it("only an admin sees it and changes it", async () => {
    const ids = async (v: { viewer: { email: string } }) =>
      (await portal().recordsTypes(v)).map((t) => t.id);
    expect(await ids(ADMIN)).toContain("console.team");
    expect(await ids(TEAM_VIEWER)).not.toContain("console.team");
    await expect(portal().teamSet({ ...TEAM_VIEWER, email: NEW })).rejects.toThrow(
      "your role can't do that",
    );
    await expect(portal().teamSet({ ...OWNER, email: NEW })).rejects.toThrow();
    const rows = (await portal().recordsList({ ...ADMIN, record: "console.team" })).rows;
    expect(rows.map((r) => r.email)).toContain(ADMIN.viewer.email);
  });

  it("invites, scopes and removes, signing the person out when they lose access", async () => {
    expect(await portal().teamSet({ ...ADMIN, email: NEW, role: "viewer", clients: "" })).toEqual({
      email: NEW,
      role: "viewer",
      clients: null,
    });
    await signedIn(NEW);
    // Wider keeps the session; narrower ends it.
    await portal().teamSet({ ...ADMIN, email: NEW, role: "operator" });
    expect(await sessions(NEW)).toBe(1);
    await expect(portal().teamSet({ ...ADMIN, email: NEW, clients: "acme, nope" })).rejects.toThrow(
      "no such client: nope",
    );
    expect(await portal().teamSet({ ...ADMIN, email: NEW, clients: "acme, wren" })).toMatchObject({
      clients: ["acme", "wren"],
    });
    expect(await sessions(NEW)).toBe(0);
    await signedIn(NEW);
    expect(await portal().teamRemove({ ...ADMIN, email: NEW })).toEqual({ removed: NEW });
    expect(await sessions(NEW)).toBe(0);
    await expect(portal().recordsTypes(as(NEW))).rejects.toThrow("no access");
  });

  it("shows an admin who changed what, as a field diff; nobody else", async () => {
    expect((await portal().recordsTypes(TEAM_VIEWER)).map((t) => t.id)).not.toContain(
      "console.change",
    );
    const list = await portal().recordsList({ ...ADMIN, record: "console.change", view: "people" });
    const role = list.rows.find(
      (r) => r.table === "operators" && /^role: \w+ → \w+$/.test(String(r.change)),
    );
    expect(role).toMatchObject({ who: ADMIN.viewer.email, madeBy: "person", op: "update" });
    expect(list.totals).not.toHaveProperty("change");
  });

  it("keeps the last admin", async () => {
    await expect(
      portal().teamSet({ ...ADMIN, email: ADMIN.viewer.email, role: "viewer" }),
    ).rejects.toThrow("the last admin stays");
    await expect(portal().teamRemove({ ...ADMIN, email: ADMIN.viewer.email })).rejects.toThrow(
      "the last admin stays",
    );
  });
});
