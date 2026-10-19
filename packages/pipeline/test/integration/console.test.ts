/**
 * PipelineConsole on a real Postgres: whose workspace a call reads and writes, what each role may
 * do, and that every change goes through the store (so a refusal reads as a portal refusal).
 * Synthetic data only.
 */
import { addClient, addMember, addOperator } from "@wren/core/clients";
import type { Viewer } from "@wren/core/portal";
import { resolveProfile } from "@wren/core/profiles";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pipelineConsoleApi } from "../../src/console.js";
import { PIPELINE_CONSOLE_APPS, PIPELINE_CONSOLE_ROUTES } from "../../src/console-routes.js";
import type { ShapeBody } from "../../src/model.js";
import { journeys } from "../../src/schema.js";
import { exportShape } from "../../src/shape-file.js";
import { shapeVersionsOf } from "../../src/store.js";
import { flow } from "../fixtures.js";

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

const shape: ShapeBody = {
  name: "Console shape",
  nodes: [
    { id: "manual", kind: "source", name: "Manual", via: "manual" },
    {
      id: "engaged",
      kind: "step",
      name: "Engaged",
      action: "reply",
      advance: [{ trigger: "trigger.reply" }],
    },
    {
      id: "signed",
      kind: "offer",
      name: "Signed",
      offer: "offer-a",
      advance: [{ trigger: "trigger.document" }],
    },
  ],
  edges: [flow("manual", "engaged"), flow("engaged", "signed")],
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
      "shapeDiff",
    ]);
    expect(names.filter((n) => PIPELINE_CONSOLE_ROUTES[n as never] === "act")).toEqual(
      expect.arrayContaining(["termsAdd", "shapeVersion", "shapeImport"]),
    );
    expect(PIPELINE_CONSOLE_APPS["*"]).toBe("deals");
  });
});

describe("the records", () => {
  it("lists the seven types for Wren's team and for a client's viewer", async () => {
    const ids = (r: { id: string }[]) => r.map((t) => t.id).sort();
    const want = [
      "pipeline.deal",
      "pipeline.entry",
      "pipeline.journey",
      "pipeline.number",
      "pipeline.offer",
      "pipeline.shape",
      "pipeline.terms",
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

describe("shape changes", () => {
  it("saves a version, reads two apart, and imports a file, as an operator", async () => {
    const op = as(ADA, undefined, true);
    expect(await api().shapeVersion({ ...op, note: "first", body: shape })).toEqual({ version: 1 });
    const grown = { ...shape, name: "Console shape 2" };
    expect(await api().shapeVersion({ ...op, note: "renamed", body: grown })).toEqual({
      version: 2,
    });
    const diff = await api().shapeDiff({ ...op, a: 1, b: 2 });
    expect(diff).toMatchObject({ a: 1, b: 2 });
    expect(diff.bodies.map((b) => b.name)).toEqual([shape.name, "Console shape 2"]);
    expect(JSON.stringify(diff.diff)).toMatch(/name/);
    const page = await api().recordsList({ ...op, record: "pipeline.shape", view: "all" });
    expect(page.rows.map((r) => [r.name, r.version])).toEqual([["Console shape 2", 2]]);
    const got = await api().recordsGet({
      ...op,
      record: "pipeline.shape",
      id: page.rows[0]?.id as string,
    });
    expect(got.detail).toMatchObject({
      body: { nodes: [{ id: "manual" }, { id: "engaged" }, { id: "signed" }] },
      depths: { manual: 0, engaged: 1, signed: 2 },
      versions: [{ number: 2 }, { number: 1 }],
    });
  });

  it("reads a shape file into the next version, and says when nothing changed", async () => {
    const op = as(ADA, undefined, true);
    const newest = (await shapeVersionsOf(pg.db)).at(-1);
    const text = exportShape(newest?.body as ShapeBody);
    expect(await api().shapeImport({ ...op, text })).toEqual({
      version: 2,
      changed: false,
      terms: [],
    });
    const edited = text.replace("Console shape 2", "Console shape 3");
    expect(await api().shapeImport({ ...op, text: edited, note: "from a file" })).toMatchObject({
      version: 3,
      changed: true,
    });
  });

  it("answers a store refusal as a portal refusal", async () => {
    const op = as(ADA, undefined, true);
    await expect(
      api().shapeVersion({ ...op, note: "x", body: { ...shape, edges: [] } }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(api().shapeVersion({ ...op, note: "x", body: { nodes: "x" } })).rejects.toThrow(
      /needs nodes/,
    );
    await expect(api().shapeDiff({ ...op, a: 1, b: 99 })).rejects.toThrow(/no shape version 99/);
    await expect(api().shapeImport({ ...op, text: "- not a shape" })).rejects.toBeTruthy();
  });

  it("refuses a viewer's change and keeps offers sync to Wren's workspace", async () => {
    await expect(
      api().shapeVersion({ ...as(VAL, "acme"), note: "x", body: shape }),
    ).rejects.toThrow(/can't do that/);
    await expect(api().offersSync(as(OWNER, "acme"))).rejects.toThrow(/Wren's workspace only/);
  });

  it("syncs the registry offers in Wren's workspace", async () => {
    const r = await api().offersSync(as(ADA, undefined, true));
    expect(r.added.length + r.unchanged).toBeGreaterThan(0);
  });
});

describe("the journeys board's reads", () => {
  const op = () => as(ADA, undefined, true);
  const person = async (email: string) =>
    ((await resolveProfile(pg.db, [{ kind: "email", value: email }], "test"))?.id as number) ?? 0;

  it("lists the open journeys with their node, and the done ones apart", async () => {
    const [a, b, c] = [
      await person("a@example.test"),
      await person("b@example.test"),
      await person("c@example.test"),
    ];
    const base = { version: 3, entry: "manual" };
    await pg.db.insert(journeys).values([
      { ...base, profileId: a, node: "engaged" },
      { ...base, profileId: b, node: "engaged" },
      { ...base, profileId: c, node: "signed", status: "done", closedAt: new Date() },
    ]);
    const open = await api().recordsList({
      ...op(),
      record: "pipeline.journey",
      view: "open",
      sort: "movedAt",
      limit: 200,
    });
    expect(open.rows).toHaveLength(2);
    expect(open.rows.map((r) => [r.node, r.nodeName, r.status])).toEqual([
      ["engaged", "Engaged", "open"],
      ["engaged", "Engaged", "open"],
    ]);
    const done = await api().recordsList({
      ...op(),
      record: "pipeline.journey",
      view: "done",
      limit: 20,
    });
    expect(done.rows.map((r) => r.node)).toEqual(["signed"]);
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

describe("terms", () => {
  const op = () => as(ADA, undefined, true);
  const REGISTERED = "offer-a";
  const body = {
    currency: "USD",
    setupCents: 12_300,
    monthlyCents: null,
    perUnitCents: null,
    unit: null,
    capCents: null,
    days: 30,
    payDays: 7,
  };

  it("adds the next version of a plan as the caller, through the store's checks", async () => {
    const { OFFERS } = await import("@wren/offers");
    const offer = OFFERS[0]?.id ?? REGISTERED;
    const first = await api().termsAdd({
      ...op(),
      offer,
      plan: "console-plan",
      from: "2020-01-01",
      body,
      why: "first",
    });
    expect(first).toEqual({ offer, plan: "console-plan", version: 1, from: "2020-01-01" });
    const second = await api().termsAdd({
      ...op(),
      offer,
      plan: "console-plan",
      from: "2020-02-01",
      body: { ...body, setupCents: 45_600 },
      why: "second",
    });
    expect(second.version).toBe(2);
    const page = await api().recordsList({
      ...op(),
      record: "pipeline.terms",
      view: "live",
      where: { plan: "console-plan" },
    });
    expect(page.rows.map((r) => [r.number, r.createdBy])).toEqual([[2, ADA]]);
  });

  it("refuses an unknown offer, a bad body, an earlier date, and a viewer or a client", async () => {
    const { OFFERS } = await import("@wren/offers");
    const offer = OFFERS[0]?.id ?? REGISTERED;
    const ask = { offer, plan: "console-plan", from: "2020-03-01", body, why: "w" };
    await expect(api().termsAdd({ ...op(), ...ask, offer: "nope" })).rejects.toMatchObject({
      status: 400,
    });
    await expect(api().termsAdd({ ...op(), ...ask, body: [] })).rejects.toThrow(/JSON object/);
    await expect(
      api().termsAdd({ ...op(), ...ask, body: { ...body, payDays: 500 } }),
    ).rejects.toThrow(/payDays/);
    await expect(api().termsAdd({ ...op(), ...ask, from: "2019-01-01" })).rejects.toThrow(
      /cannot start earlier/,
    );
    await expect(api().termsAdd({ ...as(VAL, "acme"), ...ask })).rejects.toThrow(/can't do that/);
    await expect(api().termsAdd({ ...as(OWNER, "acme"), ...ask })).rejects.toThrow(
      /Wren's workspace only/,
    );
  });
});
