/**
 * PipelineConsole on a real Postgres: whose workspace a call reads and writes, what each role may
 * do, and that every change goes through the store (so a refusal reads as a portal refusal).
 * Synthetic data only.
 */
import { addClient, addMember, addOperator } from "@wren/core/clients";
import type { Viewer } from "@wren/core/portal";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pipelineConsoleApi } from "../../src/console.js";
import { PIPELINE_CONSOLE_APPS, PIPELINE_CONSOLE_ROUTES } from "../../src/console-routes.js";
import type { FunnelBody } from "../../src/model.js";

let pg: TestPostgres;
const OWNER = "owner@acme.example.test";
const VAL = "val@acme.example.test";
const ADA = "ada@example.test";
const as = (email: string, client?: string, operator = false) => ({
  viewer: { email, ...(operator ? { operator: true } : {}) } as Viewer,
  ...(client ? { client } : {}),
});
// A client's database is the test database too: access is what these tests check.
const api = () => pipelineConsoleApi({ db: pg.db, open: () => pg.db });

const funnel: FunnelBody = {
  name: "Console funnel",
  offer: "offer-a",
  stages: [
    { key: "engaged", label: "Engaged", on: [{ trigger: "trigger.reply" }] },
    { key: "signed", label: "Signed", sale: true, on: [{ trigger: "trigger.document" }] },
  ],
  entries: [],
};

beforeAll(async () => {
  pg = await startTestPostgres({ own: true });
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme Plumbing", products: {} });
  await addMember(pg.db, "acme", OWNER, { role: "owner" });
  await addMember(pg.db, "acme", VAL, { role: "viewer" });
  await addOperator(pg.db, ADA);
});
afterAll(() => pg.stop());

describe("routes", () => {
  it("lists every handler once, reads and writes apart", () => {
    const names = Object.keys(PIPELINE_CONSOLE_ROUTES);
    expect(names.filter((n) => PIPELINE_CONSOLE_ROUTES[n as never] === "read")).toEqual([
      "recordsTypes",
      "recordsList",
      "recordsGet",
      "recordsExport",
      "recordsStats",
    ]);
    expect(PIPELINE_CONSOLE_APPS["*"]).toBe("deals");
  });
});

describe("the records", () => {
  it("lists the five types for Wren's team and for a client's viewer", async () => {
    const ids = (r: { id: string }[]) => r.map((t) => t.id).sort();
    const want = [
      "pipeline.deal",
      "pipeline.funnel",
      "pipeline.journey",
      "pipeline.number",
      "pipeline.offer",
    ];
    expect(ids(await api().recordsTypes(as(ADA, undefined, true)))).toEqual(want);
    expect(ids(await api().recordsTypes(as(VAL, "acme")))).toEqual(want);
  });

  it("reads a list in the workspace asked", async () => {
    const page = await api().recordsList({
      ...as(VAL, "acme"),
      record: "pipeline.journey",
      view: "all",
    });
    expect(page.rows).toEqual([]);
  });
});

describe("funnel changes", () => {
  it("adds a funnel, appends a version, turns it off and on, as an operator", async () => {
    const op = as(ADA, undefined, true);
    expect(await api().funnelsAdd({ ...op, id: "c-one", body: funnel })).toEqual({
      funnel: "c-one",
      version: 1,
    });
    expect(
      await api().funnelsAppend({
        ...op,
        id: "c-one",
        body: { ...funnel, name: "Console funnel 2" },
      }),
    ).toEqual({ funnel: "c-one", version: 2 });
    expect(await api().funnelsStatus({ ...op, id: "c-one" }, "off")).toEqual({
      funnel: "c-one",
      status: "off",
    });
    expect(await api().funnelsStatus({ ...op, id: "c-one" }, "live")).toEqual({
      funnel: "c-one",
      status: "live",
    });
    const page = await api().recordsList({ ...op, record: "pipeline.funnel", view: "live" });
    expect(page.rows.map((r) => r.id)).toContain("c-one");
  });

  it("answers a store refusal as a portal refusal", async () => {
    const op = as(ADA, undefined, true);
    await expect(api().funnelsAdd({ ...op, id: "c-one", body: funnel })).rejects.toMatchObject({
      status: 400,
    });
    await expect(api().funnelsAdd({ ...op, id: "c-bad", body: { stages: "x" } })).rejects.toThrow(
      /stages/,
    );
  });

  it("refuses a viewer's change and keeps offers sync to Wren's workspace", async () => {
    await expect(api().funnelsAdd({ ...as(VAL, "acme"), id: "c-v", body: funnel })).rejects.toThrow(
      /can't do that/,
    );
    await expect(api().offersSync(as(OWNER, "acme"))).rejects.toThrow(/Wren's workspace only/);
  });

  it("syncs the registry offers in Wren's workspace", async () => {
    const r = await api().offersSync(as(ADA, undefined, true));
    expect(r.added.length + r.unchanged).toBeGreaterThan(0);
  });
});

describe("deals", () => {
  it("refuses a sign for a deal that is not there, and a plan it cannot find", async () => {
    await expect(
      api().dealsSign({ ...as(ADA, undefined, true), deal: "nope", plan: "standard" }),
    ).rejects.toThrow(/No deal nope/);
    await expect(
      api().dealsSign({
        ...as(ADA, undefined, true),
        deal: "00000000-0000-4000-8000-000000000000",
        plan: "standard",
      }),
    ).rejects.toThrow(/No deal/);
  });
});
