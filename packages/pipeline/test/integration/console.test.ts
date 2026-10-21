/**
 * PipelineConsole on a real Postgres: whose workspace a call reads and writes, what each role may
 * do, and that every change goes through the store (so a refusal reads as a portal refusal).
 * Synthetic data only.
 */
import { readFileSync } from "node:fs";
import { addClient, addMember, addOperator } from "@wren/core/clients";
import { saveCustomField, setFieldStep } from "@wren/core/custom-fields";
import type { Viewer } from "@wren/core/portal";
import { resolveProfile } from "@wren/core/profiles";
import { events } from "@wren/core/schema";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pipelineConsoleApi } from "../../src/console.js";
import {
  PIPELINE_CONSOLE_APPS,
  PIPELINE_CONSOLE_ROUTES,
  PIPELINE_CONSOLE_WRITES,
} from "../../src/console-routes.js";
import type { ShapeBody } from "../../src/model.js";
import { assignJourney } from "../../src/moves.js";
import { journeys } from "../../src/schema.js";
import { exportShape } from "../../src/shape-file.js";
import { Refused, shapeVersionsOf } from "../../src/store.js";
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
      "shapeExport",
      "shapePreview",
      "shapeBlame",
      "shapeUndoPreview",
    ]);
    expect(names.filter((n) => PIPELINE_CONSOLE_ROUTES[n as never] === "act")).toEqual(
      expect.arrayContaining([
        "termsAdd",
        "shapeVersion",
        "shapeImport",
        "shapeStart",
        "shapeDraftNew",
        "shapeDraftUpdate",
        "shapeDraftPropose",
        "shapeDraftApply",
        "shapeDraftDrop",
        "shapeUndo",
        "shapeTag",
      ]),
    );
    // Every act is a write: never cached, never on the demo.
    const acts = names.filter((n) => PIPELINE_CONSOLE_ROUTES[n as never] === "act").sort();
    expect([...PIPELINE_CONSOLE_WRITES].sort()).toEqual(acts);
    expect(PIPELINE_CONSOLE_APPS["*"]).toBe("deals");
  });
});

describe("the records", () => {
  it("lists the eight types for Wren's team and for a client's viewer", async () => {
    const ids = (r: { id: string }[]) => r.map((t) => t.id).sort();
    const want = [
      "pipeline.deal",
      "pipeline.entry",
      "pipeline.journey",
      "pipeline.number",
      "pipeline.offer",
      "pipeline.shape",
      "pipeline.shape_draft",
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
    expect(diff.views?.map((v) => v.name)).toEqual([shape.name, "Console shape 2"]);
    expect(diff.changes.map((c) => c.key)).toEqual(["name"]);
    expect(diff.marks?.name).toEqual({ from: shape.name, to: "Console shape 2" });
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

  it("writes a body as a file and compares a file with the newest version", async () => {
    const op = as(ADA, undefined, true);
    const newest = (await shapeVersionsOf(pg.db)).at(-1);
    const { text } = await api().shapeExport({ ...op, ref: newest?.number as number });
    expect(text).toBe(exportShape(newest?.body as ShapeBody));
    expect((await api().shapeExport(op)).text).toBe(text);
    const same = await api().shapePreview({ ...op, text });
    expect(same).toMatchObject({ a: newest?.number, note: null, changes: [] });
    const edited = text.replace("name: Engaged", "name: Replied");
    const changed = await api().shapePreview({ ...op, text: edited });
    expect(changed.changes.map((c) => c.key)).toEqual(["node:engaged:renamed"]);
    expect(changed.views?.[1].stations.find((s) => s.id === "engaged")?.label).toBe("Replied");
    await expect(api().shapePreview({ ...op, text: "- not a shape" })).rejects.toMatchObject({
      status: 400,
    });
    // A preview saves nothing.
    expect((await shapeVersionsOf(pg.db)).length).toBe(newest?.number);
  });

  it("starts from the starter only in a workspace with no shape", async () => {
    const op = as(ADA, undefined, true);
    await expect(api().shapeStart(op)).rejects.toThrow(/already has a shape/);
    await expect(api().shapeStart(as(VAL, "acme"))).rejects.toThrow(/can't do that/);
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

describe("who works a journey", () => {
  const op = () => as(ADA, undefined, true);
  const NEO = "neo@acme.example.test";
  const profileOf = async (email: string) =>
    (await resolveProfile(pg.db, [{ kind: "email", value: email }], "test"))?.id as number;
  const journeyFor = async (email: string, owner: string | null = null) => {
    const [j] = await pg.db
      .insert(journeys)
      .values({
        profileId: await profileOf(email),
        version: 3,
        node: "engaged",
        entry: "manual",
        owner,
      })
      .returning();
    return j?.id as string;
  };
  const ownerOf = async (id: string) =>
    (await pg.db.select({ o: journeys.owner }).from(journeys).where(eq(journeys.id, id)))[0]?.o;

  it("gives a journey to a team member, in the form the Mine view reads, and clears it", async () => {
    const id = await journeyFor("own1@example.test");
    expect(await assignJourney(pg.db, pg.db, { journey: id, to: "  Ada@Example.Test " })).toEqual({
      journey: id,
      owner: ADA,
    });
    expect(await ownerOf(id)).toBe(ADA);
    await assignJourney(pg.db, pg.db, { journey: id, to: null });
    expect(await ownerOf(id)).toBeNull();
  });

  it("takes a client's member in that client's workspace only", async () => {
    const id = await journeyFor("own2@example.test");
    await addMember(pg.db, "acme", NEO, { role: "member" });
    await assignJourney(pg.db, pg.db, { client: "acme", journey: id, to: NEO });
    expect(await ownerOf(id)).toBe(NEO);
    // Wren's operators work any client's journeys; a client's member does not work Wren's.
    await assignJourney(pg.db, pg.db, { client: "acme", journey: id, to: ADA });
    await expect(assignJourney(pg.db, pg.db, { journey: id, to: NEO })).rejects.toThrow(
      /not on the team here/,
    );
  });

  it("refuses a stranger, a name, and a journey that is not there", async () => {
    const id = await journeyFor("own3@example.test");
    const refusal = (p: Promise<unknown>) =>
      p.then(
        () => [] as string[],
        (e: unknown) => (e instanceof Refused ? e.errors : [String(e)]),
      );
    expect(
      await refusal(assignJourney(pg.db, pg.db, { journey: id, to: "x@nowhere.test" })),
    ).toEqual(["x@nowhere.test is not on the team here."]);
    expect(await refusal(assignJourney(pg.db, pg.db, { journey: id, to: "ada" }))).toEqual([
      '"ada" is not an email address.',
    ]);
    expect(
      await refusal(
        assignJourney(pg.db, pg.db, { journey: "00000000-0000-4000-8000-000000000000", to: null }),
      ),
    ).toEqual(["No journey 00000000-0000-4000-8000-000000000000."]);
    expect(await refusal(assignJourney(pg.db, pg.db, { journey: "nope", to: null }))).toEqual([
      "No journey nope.",
    ]);
    expect(await ownerOf(id)).toBeNull();
  });

  it("shows the owner, and Mine lists the open journeys the viewer owns", async () => {
    const mine = await journeyFor("own4@example.test", ADA);
    await journeyFor("own5@example.test", NEO);
    await journeyFor("own6@example.test");
    const ask = { ...op(), record: "pipeline.journey", view: "mine", limit: 200 };
    const page = await api().recordsList(ask);
    expect(page.rows.map((r) => r.id)).toContain(mine);
    expect(page.rows.every((r) => r.owner === ADA)).toBe(true);
    const got = await api().recordsGet({ ...op(), record: "pipeline.journey", id: mine });
    expect(got.row.owner).toBe(ADA);
  });

  it("backfills the owner once from the newest hand arrival, and only an address counts", async () => {
    const sqlText = readFileSync(
      new URL("../../../db/drizzle/0308_journey_owner.sql", import.meta.url),
      "utf8",
    );
    const backfill = sqlText.split("--> statement-breakpoint")[1] ?? "";
    expect(backfill).toMatch(/UPDATE "pipeline"."journeys"/);
    const arrive = (id: string, ref: string, kind: string, ago: number, node = "s_engaged") =>
      pg.db.insert(events).values({
        workflow: "shape.v3",
        node,
        port: "in",
        subject: `journey:${id}`,
        kind: "journey",
        data: { cause: { kind, ref } },
        by: "t",
        at: new Date(Date.now() - ago * 60_000),
      });
    const [a, b, c, d] = [
      await journeyFor("bf1@example.test"),
      await journeyFor("bf2@example.test"),
      await journeyFor("bf3@example.test"),
      await journeyFor("bf4@example.test"),
    ] as [string, string, string, string];
    // a: two hand arrivals; the newest wins, lowercased.
    await arrive(a, "old@example.test", "manual", 30);
    await arrive(a, "New@Example.Test", "manual", 10, "s_booked");
    // b: a hand arrival by a shell name, an older one by an address: the newest decides, no address.
    await arrive(b, "gina", "manual", 5, "s_booked");
    await arrive(b, "gina@example.test", "manual", 50);
    // c: only spine arrivals. d: a hand drop is not an arrival at a step.
    await arrive(c, "touch:1", "touch", 5);
    await arrive(d, "d@example.test", "manual", 5, "dropped");
    await pg.db.execute(sql.raw(backfill));
    expect(await ownerOf(a)).toBe("new@example.test");
    expect(await ownerOf(b)).toBeNull();
    expect(await ownerOf(c)).toBeNull();
    expect(await ownerOf(d)).toBeNull();
  });
});

describe("custom fields on a journey", () => {
  const op = () => as(ADA, undefined, true);

  it("shows a field the workspace defines, with the value the Set field step wrote", async () => {
    const [p] = [
      (await resolveProfile(pg.db, [{ kind: "email", value: "cf1@example.test" }], "test"))
        ?.id as number,
    ];
    const [j] = await pg.db
      .insert(journeys)
      .values({ profileId: p, version: 3, node: "engaged", entry: "manual" })
      .returning();
    const id = j?.id as string;
    await saveCustomField(
      pg.db,
      null,
      { record: "pipeline.journey", label: "Roof age", kind: "number" },
      "t",
    );
    const out = await setFieldStep(pg.db)(
      "in",
      { subject: `journey:${id}`, kind: "journey", data: { age: 20 } } as never,
      {
        client: null,
        workflow: "shape.v3",
        node: "n1",
        with: { field: "roof_age", value: "{{data.age}}" },
      },
    );
    expect(out[0]?.port).toBe("out");
    const meta = await api().recordsTypes(op());
    const journey = meta.find((t) => t.id === "pipeline.journey");
    expect(journey?.fields.map((f) => f.key)).toContain("x_roof_age");
    // No form edits it here: the Set field step does.
    expect(journey?.edits).toBeNull();
    const got = await api().recordsGet({ ...op(), record: "pipeline.journey", id });
    expect(got.row.x_roof_age).toBe(20);
    const page = await api().recordsList({
      ...op(),
      record: "pipeline.journey",
      view: "all",
      sort: "-x_roof_age",
      limit: 200,
    });
    expect(page.rows.find((r) => r.id === id)?.x_roof_age).toBe(20);
    expect(page.rows[0]?.id).toBe(id);
    // Another owner's fields do not show in Wren's workspace.
    await saveCustomField(
      pg.db,
      "acme",
      { record: "pipeline.journey", label: "Pipe size", kind: "text" },
      "t",
    );
    const again = (await api().recordsTypes(op())).find((t) => t.id === "pipeline.journey");
    expect(again?.fields.map((f) => f.key)).not.toContain("x_pipe_size");
    const theirs = (await api().recordsTypes(as(VAL, "acme"))).find(
      (t) => t.id === "pipeline.journey",
    );
    expect(theirs?.fields.map((f) => f.key)).toContain("x_pipe_size");
    expect(theirs?.fields.map((f) => f.key)).not.toContain("x_roof_age");
  });
});
