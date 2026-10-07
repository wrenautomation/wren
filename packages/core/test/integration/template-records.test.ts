/**
 * The template store as records: every field's column is in the rows, and a step finds its
 * template and numbers. Synthetic copy only.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RecordType } from "../../src/records.js";
import { templateRecords } from "../../src/template-records.js";
import { importVersion, saveDraft } from "../../src/templates.js";
import { cadenceWorkflow } from "../../src/workflows.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() =>
  truncate(pg.db, ["templates", "template_versions", "sms_messages", "sms_contacts"]),
);

const TEXT = { kind: "sms", system: "texts", name: "demo#1" } as const;
const FLOW = cadenceWorkflow({
  name: "demo",
  label: "Demo texts",
  blurb: "Two texts.",
  for: "client",
  steps: [
    { touch: "sms.touch", template: TEXT, with: { step: 1 } },
    {
      after: "2 days",
      touch: "sms.touch",
      template: { ...TEXT, name: "demo#2" },
      with: { step: 2 },
    },
  ],
});

const rowsOf = async (r: RecordType) => {
  const rows = (await r.rows?.(pg.db)) ?? [];
  for (const row of rows) {
    expect(row).toHaveProperty(r.key);
    for (const f of Object.values(r.fields)) expect(row).toHaveProperty(f.from as string);
  }
  return rows;
};

describe("template records", () => {
  it("lists templates, versions, sequences and steps, each field filled from a column", async () => {
    const live = await importVersion(pg.db, TEXT, "Hi {first_name|there}. Reply STOP to opt out.", {
      by: "import:test",
    });
    await saveDraft(pg.db, TEXT, "Hey {first_name|there}. Text STOP to stop.", { by: "op" });
    const [template, version, variant, sequence, step] = templateRecords([FLOW]) as [
      RecordType,
      RecordType,
      RecordType,
      RecordType,
      RecordType,
    ];

    expect(await rowsOf(template)).toEqual([
      expect.objectContaining({ name: "demo#1", state: "draft", versions: 2, sends: 0 }),
    ]);
    const versions = await rowsOf(version);
    expect(versions.map((v) => v.state).sort()).toEqual(["draft", "live"]);
    await pg.db.execute(sql`
      with c as (insert into sms_contacts (e164, source_kind, basis)
        values ('+15555550100', 'manual', 'opt_in') returning id)
      insert into sms_messages (contact_id, direction, kind, to_e164, body, state, template,
        template_version, provenance, sent_at, provider_id, step)
      select id, 'out', 'sequence', '+15555550100', 'Hi', 'delivered', 'demo#1', ${live.version},
        '{"picks": {"tone": 1}}'::jsonb, now(), 'p-1', 1 from c`);
    expect(await rowsOf(variant)).toEqual([
      expect.objectContaining({
        template: "demo#1",
        picks: '{"tone": 1}',
        sends: 1,
        version_id: expect.any(String),
      }),
    ]);
    expect(await rowsOf(template)).toEqual([expect.objectContaining({ sends: 1 })]);
    expect(await rowsOf(sequence)).toEqual([
      expect.objectContaining({ id: "follow_up.demo", steps: 2, channel: "sms" }),
    ]);
    const steps = await rowsOf(step);
    expect(steps).toEqual([
      expect.objectContaining({
        step: 1,
        wait: null,
        template: "demo#1",
        template_id: expect.any(String),
      }),
      expect.objectContaining({ step: 2, wait: "2 days", template: "demo#2", template_id: null }),
    ]);
  });
});
