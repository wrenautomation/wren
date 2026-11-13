/**
 * Vireo as paths on a real Postgres: subjects, batches, a child's lineage and guides, a guide's
 * samples, and the blind rule (an open batch hides its lineage from a viewer, not from the CLI).
 * Synthetic copy.
 */
import { childrenAt, homeAt, wholeAt } from "@wren/core/paths";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { variants } from "@wren/variants";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vireoPaths } from "../../src/vireo.js";

let pg: TestPostgres;
let first: number;
let child: number;
let firstBatch: number;
let openBatch: number;
let tip: number;
const S = "vireo/subjects/opener";
const paths = (items: { path: string }[]) => items.map((i) => i.path);

beforeAll(async () => {
  pg = await startTestPostgres();
  const v = variants(pg.db);
  await v.newSubject({ slug: "opener", name: "Opener email", kind: "text", by: "me" });
  tip = (await v.addGuide({ text: "Name their tool in line one", subject: "opener" })).id;
  const b1 = await v.addBatch("opener", {
    title: "Two openers",
    why: "Named tool against a question",
    agent: "test",
    samples: [
      { body: "Saw you use Acme CRM.", name: "Named tool", guides: [tip] },
      { body: "Quick question?", name: "Question" },
    ],
  });
  [first] = b1.samples as [number];
  await v.judge(first, "amazing", "me");
  await v.closeBatch(b1.batch, "More named tools", "me");
  const b2 = await v.addBatch("opener", {
    title: "Named tools",
    why: "Named tools, shorter",
    agent: "test",
    samples: [{ body: "Your Acme CRM, one idea.", parents: [first], guides: [tip] }],
  });
  [child] = b2.samples as [number];
  const f = await v.feedback("opener");
  [firstBatch, openBatch] = f.batches.map((b) => b.id) as [number, number];
});
afterAll(() => pg.stop());

describe("vireo paths", () => {
  it("holds subjects, batches newest first, and a batch's samples", async () => {
    const a = vireoPaths(pg.db, "me", null);
    expect(paths((await childrenAt(a, "vireo/subjects")).items)).toEqual([S]);
    expect(paths((await childrenAt(a, `${S}/batches`)).items)).toEqual([
      `${S}/batches/${openBatch}`,
      `${S}/batches/${firstBatch}`,
    ]);
    // Vireo shuffles positions: order by name
    const rows = (await childrenAt(a, `${S}/batches/${firstBatch}`)).items;
    expect(rows.map((i) => [i.name, i.sub, i.mark]).sort()).toEqual([
      ["Named tool", "amazing · 9", undefined],
      ["Question", `#${first + 1}`, undefined],
    ]);
  });

  it("shows an open batch's lineage to the CLI: grew-from, applies, applied-in", async () => {
    const a = vireoPaths(pg.db, null, null);
    const at = `${S}/batches/${openBatch}/${child}`;
    expect(paths((await childrenAt(a, at)).items)).toEqual([`${at}/grew-from`, `${at}/applies`]);
    expect(await homeAt(a, `${at}/grew-from/${first}`)).toBe(`${S}/batches/${firstBatch}/${first}`);
    const used = (await childrenAt(a, `vireo/guides/${tip}/applied-in`)).items;
    expect(used.map((i) => i.original)).toEqual([at, `${S}/batches/${firstBatch}/${first}`]);
    expect((await wholeAt(a, `${S}/batches/${openBatch}`)).body).toBe("Named tools, shorter");
  });

  it("hides it from a person while the batch is open: blind", async () => {
    const a = vireoPaths(pg.db, "me", null);
    const at = `${S}/batches/${openBatch}/${child}`;
    expect((await childrenAt(a, `${S}/batches/${openBatch}`)).items[0]?.leaf).toBe(true);
    await expect(childrenAt(a, `${at}/grew-from`)).rejects.toMatchObject({ code: "blind" });
    expect((await wholeAt(a, `${S}/batches/${openBatch}`)).body).toBe("");
    // the parent's grew-into and the guide's applied-in leave the open child out
    expect(paths((await childrenAt(a, `${S}/batches/${firstBatch}/${first}`)).items)).toEqual([
      `${S}/batches/${firstBatch}/${first}/applies`,
    ]);
    const used = (await childrenAt(a, `vireo/guides/${tip}/applied-in`)).items;
    expect(used.map((i) => i.original)).toEqual([`${S}/batches/${firstBatch}/${first}`]);
  });

  it("answers unknown-path for a subject that is not there", async () => {
    const a = vireoPaths(pg.db, null, null);
    await expect(childrenAt(a, "vireo/subjects/nope/batches")).rejects.toMatchObject({
      code: "unknown-path",
    });
  });
});
