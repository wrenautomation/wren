/** The spine's store on Postgres: an arrival is kept once, owned by its call; waits release once. */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineComponent } from "../../src/components.js";
import { consoleApi } from "../../src/console.js";
import type { PortalRequest } from "../../src/portal.js";
import { events, hooks, workflowSaves } from "../../src/schema.js";
import { addHook, pgSpineStore, savedWorkflows } from "../../src/spine.js";
import { defineWorkflow } from "../../src/workflows.js";

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

describe("workflow saves", () => {
  const hypothesis = { from: "a test", guesses: [{ is: "fixed" as const, says: "x" }] };
  const part = defineComponent({
    id: "a",
    name: "A",
    blurb: "a",
    icon: "mail",
    for: "client",
    stage: "reach",
    ready: true,
    hypothesis,
    inside: null,
    in: [{ id: "leads", label: "leads", kind: "lead" }],
    out: [{ id: "replied", label: "replies", kind: "reply" }],
  });
  const flow = defineWorkflow({
    id: "f",
    name: "F",
    blurb: "f",
    icon: "mail",
    for: "wren",
    stage: "reach",
    in: [{ id: "leads", label: "leads", kind: "lead" }],
    out: [{ id: "replied", label: "replies", kind: "reply" }],
    nodes: [{ id: "n", uses: "a" }],
    wires: [
      { from: "in.leads", to: "n.leads", via: "code" },
      { from: "n.replied", to: "out.replied", via: "events" },
    ],
  });
  const operator = { viewer: { email: "op@example.test", operator: true } } as PortalRequest;
  it("checks a save, keeps every version, and draws the newest", async () => {
    const api = consoleApi({ main: pg.db, views: [], components: [part], workflows: [flow] });
    const wait = { from: "n.replied", to: "out.replied", via: "events", wait: "2 days" };
    await expect(
      api.workflowSave({ ...operator, workflow: "f", wires: [], steps: [] }),
    ).rejects.toThrow("f: out.replied gets nothing");
    await expect(
      api.workflowSave({ ...operator, workflow: "nope", wires: [], steps: [] }),
    ).rejects.toThrow("no such workflow");
    await expect(
      api.workflowSave({ viewer: { email: "x@client.example" }, workflow: "f" } as never),
    ).rejects.toThrow("that's for Wren's team");
    await api.workflowSave({
      ...operator,
      workflow: "f",
      wires: [{ ...wait, label: "replies" }],
      steps: [],
    });
    expect((await savedWorkflows(pg.db, null)).f).toMatchObject({
      edits: { wires: [wait], steps: [] },
      by: "op@example.test",
    });
    const got = await api.recordsGet({ ...operator, record: "console.component", id: "f" });
    const detail = got.detail as { workflow: { wires: unknown[] }; broken: string[] };
    expect(detail.workflow.wires).toMatchObject([flow.wires[0], wait]);
    expect(detail.broken).toEqual([]);

    await api.workflowSave({ ...operator, workflow: "f", reset: true });
    expect((await savedWorkflows(pg.db, null)).f?.edits).toBeNull();
    expect(await savedWorkflows(pg.db, "someone")).toEqual({});
    expect(await pg.db.select().from(workflowSaves)).toHaveLength(2);
  });
});
