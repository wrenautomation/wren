/**
 * The agent's risky acts on a real Postgres (`../../src/agent-gate.ts`): a person passes, an
 * admin's agent runs, anyone else's stops for a Yes that is used once; a No holds; the dial wins.
 * Synthetic people throughout.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AUTONOMY,
  autonomyOf,
  autonomySet,
  decideConfirm,
  gate,
  guardAutonomyChange,
  NeedsConfirm,
  setAutonomy,
} from "../../src/agent-gate.js";
import { clients } from "../../src/clients/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values({ id: "acme", name: "Acme", database: "wren_client_acme" });
  await pg.db.execute(sql`
    INSERT INTO operators (email, role) VALUES ('boss@example.test', 'admin'),
      ('op@example.test', 'operator')`);
}, 240_000);
afterAll(() => pg?.stop());

const OP = { actor: "claude-code:op@example.test", chat: "c1", turn: "t1" };
const send = (argv: string[]) => ({
  act: "send" as const,
  client: "acme",
  what: "wren crm approve 7",
  command: "crm approve",
  argv,
});
const stopped = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof NeedsConfirm ? e.id : `refused: ${(e as Error).message}`),
  );

describe("who passes", () => {
  it("lets a person and an admin's agent through, and a session outside the relay", async () => {
    await gate(pg.db, { actor: "william" }, send(["a"]));
    await gate(pg.db, { actor: "claude-code:boss@example.test" }, send(["a"]));
    await gate(pg.db, { actor: "claude-code" }, send(["a"]));
    expect(await autonomyOf(pg.db, OP.actor, "send", "acme")).toBe("approve");
  });
});

describe("ask first", () => {
  it("stops, keeps one card per command, and uses a Yes once", async () => {
    const id = await stopped(gate(pg.db, OP, send(["crm", "approve", "7"])));
    expect(id).toMatch(/^[\w-]{8}$/);
    expect(await stopped(gate(pg.db, OP, send(["crm", "approve", "7"])))).toBe(id);
    // the agent can't answer; nor can another non-admin
    await expect(
      decideConfirm(pg.db, { id: id ?? "", yes: true, by: OP.actor, admin: false }),
    ).rejects.toThrow(/its own ask/);
    await expect(
      decideConfirm(pg.db, { id: id ?? "", yes: true, by: "x@example.test", admin: false }),
    ).rejects.toThrow(/chat's person/);
    const yes = await decideConfirm(pg.db, {
      id: id ?? "",
      yes: true,
      by: "op@example.test",
      admin: false,
    });
    expect(yes.state).toBe("yes");
    expect(await stopped(gate(pg.db, OP, send(["crm", "approve", "7"])))).toBeNull();
    // used: the next run asks again
    const again = await stopped(gate(pg.db, OP, send(["crm", "approve", "7"])));
    expect(again).not.toBe(id);
    expect(again).not.toBeNull();
  });

  it("holds a No for that command", async () => {
    const id = await stopped(gate(pg.db, OP, send(["crm", "approve", "8"])));
    await decideConfirm(pg.db, { id: id ?? "", yes: false, by: "boss@example.test", admin: true });
    expect(await stopped(gate(pg.db, OP, send(["crm", "approve", "8"])))).toMatch(/said no/);
  });
});

describe("the dial", () => {
  it("wins over the default, both ways", async () => {
    await pg.db.execute(sql`
      UPDATE clients SET products = ${JSON.stringify({ [AUTONOMY]: { send: "off", spend: "auto" } })}::jsonb
      WHERE id = 'acme'`);
    expect(await stopped(gate(pg.db, OP, send(["x"])))).toMatch(/may not send/);
    expect(
      await stopped(gate(pg.db, { actor: "claude-code:boss@example.test" }, send(["x"]))),
    ).toMatch(/may not send/);
    expect(await autonomyOf(pg.db, OP.actor, "spend", "acme")).toBe("auto");
  });

  it("a person sets and clears one act; the rest stay; the agent can't", async () => {
    const was = await autonomySet(pg.db, "acme");
    expect(
      await setAutonomy(pg.db, "acme", { delete: "approve", send: null }, "boss@example.test"),
    ).toEqual({
      ...was,
      send: undefined,
      delete: "approve",
    } as object);
    expect(await autonomySet(pg.db, "acme")).toEqual({ spend: was.spend, delete: "approve" });
    await expect(
      setAutonomy(pg.db, "acme", { send: "auto" }, "claude-code:boss@example.test"),
    ).rejects.toThrow(/can't change its own autonomy/);
    await expect(
      setAutonomy(pg.db, "acme", { send: "yes" as never }, "boss@example.test"),
    ).rejects.toThrow(/level is/);
  });

  it("can't be moved by the agent", () => {
    expect(() => guardAutonomyChange("claude-code:boss@example.test", ["autonomy.send"])).toThrow();
    expect(() => guardAutonomyChange("claude-code", ["autonomy"])).toThrow();
    expect(() => guardAutonomyChange("william", ["autonomy.send"])).not.toThrow();
    expect(() => guardAutonomyChange("claude-code", ["research.depth"])).not.toThrow();
  });
});
