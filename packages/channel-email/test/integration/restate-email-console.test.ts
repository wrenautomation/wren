/**
 * EmailConsole against Postgres and a Restate test environment: approve and drop reach
 * `Disposition/fleet` (a stand-in here; `invite.test.ts` covers the real one), pause and resume
 * write the same rows as the CLI, logged as the operator. Anyone but Wren's team is refused
 * before anything moves.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { loadSettings } from "@wren/config";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activePauses } from "../../src/inbox/health.js";
import { makeEmailConsole } from "../../src/restate/console.js";
import { SendPolicy } from "../../src/send/policy.js";

const FLEET = ["ann@one.example", "bob@one.example", "cat@two.example"];
const operator = { viewer: { email: "op@example.test", operator: true } };
const outsiders = [
  { viewer: { email: "amy@acme.test" } },
  { viewer: { demo: true as const } },
  { ...operator, asClient: true },
];

const asked: { handler: string; key: string; req: unknown }[] = [];
const disposition = restate.object({
  name: "Disposition",
  handlers: {
    approve: async (ctx: restate.ObjectContext, req: { id: number; body: string | null }) => {
      asked.push({ handler: "approve", key: ctx.key, req });
      return req.id === 2
        ? { ok: false, state: "needs_you", reason: "Tue 10am is no longer open" }
        : { ok: true, state: "sent", said: null, reply: { sent: true } };
    },
    drop: async (ctx: restate.ObjectContext, req: { id: number }) => {
      asked.push({ handler: "drop", key: ctx.key, req });
      return { state: "dropped" };
    },
  },
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await RestateTestEnvironment.start({
    services: [
      disposition,
      makeEmailConsole({
        db: pg.db,
        senders: FLEET,
        policy: SendPolicy.fromSettings(loadSettings({ WREN_DATABASE_URL: "postgresql://x" })),
      }),
    ],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  asked.length = 0;
  await truncate(pg.db, ["sender_pauses"]);
});

type EmailConsole = ReturnType<typeof makeEmailConsole>;
const email = () =>
  clients.connect({ url: env.baseUrl() }).serviceClient<EmailConsole>({ name: "EmailConsole" });

describe("EmailConsole", () => {
  it("refuses anyone but Wren's team, before anything moves", async () => {
    for (const who of outsiders) {
      await expect(email().answers(who)).rejects.toThrow("that's for Wren's team");
      await expect(email().approve({ ...who, id: 1 })).rejects.toThrow("that's for Wren's team");
      await expect(email().drop({ ...who, id: 1 })).rejects.toThrow("that's for Wren's team");
      await expect(
        email().pause({ ...who, target: FLEET[0] as string, reason: "test" }),
      ).rejects.toThrow("that's for Wren's team");
      await expect(email().resume({ ...who, target: "one.example" })).rejects.toThrow(
        "that's for Wren's team",
      );
      await expect(email().killSwitchOff({ ...who, ids: ["any"] })).rejects.toThrow(
        "that's for Wren's team",
      );
      await expect(
        email().setCampaign({ ...who, campaign: "any", openersPerDay: 0 }),
      ).rejects.toThrow("that's for Wren's team");
    }
    expect(asked).toEqual([]);
    expect((await activePauses(pg.db)).size).toBe(0);
  });

  it("campaign controls answer through Restate: unknown campaigns skip or 404", async () => {
    expect(await email().stopOpeners({ ...operator, ids: ["none_yet"] })).toEqual({
      done: [],
      skipped: ["none_yet"],
    });
    await expect(
      email().setCampaign({ ...operator, campaign: "none_yet", killSwitch: false }),
    ).rejects.toThrow("no such campaign");
  });

  it("lists what waits", async () => {
    expect(await email().answers(operator)).toEqual([]);
  });

  it("approve and drop go to Disposition/fleet; a refused approve reads as its reason", async () => {
    await email().approve({ ...operator, id: 1, body: "  Tuesday works.  " });
    await email().approve({ ...operator, id: 3 });
    await expect(email().approve({ ...operator, id: 2 })).rejects.toThrow("no longer open");
    expect(await email().drop({ ...operator, id: 4 })).toEqual({ state: "dropped" });
    await expect(email().drop({ ...operator, id: 0 })).rejects.toThrow("no such reply");
    expect(asked).toEqual([
      { handler: "approve", key: "fleet", req: { id: 1, body: "Tuesday works." } },
      { handler: "approve", key: "fleet", req: { id: 3, body: null } },
      { handler: "approve", key: "fleet", req: { id: 2, body: null } },
      { handler: "drop", key: "fleet", req: { id: 4 } },
    ]);
  });

  it("pause asks why and names a roster inbox; resume lifts it; both logged as the operator", async () => {
    await expect(email().pause({ ...operator, target: "ann@one.example" })).rejects.toThrow(
      "say why",
    );
    await expect(
      email().pause({ ...operator, target: "zed@nowhere.example", reason: "test" }),
    ).rejects.toThrow("no inbox on the roster");

    expect(await email().pause({ ...operator, target: "one.example", reason: "bounces" })).toEqual({
      paused: ["ann@one.example", "bob@one.example"],
    });
    const paused = await activePauses(pg.db);
    expect([...paused.keys()].sort()).toEqual(["ann@one.example", "bob@one.example"]);
    expect(paused.get("ann@one.example")).toMatchObject({
      reason: "bounces",
      source: "operator",
      detail: { by: "console:op@example.test" },
    });

    expect(await email().resume({ ...operator, target: "bob@one.example" })).toEqual({
      resumed: ["bob@one.example"],
    });
    expect([...(await activePauses(pg.db)).keys()]).toEqual(["ann@one.example"]);

    const actors = (await pg.db.execute(
      sql`select distinct op, actor from audit_events
          where table_name = 'sender_pauses' and op <> 'truncate' order by op`,
    )) as unknown as { op: string; actor: string | null }[];
    expect(actors).toEqual([
      { op: "insert", actor: "op@example.test" },
      { op: "update", actor: "op@example.test" },
    ]);
  });
});
