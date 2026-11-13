/**
 * Folders as paths on a real Postgres, through the CLI's roots: a folder's subject walks on into
 * Vireo, its run into Weaver (a fake `weaver serve`), a moved folder answers where it is now.
 * Synthetic names.
 */
import { childrenAt, homeAt, PathError, rooted, wholeAt } from "@wren/core/paths";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { folderTree } from "@wren/folders";
import { variants } from "@wren/variants";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliRoots } from "../../src/roots.js";
import type { WeaverSource } from "../../src/weaver-tree.js";

let pg: TestPostgres;
let top: number;
let inner: number;
const paths = (items: { path: string }[]) => items.map((i) => i.path);

const weaver = (up = true): WeaverSource => ({
  runs: async () => {
    if (!up) throw new PathError("offline", "weaver serve does not answer");
    return [
      {
        run: "r1",
        ask: "Who hires plumbers?",
        parent: null,
        updated: "2026-11-01T10:00:00Z",
        documents: 0,
        kept: 0,
      },
    ];
  },
  view: async (run) => ({ run, queries: [], hits: [], documents: [], findings: [] }),
  page: async () => {
    throw new PathError("unknown-path", "no page");
  },
});
const at = (up = true) => {
  const roots = cliRoots(
    { db: pg.db, media: null, canonRemote: "https://example.com/canon.git" },
    weaver(up),
  );
  return rooted(roots, "folders");
};

beforeAll(async () => {
  pg = await startTestPostgres();
  const v = variants(pg.db);
  const s = await v.newSubject({ slug: "opener", name: "Opener email", kind: "text", by: "me" });
  await v.addBatch("opener", {
    title: "One",
    why: "first look",
    agent: "test",
    samples: [{ body: "Hi." }],
  });
  const t = folderTree(pg.db);
  top = (await t.make({ name: "Plumbers", by: "me" })).id;
  inner = (await t.make({ name: "Leads", parent: top, by: "me" })).id;
  await t.file({ kind: "subject", refs: [String(s.id)], folder: top, by: "me" });
  await t.file({ kind: "run", refs: ["r1"], folder: top, by: "me" });
});
afterAll(() => pg.stop());

describe("folders paths", () => {
  it("lists a folder's folders, then its items as aliases of their homes", async () => {
    const a = at();
    expect(paths((await childrenAt(a, "folders")).items)).toEqual([`folders/${top}`]);
    const rows = (await childrenAt(a, `folders/${top}`)).items;
    expect(rows.map((i) => [i.path, i.original ?? null, i.name])).toEqual([
      [`folders/${top}/${inner}`, null, "Leads"],
      [`folders/${top}/opener`, "vireo/subjects/opener", "Opener email"],
      [`folders/${top}/r1`, "weaver/r1", "Who hires plumbers?"],
    ]);
  });

  it("walks from a folder into Vireo and Weaver", async () => {
    const a = at();
    expect(await homeAt(a, `folders/${top}/opener/batches`)).toBe("vireo/subjects/opener/batches");
    expect((await childrenAt(a, `folders/${top}/opener/batches`)).items).toHaveLength(1);
    expect(paths((await childrenAt(a, `folders/${top}/r1`)).items)).toEqual([
      `folders/${top}/r1/pages`,
      `folders/${top}/r1/queries`,
    ]);
    expect(await homeAt(a, `folders/${top}/r1/queries`)).toBe("weaver/r1/queries");
    expect((await wholeAt(a, `folders/${top}/opener`)).path).toBe("vireo/subjects/opener");
  });

  it("names runs by id while weaver serve is off", async () => {
    const rows = (await childrenAt(at(false), `folders/${top}`)).items;
    expect(rows.at(-1)).toMatchObject({ path: `folders/${top}/r1`, name: "r1" });
  });

  it("follows a moved folder", async () => {
    await folderTree(pg.db).move(inner, null, "me");
    const a = at();
    expect(await homeAt(a, `folders/${top}/${inner}`)).toBe(`folders/${inner}`);
  });
});
