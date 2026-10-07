/**
 * Template install on Postgres (designs/2026-10-07-template-install.md): parts, copy, a draft and a
 * shut door in one go; twice changes nothing; a client's own settings and words stay; an update
 * needs asking; publish, approve, decline; uninstall keeps everything and a reinstall puts it back.
 * Synthetic parts, client and words only.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { clients } from "../../src/clients/schema.js";
import { defineComponent } from "../../src/components.js";
import { hooks, workflowInstalls, workflowSaves } from "../../src/schema.js";
import {
  approveInstall,
  askTemplate,
  declineInstall,
  installOf,
  installTemplate,
  readPlan,
  type Template,
  templatesOf,
  uninstallTemplate,
  waitingInstalls,
} from "../../src/template-install.js";
import { parseRef } from "../../src/templates.js";
import { defineWorkflow } from "../../src/workflows.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, [
    "clients",
    "workflow_installs",
    "workflow_saves",
    "hooks",
    "templates",
    "template_versions",
  ]);
  await pg.db.insert(clients).values({
    id: "demo",
    name: "Demo Co",
    database: "wren_client_demo",
    accounts: {},
    products: {},
  });
});

const hypothesis = { from: "a test", guesses: [{ is: "fixed" as const, says: "x" }] };
const base = {
  blurb: "x",
  icon: "mail",
  for: "client" as const,
  stage: "reach" as const,
  ready: true,
  hypothesis,
};
const forms = [{ id: "forms", label: "forms", kind: "lead" as const }];
const texts = defineComponent({
  ...base,
  id: "texts",
  name: "Texts",
  in: forms,
  requires: { accounts: ["telnyx"] },
  provides: { templates: ["sms:texts/hello#1"] },
});
const door = defineComponent({
  ...base,
  id: "door",
  name: "Door",
  inside: "flow",
  comesWith: "door",
  in: forms,
  effects: ["sends"],
  settings: z.object({ wait: z.number().optional() }).strict(),
  requires: { components: ["texts"] },
  clientLoops: (client) => [{ service: "DoorLoop", key: client }],
});
const COMPONENTS = [texts, door];
const flowOf = (wait: number) =>
  defineWorkflow({
    ...base,
    id: "flow",
    name: "Flow",
    in: forms,
    nodes: [{ id: "t", uses: "texts" }],
    wires: [{ from: "in.forms", to: "t.forms", via: "events" }],
    template: {
      parts: { texts: {}, door: { wait } },
      door: { input: "forms", subject: "phone" },
    },
  });
const WORKFLOWS = [flowOf(5)];
const [T] = templatesOf(WORKFLOWS, COMPONENTS) as [Template];
const FILES = [{ ref: parseRef("sms:texts/hello#1"), source: "Hi {first_name}.", hash: "h1" }];
const deps = { workflows: WORKFLOWS, components: COMPONENTS };
const ask = { client: "demo", by: "test", confirm: "DOOR", files: FILES };

const products = async () =>
  (await pg.db.select().from(clients).where(eq(clients.id, "demo")))[0]?.products;
const hook = async () => (await pg.db.select().from(hooks))[0];
const saves = () => pg.db.select().from(workflowSaves);
const words = async () =>
  (await pg.db.execute(
    sql`SELECT name, follows_default FROM templates ORDER BY name`,
  )) as unknown as { name: string; follows_default: boolean }[];

describe("installTemplate", () => {
  it("lands parts, copy, a draft and a shut door, even with an account missing; starts nothing", async () => {
    const plan = await readPlan(pg.db, pg.db, T, "demo", FILES);
    expect(plan.kind).toBe("new");
    expect(plan.parts.find((p) => p.id === "texts")?.accounts[0]?.site).toBe("telnyx");

    await expect(installTemplate(pg.db, pg.db, T, { ...ask, confirm: "x" })).rejects.toThrow(
      "type Door to confirm",
    );
    const out = await installTemplate(pg.db, pg.db, T, ask);
    expect(out.changed).toBe(true);
    expect(out.state).toBe("draft");
    expect(out.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await products()).toEqual({ texts: {}, door: { wait: 5 } });
    expect(await words()).toEqual([{ name: "hello#1", follows_default: true }]);
    expect((await saves()).map((s) => [s.live, s.edits])).toEqual([[false, null]]);
    expect(await hook()).toMatchObject({ open: false, client: "demo", input: "forms" });
    const row = await installOf(pg.db, "demo", "door");
    expect(row).toMatchObject({ state: "draft", version: T.version, workflow: "flow" });
    expect(row?.applied.added).toEqual(["texts", "door"]);
    expect(out.plan.kind).toBe("same");
  });

  it("changes nothing the second time", async () => {
    await installTemplate(pg.db, pg.db, T, ask);
    const at = (await installOf(pg.db, "demo", "door"))?.at;
    const again = await installTemplate(pg.db, pg.db, T, { ...ask, confirm: undefined });
    expect(again.changed).toBe(false);
    expect(again.token).toBeNull();
    expect((await installOf(pg.db, "demo", "door"))?.at).toEqual(at);
    expect(await saves()).toHaveLength(1);
    expect(await pg.db.select().from(hooks)).toHaveLength(1);
  });

  it("keeps a client's own settings and words through an update, which needs asking", async () => {
    await installTemplate(pg.db, pg.db, T, ask);
    await pg.db
      .update(clients)
      .set({ products: { texts: {}, door: { wait: 9 } } })
      .where(eq(clients.id, "demo"));
    await pg.db.execute(sql`UPDATE templates SET follows_default = false`);

    const moved = templatesOf([flowOf(6)], COMPONENTS)[0] as Template;
    const plan = await readPlan(pg.db, pg.db, moved, "demo", FILES);
    expect(plan.kind).toBe("update");
    expect(plan.parts.find((p) => p.id === "door")?.status).toBe("kept");
    await expect(installTemplate(pg.db, pg.db, moved, ask)).rejects.toThrow("install with update");
    await installTemplate(pg.db, pg.db, moved, { ...ask, update: true });
    expect(await products()).toEqual({ texts: {}, door: { wait: 9 } });
    expect(await words()).toEqual([{ name: "hello#1", follows_default: false }]);
    expect((await installOf(pg.db, "demo", "door"))?.version).toBe(moved.version);
  });

  it("updates a block still as the template wrote it", async () => {
    await installTemplate(pg.db, pg.db, T, ask);
    const moved = templatesOf([flowOf(6)], COMPONENTS)[0] as Template;
    await installTemplate(pg.db, pg.db, moved, { ...ask, update: true });
    expect(await products()).toEqual({ texts: {}, door: { wait: 6 } });
  });
});

describe("publish and approve", () => {
  it("waits in To approve; a yes makes the draft live, opens the door and starts its loops", async () => {
    await installTemplate(pg.db, pg.db, T, ask);
    const asked = await askTemplate(pg.db, T, { client: "demo", by: "test" });
    expect(asked.state).toBe("waiting");
    const waiting = await waitingInstalls(pg.db);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ clientName: "Demo Co", template: "door" });
    expect((await hook())?.open).toBe(false);

    const done = await approveInstall(pg.db, asked.id, { by: "admin", ...deps });
    expect(done.start).toEqual([{ service: "DoorLoop", key: "demo" }]);
    expect((await hook())?.open).toBe(true);
    expect((await saves()).map((s) => s.live)).toEqual([true]);
    expect(await installOf(pg.db, "demo", "door")).toMatchObject({
      state: "live",
      approvedBy: "admin",
    });
    await expect(approveInstall(pg.db, asked.id, { by: "admin", ...deps })).rejects.toThrow(
      "isn't waiting",
    );
  });

  it("live, asks again only for a draft; a no keeps it live", async () => {
    await installTemplate(pg.db, pg.db, T, ask);
    const first = await askTemplate(pg.db, T, { client: "demo", by: "test" });
    await approveInstall(pg.db, first.id, { by: "admin", ...deps });
    await expect(askTemplate(pg.db, T, { client: "demo", by: "test" })).rejects.toThrow(
      "change the draft",
    );
    await pg.db
      .insert(workflowSaves)
      .values({ client: "demo", workflow: "flow", edits: null, live: false, by: "test" });
    const again = await askTemplate(pg.db, T, { client: "demo", by: "test" });
    await declineInstall(pg.db, again.id, "admin");
    expect((await installOf(pg.db, "demo", "door"))?.state).toBe("live");
    expect((await hook())?.open).toBe(true);
  });

  it("a no sends it back to a draft with the door still shut", async () => {
    await installTemplate(pg.db, pg.db, T, ask);
    const asked = await askTemplate(pg.db, T, { client: "demo", by: "test" });
    await declineInstall(pg.db, asked.id, "admin");
    expect((await installOf(pg.db, "demo", "door"))?.state).toBe("draft");
    expect((await hook())?.open).toBe(false);
    expect(await waitingInstalls(pg.db)).toEqual([]);
  });
});

describe("uninstallTemplate", () => {
  it("takes its parts off and shuts the door, keeps data, words and saves; a reinstall puts them back", async () => {
    await installTemplate(pg.db, pg.db, T, ask);
    await pg.db
      .update(clients)
      .set({ products: { texts: {}, door: { wait: 7 } } })
      .where(eq(clients.id, "demo"));
    const asked = await askTemplate(pg.db, T, { client: "demo", by: "test" });
    await approveInstall(pg.db, asked.id, { by: "admin", ...deps });

    const out = await uninstallTemplate(pg.db, T, { client: "demo", by: "test" }, deps);
    expect(out.removed).toEqual(["door", "texts"]);
    expect(out.stop).toEqual([{ service: "DoorLoop", key: "demo" }]);
    expect(await products()).toEqual({});
    expect((await hook())?.open).toBe(false);
    expect(await words()).toHaveLength(1);
    expect(await saves()).toHaveLength(1);
    const row = await installOf(pg.db, "demo", "door");
    expect(row).toMatchObject({ state: "off", removedBy: "test" });
    expect(row?.applied.kept).toEqual({ texts: {}, door: { wait: 7 } });

    const plan = await readPlan(pg.db, pg.db, T, "demo", FILES);
    expect(plan.kind).toBe("back");
    const back = await installTemplate(pg.db, pg.db, T, ask);
    expect(back.state).toBe("draft");
    expect(back.token).toBeNull();
    expect(await products()).toEqual({ texts: {}, door: { wait: 7 } });
    expect(await pg.db.select().from(hooks)).toHaveLength(1);
    expect((await installOf(pg.db, "demo", "door"))?.removedAt).toBeNull();
  });

  it("leaves a part another template still uses", async () => {
    await installTemplate(pg.db, pg.db, T, ask);
    await pg.db.insert(workflowInstalls).values({
      client: "demo",
      template: "other",
      workflow: "other",
      version: "v",
      by: "test",
      applied: { added: [], blocks: {}, copy: [] },
    });
    const other = defineWorkflow({ ...flowOf(5), id: "other", template: { parts: { texts: {} } } });
    const out = await uninstallTemplate(
      pg.db,
      T,
      { client: "demo", by: "test" },
      { workflows: [...WORKFLOWS, other], components: COMPONENTS },
    );
    expect(out.removed).toEqual(["door"]);
    expect(out.kept).toEqual(["texts"]);
    expect(await products()).toEqual({ texts: {} });
  });
});
