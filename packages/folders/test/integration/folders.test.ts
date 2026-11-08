/** The folder tree on a real Postgres: nest, file, move, drop. Synthetic names. */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { subjects } from "@wrenautomation/vireo/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FolderError, folderTree } from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const by = "test@example.com";

describe("folder tree", () => {
  it("files, moves and drops without losing an item", async () => {
    const t = folderTree(pg.db);
    const a = await t.make({ name: "  Plumbers  ", by });
    expect(a.name).toBe("Plumbers");
    const b = await t.make({ name: "Openers", parent: a.id, by });
    const c = await t.make({ name: "Week 1", parent: b.id, by });
    await expect(t.make({ name: "Too deep", parent: c.id, by })).rejects.toThrow(FolderError);
    await expect(t.make({ name: "plumbers", by })).rejects.toThrow(/already here/);

    await t.file({ kind: "chat", refs: ["s-1", "s-2"], folder: b.id, by });
    await t.file({ kind: "run", refs: ["r-1"], folder: c.id, by });
    // a move is an upsert: one folder per item
    await t.file({ kind: "chat", refs: ["s-2"], folder: a.id, by });
    expect((await t.tree("chat")).filed).toEqual(
      expect.arrayContaining([
        { kind: "chat", ref: "s-1", folder: b.id },
        { kind: "chat", ref: "s-2", folder: a.id },
      ]),
    );

    await expect(t.move(a.id, c.id, by)).rejects.toThrow(/inside itself/);
    // a sibling named like the child that moves up gets a number
    await t.make({ name: "Week 1", parent: a.id, by });
    await t.drop(b.id, by);
    const after = await t.tree();
    expect(after.folders.find((f) => f.id === c.id)).toMatchObject({
      parent: a.id,
      name: "Week 1 2",
    });
    expect(after.filed).toContainEqual({ kind: "chat", ref: "s-1", folder: a.id });

    // at the top, a drop unfiles
    await t.drop(a.id, by);
    const top = await t.tree();
    expect(top.filed.filter((f) => f.kind === "chat")).toEqual([]);
    expect(top.filed).toContainEqual({ kind: "run", ref: "r-1", folder: c.id });
  });

  it("refuses a subject that is not there, and lets go of a deleted one", async () => {
    const t = folderTree(pg.db);
    const f = await t.make({ name: "Copy", by });
    await expect(t.file({ kind: "subject", refs: ["99999"], folder: f.id, by })).rejects.toThrow(
      /no such subject/,
    );
    const [s] = await pg.db
      .insert(subjects)
      .values({ slug: "opener-test", name: "Opener", kind: "text" })
      .returning({ id: subjects.id });
    const id = String(s?.id);
    await t.file({ kind: "subject", refs: [id], folder: f.id, by });
    expect((await t.tree("subject")).filed).toEqual([{ kind: "subject", ref: id, folder: f.id }]);
    await t.file({ kind: "subject", refs: [id], folder: null, by });
    expect((await t.tree("subject")).filed).toEqual([]);
    await t.file({ kind: "subject", refs: [id], folder: f.id, by });
    await pg.db.delete(subjects).where(eq(subjects.id, Number(id)));
    expect((await t.tree("subject")).filed).toEqual([]);
  });
});
