/**
 * Roles and grants on the migrated schema (designs/2026-10-06-scoped-access.md, phase 1): the
 * built-ins are seeded rows, a custom role's grants and a login's extras are read fresh, an ended
 * or used-up grant drops out, a one-use grant can't be used twice, and nobody hands out more than
 * they hold. Synthetic people and clients only.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILT_IN_ROLES, can, WREN } from "../../src/access.js";
import {
  addClient,
  addMember,
  addOperator,
  grants,
  operators,
  roles,
  setTeamSeat,
} from "../../src/clients/index.js";
import {
  addGrant,
  endGrant,
  grantsFor,
  removeRole,
  roleFits,
  rolesIn,
  saveRole,
  spendGrant,
} from "../../src/grants.js";
import { portalMe, whoIs } from "../../src/portal.js";

let pg: TestPostgres;
const ADMIN = "ada@example.test";
const EDITOR = "yuri@example.test";
const OWNER = "owen@acme.test";
const LEAD = "lee@acme.test";

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme" });
  await addClient(pg.db, pg.url, { id: "beta", name: "Beta" });
  await addOperator(pg.db, ADMIN);
  await addMember(pg.db, "acme", OWNER, { role: "owner" });
  await addMember(pg.db, "acme", LEAD, { role: "viewer" });
});
afterAll(() => pg?.stop());

const admin = () => whoIs(pg.db, { email: ADMIN });

describe("the built-ins are rows", () => {
  it("seeds every built-in, so seats and memberships name a row", async () => {
    const ids = (await pg.db.select({ id: roles.id }).from(roles)).map((r) => r.id).sort();
    expect(ids).toEqual(expect.arrayContaining(BUILT_IN_ROLES.map((r) => r.id)));
    await expect(
      pg.db.update(operators).set({ role: "nope" }).where(eq(operators.email, ADMIN)),
    ).rejects.toThrow();
  });

  it("lists each side's built-ins as one grant", async () => {
    const team = await rolesIn(pg.db, WREN);
    expect(team.map((r) => r.id)).toEqual(["admin", "operator", "viewer"]);
    const acme = await rolesIn(pg.db, "acme");
    expect(acme.map((r) => r.id)).toEqual(["owner", "member", "viewer"]);
  });
});

describe("a custom role at Wren: the YouTube editor", () => {
  let role = "";
  it("is made by an admin and held by a seat", async () => {
    ({ id: role } = await pg.db.transaction(async (tx) =>
      saveRole(tx, await admin(), ADMIN, {
        client: WREN,
        name: "YouTube editor",
        grants: [
          { verbs: ["read", "act", "comment"], apps: ["marketing"], channels: ["youtube"] },
          { verbs: ["read", "comment"], apps: ["marketing", "outbound"] },
        ],
      }),
    ));
    expect(role).toBe("wren.youtube-editor");
    expect(await roleFits(pg.db, role, WREN)).toBe(true);
    expect(await roleFits(pg.db, role, "acme")).toBe(false);
    await setTeamSeat(pg.db, EDITOR, { role, clients: [WREN] });
  });

  it("is read fresh with the seat", async () => {
    const who = await whoIs(pg.db, { email: EDITOR });
    expect(who).toMatchObject({ team: role, clients: [WREN] });
    const at = (channel: string | null) => ({ client: WREN, app: "marketing", channel });
    expect(can(who, "act", at("youtube"))).toBe(true);
    expect(can(who, "act", at("linkedin"))).toBe(false);
    expect(can(who, "comment", at("linkedin"))).toBe(true);
    expect(can(who, "read", { client: WREN, app: "money", channel: null })).toBe(false);
  });

  it("covers LinkedIn until a time, then drops out by itself", async () => {
    const soon = new Date(Date.now() + 60_000).toISOString();
    const { id } = await addGrant(pg.db, await admin(), ADMIN, {
      email: EDITOR,
      client: WREN,
      verbs: ["act"],
      channels: ["linkedin"],
      until: soon,
      reason: "covering this week",
    });
    const who = await whoIs(pg.db, { email: EDITOR });
    expect(can(who, "act", { client: WREN, app: "marketing", channel: "linkedin" })).toBe(true);
    await pg.db
      .update(grants)
      .set({ until: new Date(Date.now() - 1000) })
      .where(eq(grants.id, id));
    const later = await whoIs(pg.db, { email: EDITOR });
    expect(can(later, "act", { client: WREN, app: "marketing", channel: "linkedin" })).toBe(false);
  });

  it("can't be removed while held", async () => {
    await expect(pg.db.transaction((tx) => removeRole(tx, WREN, role))).rejects.toThrow(
      "someone holds this role",
    );
  });

  it("portalMe sends its grants", async () => {
    const me = await portalMe(
      pg.db,
      { email: EDITOR, operator: true, team: { role, clients: [WREN] } },
      "Demo",
    );
    expect(me.team?.role).toBe(role);
    expect(me.team?.wren).toEqual(["read", "act", "comment"]);
    expect(me.team?.grants?.map((g) => g.role)).toEqual([role, role]);
  });
});

describe("one record, one use", () => {
  it("is spent once, and a second use is refused", async () => {
    const owner = await whoIs(pg.db, { email: OWNER }, "acme");
    const record = "delivery.update:812";
    await addGrant(pg.db, owner, OWNER, {
      email: LEAD,
      client: "acme",
      verbs: ["act"],
      record,
      usesLeft: 1,
    });
    const lead = await whoIs(pg.db, { email: LEAD }, "acme");
    const at = { client: "acme", app: "work", channel: null, record };
    expect(can(lead, "act", at)).toBe(true);
    expect(can(lead, "act", { ...at, record: "delivery.update:813" })).toBe(false);
    // Both uses start from the same fresh read; the second finds nothing left.
    expect(await pg.db.transaction((tx) => spendGrant(tx, lead, "act", at))).toEqual(
      expect.any(Number),
    );
    await expect(pg.db.transaction((tx) => spendGrant(tx, lead, "act", at))).rejects.toThrow(
      "that grant is used up",
    );
    expect(can(await whoIs(pg.db, { email: LEAD }, "acme"), "act", at)).toBe(false);
  });

  it("a built-in role has nothing to spend", async () => {
    const owner = await whoIs(pg.db, { email: OWNER }, "acme");
    expect(await spendGrant(pg.db, owner, "act", { client: "acme", record: "x.y:1" })).toBeNull();
  });
});

describe("handing out", () => {
  it("refuses a grant above the granter's own", async () => {
    const owner = await whoIs(pg.db, { email: OWNER }, "acme");
    await expect(
      addGrant(pg.db, owner, OWNER, { email: LEAD, client: "acme", verbs: ["run"] }),
    ).rejects.toThrow("you can't run there yourself");
    await expect(
      addGrant(pg.db, owner, OWNER, { email: LEAD, client: "beta", verbs: ["read"] }),
    ).rejects.toThrow("you don't manage that");
  });

  it("refuses someone who can't sign in there", async () => {
    await expect(
      addGrant(pg.db, await admin(), ADMIN, {
        email: "stranger@example.test",
        client: "acme",
        verbs: ["read"],
      }),
    ).rejects.toThrow("they aren't one of this client's people");
  });

  it("keeps the last who manages a client from ending it on themselves", async () => {
    // A client whose only manager holds it by grant.
    await addMember(pg.db, "beta", "solo@beta.test", { role: "viewer" });
    const [{ id } = { id: 0 }] = await pg.db
      .insert(grants)
      .values({ email: "solo@beta.test", client: "beta", verbs: ["read", "manage"], by: ADMIN })
      .returning({ id: grants.id });
    const solo = await whoIs(pg.db, { email: "solo@beta.test" }, "beta");
    await expect(endGrant(pg.db, solo, "solo@beta.test", id)).rejects.toThrow("you're the last");
    // An admin may end it.
    expect(await endGrant(pg.db, await admin(), ADMIN, id)).toEqual({ ended: id });
    expect(await grantsFor(pg.db, "solo@beta.test", "viewer", "beta")).toEqual([]);
    const [row] = await pg.db.execute<{ ended: boolean }>(
      sql`select until <= now() ended from grants where id = ${id}`,
    );
    expect(row?.ended).toBe(true);
  });
});
