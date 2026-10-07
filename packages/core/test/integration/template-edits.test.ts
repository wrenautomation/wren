/**
 * The Library's template edits on a real Postgres (`../../src/template-edits.ts`): a save keeps a
 * numbered draft, Undo puts the words back, and texts refuse. Publishing is the templates
 * service's, not an edit. The detail renders the words with the made-up lead. Synthetic copy throughout.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { editRecord, undoChange } from "../../src/edits.js";
import { PortalRefusal } from "../../src/portal.js";
import type { RecordType } from "../../src/records.js";
import { parseKind } from "../../src/slots/index.js";
import { pointsOf, sampleOf, templateDetail } from "../../src/template-edits.js";
import { templateRecords } from "../../src/template-records.js";
import { ensureTemplate, importVersion, templateState } from "../../src/templates.js";
import { cadenceWorkflow } from "../../src/workflows.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["templates", "template_versions", "changes"]));

const OPENER = { kind: "email", system: "demo", name: "plain/opener" } as const;
const TEXT = { kind: "sms", system: "texts", name: "demo#1" } as const;
const V1 = "subject: hello {first_name|there}\n\nHi {first_name|there}, a note for {company}.";
const V2 =
  "subject: [[#s quick question | hello]] {first_name|there}\n\nHi {first_name}, {company}.";
const FLOW = cadenceWorkflow({
  name: "demo",
  label: "Demo",
  blurb: "One email.",
  for: "wren",
  steps: [{ touch: "email.touch", template: OPENER, with: { step: 0 } }],
});
const [template, , , sequence] = templateRecords([FLOW]) as [
  RecordType,
  RecordType,
  RecordType,
  RecordType,
];
const by = "op@example.com";

describe("template edits", () => {
  it("saves a numbered draft as an edit, and undoes it", async () => {
    await importVersion(pg.db, OPENER, V1, { by: "import:test" });
    const id = String(await ensureTemplate(pg.db, OPENER));
    const saved = await editRecord(pg.db, template, id, { patch: { words: V2 }, by });
    expect(saved.values).toMatchObject({ words: V2 });
    expect(await templateState(pg.db, OPENER)).toMatchObject({
      live: { number: 1, origin: "import" },
      draft: { number: 2, origin: "edit", by },
    });
    await undoChange(pg.db, template, id, saved.change as number, by);
    const back = await templateState(pg.db, OPENER);
    expect(back?.draft).toBeNull();
    expect(back?.live?.source).toBe(V1);
  });

  it("refuses bad marks, publishing as an edit, and texts", async () => {
    await importVersion(pg.db, OPENER, V1, { by: "import:test" });
    await importVersion(pg.db, TEXT, "Hi {first_name}. Reply STOP to stop.", { by: "import:test" });
    const id = String(await ensureTemplate(pg.db, OPENER));
    const text = String(await ensureTemplate(pg.db, TEXT));
    const refused = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(PortalRefusal);
    await refused(editRecord(pg.db, template, id, { patch: { words: "Hi [[#a one" }, by }));
    await refused(editRecord(pg.db, template, id, { patch: { liveVersion: 1 }, by }));
    await refused(editRecord(pg.db, template, text, { patch: { words: "Hey. STOP" }, by }));
  });

  it("details the words with the made-up lead, versions and sequences", async () => {
    await importVersion(pg.db, OPENER, V1, { by: "import:test" });
    const id = String(await ensureTemplate(pg.db, OPENER));
    await editRecord(pg.db, template, id, { patch: { words: V2 }, by });
    const d = await templateDetail(pg.db, id);
    expect(d?.live?.sample).toEqual({
      subject: "hello Sam",
      body: "Hi Sam, a note for Northwind Staffing.",
    });
    expect(d?.draft?.version).toBeTruthy();
    expect(d?.slots).toEqual(["first_name", "company"]);
    expect(d?.variants.map((v) => v.name)).toEqual(["s"]);
    expect(d?.versions.map((v) => [v.number, v.state, v.origin])).toEqual([
      [2, "draft", "edit"],
      [1, "live", "import"],
    ]);
    expect(d?.status).toBe("edited");
    expect(await sequence.load?.(pg.db, "follow_up.demo")).toMatchObject({
      steps: [{ step: 1, template: "plain/opener", templateId: id, sends: 0 }],
    });
  });
});

describe("sample and variants", () => {
  it("says why words don't render", () => {
    expect(sampleOf("email", "x", "Hi [[#a one").problem).toBeTruthy();
  });

  it("counts each option from the picks", () => {
    const tpl = parseKind("email", "x", V2);
    expect(
      pointsOf(tpl, [
        { picks: { s: 0 }, sends: 3, replies: 1 },
        { picks: '{"s": 1}', sends: 2, replies: 0 },
      ]),
    ).toEqual([
      {
        name: "s",
        options: [
          { text: "quick question", sends: 3, replies: 1 },
          { text: "hello", sends: 2, replies: 0 },
        ],
      },
    ]);
  });
});
