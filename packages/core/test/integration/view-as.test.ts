/**
 * View as (designs/2026-10-14-view-as.md): Look reads only, Act writes under the person's role
 * with the real operator in the audit log, nobody but Wren's team views as anyone, a role with
 * nobody in it can be viewed, and the sandbox is made once, wiped on demand and never sends.
 * Synthetic people and clients only.
 */
import { actingAs, atomic, setAuditActor } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WREN } from "../../src/access.js";
import {
  addClient,
  addMember,
  addOperator,
  findClient,
  setTeamSeat,
  updateClient,
} from "../../src/clients/index.js";
import { saveRole } from "../../src/grants.js";
import {
  guard,
  PortalRefusal,
  type PortalRequest,
  portalMe,
  type SignedViewer,
  whoIs,
} from "../../src/portal.js";
import { SANDBOX, viewAsApi } from "../../src/view-as.js";

let pg: TestPostgres;
const ADMIN = "ada@example.test";
const OPS = "otto@example.test";
/** An operator with no seat fence: Wren's own apps are open to them. */
const OPEN = "opal@example.test";
const OWNER = "owen@acme.test";
const MEMBER = "mia@acme.test";
const OTHER = "oli@other.test";
let custom = "";

const refused = async (p: Promise<unknown>, status: number, words?: string) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(PortalRefusal);
  expect((err as PortalRefusal).status).toBe(status);
  if (words) expect((err as Error).message).toContain(words);
};
/** A client route's guard, as `email`, viewing as `viewAs`. */
const at = (email: string, viewAs: unknown, need = "read", client = "acme") =>
  guard(pg.db, need as never, { viewer: { email }, client, viewAs } as PortalRequest, "first");
const viewer = (r: PortalRequest) => r.viewer as SignedViewer;

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme" });
  await addClient(pg.db, pg.url, { id: "other", name: "Other" });
  await addOperator(pg.db, ADMIN);
  await setTeamSeat(pg.db, OPS, { role: "operator", clients: ["acme"] });
  await setTeamSeat(pg.db, OPEN, { role: "operator", clients: null });
  await addMember(pg.db, "acme", OWNER, { role: "owner" });
  await addMember(pg.db, "acme", MEMBER, { role: "member" });
  await addMember(pg.db, "other", OTHER, { role: "owner" });
  custom = (
    await saveRole(pg.db, await whoIs(pg.db, { email: ADMIN }, "acme"), ADMIN, {
      client: "acme",
      name: "Front desk",
      grants: [{ verbs: ["read"] }],
    })
  ).id;
});
afterAll(() => pg?.stop());

describe("Look", () => {
  it("opens on the client's owner, reading only", async () => {
    const r = await at(ADMIN, { client: "acme" });
    expect(viewer(r).email).toBe(OWNER);
    expect(viewer(r).operator).toBeUndefined();
    expect(viewer(r).as).toMatchObject({ by: ADMIN, client: "acme", act: false, role: "owner" });
  });

  it("refuses every write", async () => {
    await refused(at(ADMIN, { client: "acme", email: MEMBER }, "act"), 403, "Look reads only");
    await refused(at(ADMIN, { client: "acme", email: MEMBER, act: false }, "manage"), 403);
  });

  it("is one client at a time", async () => {
    await refused(at(ADMIN, { client: "acme" }, "read", "other"), 403, "one client");
  });

  it("shows what the person sees: their client alone, their role", async () => {
    const r = await at(ADMIN, { client: "acme", email: MEMBER });
    const me = await portalMe(pg.db, r.viewer, "Demo", false);
    expect(me.clients.map((c) => c.id)).toEqual(["acme"]);
    expect(me.operator).toBe(false);
    expect(me.team).toBeUndefined();
    expect(me.as).toMatchObject({ client: "acme", name: "Acme", who: MEMBER, act: false });
  });
});

describe("Act", () => {
  it("writes under the person's role, not the operator's", async () => {
    const r = await at(ADMIN, { client: "acme", email: OWNER, act: true }, "manage");
    expect(viewer(r).email).toBe(OWNER);
    expect(viewer(r).as?.label).toBe(`${OWNER} at acme`);
    // A member has no `manage`: Act can't do more than they could.
    await refused(at(ADMIN, { client: "acme", email: MEMBER, act: true }, "manage"), 403);
  });

  it("is an admin's", async () => {
    await expect(at(OPS, { client: "acme", email: MEMBER })).resolves.toBeTruthy();
    await refused(at(OPS, { client: "acme", email: MEMBER, act: true }, "act"), 403, "admin");
  });

  it("logs the operator as the actor and whom as", async () => {
    await actingAs({ actor: ADMIN, as: `${OWNER} at acme` }, () =>
      atomic(pg.db, async (tx) => {
        await setAuditActor(tx, OWNER);
        await updateClient(tx, "acme", { name: "Acme Co" });
      }),
    );
    const last = async () =>
      (
        await pg.db.execute<{ actor: string; as: string | null }>(sql`
          select actor, acting_as "as" from audit_events where table_name = 'clients'
          order by id desc limit 1`)
      )[0];
    expect(await last()).toEqual({ actor: ADMIN, as: `${OWNER} at acme` });
    const [shown] = await pg.db.execute<{ as: string | null }>(sql`
      select "as" from audit_changes where "table" = 'clients' and "as" is not null limit 1`);
    expect(shown?.as).toBe(`${OWNER} at acme`);
    // Outside View as, no `as`.
    await atomic(pg.db, async (tx) => {
      await setAuditActor(tx, ADMIN);
      await updateClient(tx, "acme", { name: "Acme" });
    });
    expect(await last()).toEqual({ actor: ADMIN, as: null });
  });
});

describe("who may", () => {
  it("is Wren's team only", async () => {
    await refused(at(OWNER, { client: "acme", email: MEMBER }), 403, "Wren's team");
    await refused(at(MEMBER, { client: "acme" }), 403, "Wren's team");
  });

  it("stays inside an operator's seat", async () => {
    await refused(at(OPS, { client: "other" }, "read", "other"), 403, "one of yours");
  });

  it("refuses a bad shape, someone not there, a client not there", async () => {
    await refused(at(ADMIN, "mia@acme.test"), 400);
    await refused(at(ADMIN, { client: "acme", email: OTHER }), 404);
    await refused(at(ADMIN, { client: "nope" }, "read", "nope"), 404);
  });

  it("lets an admin view as a teammate", async () => {
    const r = await guard(
      pg.db,
      "wren:read" as never,
      { viewer: { email: ADMIN }, viewAs: { client: WREN, email: OPEN } } as PortalRequest,
      "wren",
    );
    expect(viewer(r)).toMatchObject({ email: OPEN, operator: true, team: { role: "operator" } });
  });
});

describe("a role with nobody in it", () => {
  it("is viewed as someone new, with that role's grants", async () => {
    const r = await at(ADMIN, { client: "acme", role: "member" });
    expect(viewer(r).email).toBe("new.member@view-as.invalid");
    expect(viewer(r).as?.who).toBe("someone new as member");
    const c = await at(ADMIN, { client: "acme", role: custom });
    expect(viewer(c).access).toMatchObject({ member: custom, client: "acme" });
  });

  it("takes only that client's roles, and Acts only in the sandbox", async () => {
    await refused(at(ADMIN, { client: "other", role: custom }, "read", "other"), 400);
    await refused(at(ADMIN, { client: "acme", role: "owner", act: true }, "act"), 403, "sandbox");
  });
});

describe("the sandbox", () => {
  const api = () => viewAsApi({ main: pg.db, mainUrl: pg.url });
  const team = (email: string, need = "wren:manage") =>
    guard(pg.db, need as never, { viewer: { email } } as PortalRequest, "wren");

  it("is made once, by an admin", async () => {
    await refused(api().sandboxMake(await team(OPEN, "wren:read")), 403, "admin");
    const made = await api().sandboxMake(await team(ADMIN));
    expect(made).toEqual({ id: SANDBOX, name: "New client" });
    expect(await api().sandboxMake(await team(ADMIN))).toEqual(made);
    expect((await findClient(pg.db, SANDBOX))?.sandbox).toBe(true);
  });

  it("never sends, never spends", async () => {
    await expect(updateClient(pg.db, SANDBOX, { sends: ["email"] })).rejects.toThrow();
    await expect(updateClient(pg.db, SANDBOX, { buysOk: true })).rejects.toThrow();
    const r = await at(ADMIN, { client: SANDBOX, act: true }, "act", SANDBOX);
    expect(viewer(r).as).toMatchObject({ who: "someone new as owner", sandbox: true, act: true });
    await refused(at(ADMIN, { client: SANDBOX, act: true }, "effect", SANDBOX), 403);
  });

  it("starts over blank", async () => {
    await addMember(pg.db, SANDBOX, "sam@sandbox.test", { role: "member" });
    const r = await api().sandboxReset(await team(ADMIN));
    expect(r).toMatchObject({ id: SANDBOX, stop: [] });
    const [n] = await pg.db.execute<{ n: number }>(
      sql`select count(*)::int n from client_members where client_id = ${SANDBOX}`,
    );
    expect(n?.n).toBe(0);
    expect((await findClient(pg.db, SANDBOX))?.sandbox).toBe(true);
  });

  it("lists in the picker, with each client's people and roles", async () => {
    const list = await api().viewAsList(await team(ADMIN, "wren:read"));
    const acme = list.clients.find((c) => c.id === "acme");
    expect(acme?.people.map((p) => p.email).sort()).toEqual([MEMBER, OWNER]);
    expect(acme?.roles.map((x) => x.id)).toEqual(expect.arrayContaining(["owner", custom]));
    expect(list.clients.find((c) => c.id === SANDBOX)?.kind).toBe("sandbox");
    expect(list).toMatchObject({ sandbox: true, act: true });
    expect(list.team?.people.map((p) => p.email)).toEqual([OPEN, OPS]);
    // An operator's list holds the clients its seat reaches.
    const seated = await guard(
      pg.db,
      "read",
      { viewer: { email: OPS }, client: "acme" } as PortalRequest,
      "first",
    );
    const ops = await api().viewAsList(seated);
    expect(ops.clients.map((c) => c.id)).toEqual(["acme"]);
    expect(ops.team).toBeUndefined();
  });
});
