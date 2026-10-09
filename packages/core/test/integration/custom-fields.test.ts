/**
 * Custom fields on a real Postgres (`../../src/custom-fields.ts`): a field saved on a record type
 * shows, filters and sorts as a column, edits through the type's form with undo, fills copy as
 * `{field.<key>}` beside the business facts, and the Set field step writes one. Synthetic rows.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  customFacts,
  customFieldsOf,
  orderCustomFields,
  saveBusinessFact,
  saveCustomField,
  setFieldStep,
  withCustomFields,
} from "../../src/custom-fields.js";
import { editRecord, editState, undoChange } from "../../src/edits.js";
import { PortalRefusal } from "../../src/portal.js";
import { defineRecord, type RecordType, text } from "../../src/records.js";
import { serveRecords } from "../../src/records-serve.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.execute(sql`create table cf_fixture (id text primary key, name text)`);
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, [
    "custom_field_values",
    "custom_fields",
    "custom_values",
    "changes",
    "cf_fixture",
  ]);
  await pg.db.execute(
    sql`insert into cf_fixture values ('1', 'Elm St roof'), ('2', 'Oak Ave roof')`,
  );
});

const RECORD = "test.cfdeal";
const deal = defineRecord({
  id: RECORD,
  app: "deals",
  channel: null,
  name: { one: "deal", many: "deals" },
  rows: async (db) => (await db.execute(sql`select * from cf_fixture`)) as never,
  key: "id",
  title: "name",
  fields: { name: text("Name") },
  views: [{ id: "all", label: "All" }],
  custom: {
    owner: null,
    exists: async (db, id) =>
      ((await db.execute(sql`select 1 from cf_fixture where id = ${id}`)) as unknown[]).length > 0,
  },
});
const by = "team@example.test";

const refused = async (p: Promise<unknown>, status = 400) => {
  const err = await p.then(
    () => "answered",
    (e: unknown) => e,
  );
  if (!(err instanceof PortalRefusal)) throw new Error(`not a refusal: ${String(err)}`);
  expect(err.status).toBe(status);
};
const v = (s: { version: string } | null) => s?.version ?? "";
const live = async (): Promise<RecordType> => {
  const [t] = await withCustomFields([deal], pg.db);
  return t as RecordType;
};

describe("fields", () => {
  it("saves with a key from the name, keeps kind and key fixed, refuses a taken key", async () => {
    const f = await saveCustomField(
      pg.db,
      null,
      { record: RECORD, label: "Roof age", kind: "number" },
      by,
    );
    expect(f.key).toBe("roof_age");
    await refused(
      saveCustomField(pg.db, null, { id: f.id, record: RECORD, label: "Age", kind: "text" }, by),
    );
    await refused(saveCustomField(pg.db, null, { record: RECORD, label: "Roof age!" }, by));
    const renamed = await saveCustomField(
      pg.db,
      null,
      { id: f.id, record: RECORD, label: "Roof years" },
      by,
    );
    expect(renamed).toMatchObject({ key: "roof_age", label: "Roof years" });
  });

  it("archives and brings back, and orders the live ones", async () => {
    const a = await saveCustomField(pg.db, null, { record: RECORD, label: "A" }, by);
    const b = await saveCustomField(pg.db, null, { record: RECORD, label: "B" }, by);
    await orderCustomFields(pg.db, null, RECORD, [b.id, a.id], by);
    expect((await customFieldsOf(pg.db, null, RECORD)).map((f) => f.key)).toEqual(["b", "a"]);
    await saveCustomField(
      pg.db,
      null,
      { id: a.id, record: RECORD, label: "A", archived: true },
      by,
    );
    expect((await customFieldsOf(pg.db, null, RECORD)).map((f) => f.key)).toEqual(["b"]);
    expect(await customFieldsOf(pg.db, null, RECORD, { archived: true })).toHaveLength(2);
  });
});

describe("on the record", () => {
  it("shows, filters and sorts as a column, edits with undo", async () => {
    await saveCustomField(pg.db, null, { record: RECORD, label: "Roof age", kind: "number" }, by);
    await saveCustomField(
      pg.db,
      null,
      {
        record: RECORD,
        label: "Material",
        kind: "choice",
        options: [{ label: "Metal" }, { label: "Tile" }],
      },
      by,
    );
    const t = await live();
    const start = v(await editState(pg.db, t, "1"));
    await editRecord(pg.db, t, "1", {
      patch: { x_roof_age: 12, x_material: "metal" },
      expect: start,
      by,
    });
    await editRecord(pg.db, t, "2", {
      patch: { x_roof_age: 3 },
      expect: v(await editState(pg.db, t, "2")),
      by,
    });
    await refused(
      editRecord(pg.db, t, "2", {
        patch: { x_material: "straw" },
        expect: v(await editState(pg.db, t, "2")),
        by,
      }),
    );

    const api = serveRecords([t], pg.db);
    const page = await api.list({ record: RECORD, sort: "-x_roof_age", limit: 10 });
    expect(page.rows.map((r) => [r.id, r.x_roof_age])).toEqual([
      ["1", 12],
      ["2", 3],
    ]);
    expect(page.rows[0]?.x_material).toBe("metal");

    const edited = await editRecord(pg.db, t, "1", {
      patch: { x_roof_age: 13 },
      expect: v(await editState(pg.db, t, "1")),
      by,
    });
    await undoChange(pg.db, t, "1", edited.change as number, by);
    expect((await editState(pg.db, t, "1"))?.values.x_roof_age).toBe(12);
  });

  it("refuses dropping an option still set on a record", async () => {
    const f = await saveCustomField(
      pg.db,
      null,
      {
        record: RECORD,
        label: "Material",
        kind: "choice",
        options: [{ label: "Metal" }, { label: "Tile" }],
      },
      by,
    );
    const t = await live();
    await editRecord(pg.db, t, "1", {
      patch: { x_material: "tile" },
      expect: v(await editState(pg.db, t, "1")),
      by,
    });
    await refused(
      saveCustomField(
        pg.db,
        null,
        { id: f.id, record: RECORD, label: "Material", options: [{ label: "Metal" }] },
        by,
      ),
    );
  });
});

describe("copy and workflows", () => {
  it("fills biz and field facts, and Set field writes one", async () => {
    await saveCustomField(
      pg.db,
      null,
      { record: "deals.deal", label: "Roof age", kind: "number" },
      by,
    );
    await saveBusinessFact(pg.db, null, { label: "Phone", value: "(416) 555-0100" }, by);
    const step = setFieldStep(pg.db);
    const at = {
      client: null,
      workflow: "wf",
      node: "n1",
      with: { field: "roof_age", value: "{{data.age}}" },
    };
    const out = await step(
      "in",
      { subject: "deal:7", kind: "deal", data: { age: 20 } } as never,
      at,
    );
    expect(out[0]?.port).toBe("out");
    expect(await customFacts(pg.db, null, "deal:7")).toEqual({
      "biz.phone": "(416) 555-0100",
      "field.roof_age": "20",
    });
    const skip = await step("in", { subject: "lead:sms:1", kind: "lead", data: {} } as never, at);
    expect(skip[0]?.port).toBe("skip");
  });

  it("an empty business fact removes it", async () => {
    await saveBusinessFact(pg.db, null, { label: "Hours", value: "9 to 5" }, by);
    await saveBusinessFact(pg.db, null, { key: "hours", label: "Hours", value: "" }, by);
    expect(await customFacts(pg.db, null)).toEqual({});
  });
});
