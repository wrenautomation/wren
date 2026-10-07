/**
 * Triggers on a real Restate (designs/2026-10-06-workflow-editor.md, step 5): a reply and a
 * booking fired at the Spine enter each live node that hears them, never an uninstalled template's;
 * a Schedule node's clock ticks its slot in once, and a stale tick does nothing. A reply lets a
 * subject held at a Wait until a reply go by `out`; its most sends it by `timeout`, once.
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
  type SpineService,
  spineEmit,
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
  in: [{ id: "leads", label: "leads", kind: "lead" }],
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
    { id: "hold", uses: "logic.wait", with: { mode: "until", until: "reply", most: "3 days" } },
    merge("h", "lead"),
    merge("q", "lead"),
  ],
  wires: [
    { from: "in.leads", to: "hold.in", via: "events" },
    { from: "hold.out", to: "h.a", via: "events" },
    { from: "hold.timeout", to: "q.a", via: "events" },
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
    emit: async (ctx: restate.Context, req: { subjects: string[] }) =>
      spineEmit(ctx, {
        client: null,
        workflow: "trig",
        from: "in.leads",
        events: req.subjects.map((subject) => ({ subject, kind: "lead" as const, data: {} })),
      }),
    /** A wait's most, now: the delayed release the Spine sent itself. */
    release: async (ctx: restate.Context, req: { id: string }) =>
      ctx.serviceClient<SpineService>({ name: "Spine" }).release({ client: null, id: req.id }),
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

/** Who entered which node, once the walks land; a Wait's holds aside unless asked. */
async function arrivals(want: number, holds = false): Promise<string[]> {
  for (let i = 0; i < 100; i++) {
    const rows = (await pg.db.execute<{ at: string }>(
      sql`SELECT node || ' ' || subject AS at FROM events WHERE workflow = 'trig'
        AND (${holds} OR node <> 'hold') ORDER BY 1`,
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

  it("let a subject held until a reply go by out, else by timeout, once", async () => {
    await call().emit({ subjects: ["lead:sms:5", "lead:sms:6"] });
    expect(await arrivals(2, true)).toEqual(["hold lead:sms:5", "hold lead:sms:6"]);
    const held = (await pg.db.execute(sql`SELECT id::text, subject, until, about, due IS NOT NULL
      AS waiting FROM events WHERE node = 'hold' ORDER BY subject`)) as unknown as Array<{
      id: string;
      until: string;
      about: string;
      waiting: boolean;
    }>;
    expect(held.map((r) => [r.until, r.about, r.waiting])).toEqual([
      ["reply", "sms:5", true],
      ["reply", "sms:6", true],
    ]);
    // Lead 5 replies: it leaves the Wait by out (and the Reply trigger hears it too).
    await call().fire(replyFired(null, "sms", 5));
    expect(await arrivals(2)).toEqual(["h lead:sms:5", "r reply:sms:5"]);
    // Lead 6's most comes: it leaves by timeout. Its reply after that, and lead 5's most, do nothing.
    await call().release({ id: held[1]?.id as string });
    await call().release({ id: held[0]?.id as string });
    await call().fire(replyFired(null, "sms", 6));
    await new Promise((r) => setTimeout(r, 1500));
    expect(await arrivals(4)).toEqual([
      "h lead:sms:5",
      "q lead:sms:6",
      "r reply:sms:5",
      "r reply:sms:6",
    ]);
    const sent = (await pg.db.execute(sql`SELECT subject, sent->0->>'port' AS port FROM events
      WHERE node = 'hold' ORDER BY subject`)) as unknown as Array<{ port: string }>;
    expect(sent.map((r) => r.port)).toEqual(["out", "timeout"]);
  }, 60_000);
});
