/**
 * Triggers on a real Restate (designs/2026-10-06-workflow-editor.md, step 5): a reply and a
 * booking fired at the Spine enter each live node that hears them, never an uninstalled template's;
 * a Schedule node's clock ticks its slot in once, and a stale tick does nothing.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clients as clientRows } from "../../src/clients/schema.js";
import { workflowInstalls, workflowSaves } from "../../src/schema.js";
import {
  clockKey,
  type Fired,
  makeSpine,
  makeSpineClock,
  replyFired,
  type SpineClock,
  spineFire,
} from "../../src/spine.js";
import { startTestRestate } from "../../src/testing.js";
import { defineWorkflow, type WorkflowEdits } from "../../src/workflows.js";

const FLOW = defineWorkflow({
  id: "trig",
  name: "Triggers",
  blurb: "Triggers only.",
  icon: "clock",
  for: "wren",
  stage: "follow",
  in: [],
  out: [],
  nodes: [],
  wires: [],
});

const merge = (id: string, kind: string) => ({ id, uses: "logic.merge", with: { kind } });
const EDITS: WorkflowEdits = {
  steps: [
    { id: "texts", uses: "trigger.reply", with: { channel: "sms" } },
    { id: "booked", uses: "trigger.booking", with: { on: "booked" } },
    { id: "hourly", uses: "trigger.schedule", with: { every: "hours", hours: 1 } },
    merge("r", "reply"),
    merge("c", "call"),
    merge("t", "item"),
  ],
  wires: [
    { from: "texts.out", to: "r.a", via: "events" },
    { from: "booked.out", to: "c.a", via: "events" },
    { from: "hourly.out", to: "t.a", via: "events" },
  ],
};

/** A public door for the test: the Spine and its clocks take private calls only. */
const probe = restate.service({
  name: "Probe",
  handlers: {
    fire: async (ctx: restate.Context, req: Fired) => spineFire(ctx, req),
    tick: async (ctx: restate.Context, req: { key: string; slot?: string }) => {
      const clock = ctx.objectClient<SpineClock>({ name: "SpineClock" }, req.key);
      const { next } = await clock.start();
      await clock.tick({ slot: req.slot ?? (next as string) });
      return { next };
    },
  },
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
const ingress = () => clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
const call = () => ingress().serviceClient<typeof probe>({ name: "Probe" });

beforeAll(async () => {
  pg = await startTestPostgres();
  const deps = { main: pg.db, workflows: [FLOW], components: [] };
  env = await startTestRestate({
    services: [
      makeSpine({ ...deps, clientDb: () => pg.db, steps: {}, rule: async () => false }),
      makeSpineClock(deps),
      probe,
    ],
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, ["events", "workflow_saves", "workflow_installs", "clients"]);
  await pg.db
    .insert(workflowSaves)
    .values({ client: null, workflow: FLOW.id, edits: EDITS, live: true, by: "op@example.test" });
});

/** Who entered which node, once the walks land. */
async function arrivals(want: number): Promise<string[]> {
  for (let i = 0; i < 100; i++) {
    const rows = (await pg.db.execute<{ at: string }>(
      sql`SELECT node || ' ' || subject AS at FROM events WHERE workflow = 'trig' ORDER BY 1`,
    )) as unknown as { at: string }[];
    if (rows.length >= want) return rows.map((r) => r.at);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`fewer than ${want} arrivals`);
}

describe("triggers on the spine", () => {
  it("send a reply and a booking to the nodes that hear them", async () => {
    await call().fire(replyFired(null, "sms", 5));
    // Email isn't heard here: the node hears texts.
    await call().fire(replyFired(null, "email", 6));
    await call().fire({
      client: null,
      facts: { trigger: "trigger.booking", change: "booked" },
      event: { subject: "call:9", kind: "call", data: { call: 9 } },
    });
    expect(await arrivals(2)).toEqual(["c call:9", "r reply:sms:5"]);
  }, 60_000);

  it("a template's workflow hears only while its install is live", async () => {
    await pg.db.insert(clientRows).values({
      id: "acme",
      name: "Acme Test",
      database: "wren_client_acme",
      accounts: {},
      products: {},
    });
    await pg.db.insert(workflowSaves).values({
      client: "acme",
      workflow: FLOW.id,
      edits: EDITS,
      live: true,
      by: "op@example.test",
    });
    await pg.db.insert(workflowInstalls).values({
      client: "acme",
      template: FLOW.id,
      workflow: FLOW.id,
      version: "v",
      state: "off",
      by: "test",
      applied: { added: [], blocks: {}, copy: [] },
    });
    // Uninstalled: the reply enters nothing.
    await call().fire(replyFired("acme", "sms", 7));
    await new Promise((r) => setTimeout(r, 1500));
    await pg.db
      .update(workflowInstalls)
      .set({ state: "live" })
      .where(eq(workflowInstalls.client, "acme"));
    await call().fire(replyFired("acme", "sms", 8));
    expect(await arrivals(1)).toEqual(["r reply:sms:8"]);
  }, 60_000);

  it("tick a Schedule slot in once; a stale slot does nothing", async () => {
    const key = clockKey(null, "trig", "hourly");
    const { next } = await call().tick({ key });
    expect(next).toMatch(/:00:00\.000Z$/);
    expect(await arrivals(1)).toEqual([`t item:schedule:hourly@${next}`]);
    // The same slot again enters nothing new; a slot the clock doesn't keep does nothing.
    await call().tick({ key, slot: next as string });
    await call().tick({ key, slot: "2020-01-01T00:00:00.000Z" });
    await new Promise((r) => setTimeout(r, 1000));
    expect(await arrivals(1)).toHaveLength(1);
  }, 60_000);
});
