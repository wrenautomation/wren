import { homeAt, PathError, walk } from "@wren/core/paths";
import { describe, expect, it } from "vitest";
import { type FoldersSource, foldersTree } from "./folders-tree.js";

// Plumbers (1) › Leads (2) › Cold (3); Bakers (4). Plumbers holds a subject and a run.
const source = (o: { offline?: boolean; calls?: string[] } = {}): FoldersSource => ({
  tree: async () => {
    o.calls?.push("tree");
    return {
      folders: [
        { id: 1, parent: null, name: "plumbers" },
        { id: 2, parent: 1, name: "Leads" },
        { id: 3, parent: 2, name: "Cold" },
        { id: 4, parent: null, name: "Bakers" },
      ],
      filed: [
        { kind: "subject", ref: "7", folder: 1 },
        { kind: "run", ref: "r1", folder: 1 },
        { kind: "chat", ref: "c-1", folder: 1 },
        { kind: "subject", ref: "99", folder: 4 },
      ],
    };
  },
  subjects: async () => {
    o.calls?.push("subjects");
    return [
      {
        id: 7,
        slug: "opener",
        name: "Opener email",
        kind: "text",
        state: "open",
        samples: 4,
        kept: 1,
        toPick: 0,
      },
    ];
  },
  runs: async () => {
    o.calls?.push("runs");
    if (o.offline) throw new PathError("offline", "weaver serve does not answer");
    return [
      {
        run: "r1",
        ask: "Who hires plumbers?",
        parent: null,
        updated: "2026-11-01T10:00:00Z",
        documents: 3,
        kept: 2,
      },
    ];
  },
});

describe("foldersTree", () => {
  it("lists top folders by name, then a folder's folders before its items", async () => {
    const t = foldersTree(source());
    expect((await t.children("folders")).items.map((i) => [i.path, i.name, i.count])).toEqual([
      ["folders/4", "Bakers", 0],
      ["folders/1", "plumbers", 3],
    ]);
    expect((await t.children("folders/1")).items.map((i) => [i.path, i.original])).toEqual([
      ["folders/1/2", undefined],
      ["folders/1/opener", "vireo/subjects/opener"],
      ["folders/1/r1", "weaver/r1"],
    ]);
    expect((await t.children("folders/1/2")).items.map((i) => i.path)).toEqual(["folders/1/2/3"]);
  });

  it("names a filed item as its home does; a gone one and a chat stay out", async () => {
    const t = foldersTree(source());
    const [, subject, run] = (await t.children("folders/1")).items;
    expect([subject?.name, subject?.kind, run?.name, run?.kind]).toEqual([
      "Opener email",
      "subject",
      "Who hires plumbers?",
      "run",
    ]);
    expect((await t.children("folders/4")).items).toEqual([]);
  });

  it("shows runs by id while weaver serve is off", async () => {
    const t = foldersTree(source({ offline: true }));
    const run = (await t.children("folders/1")).items.at(-1);
    expect([run?.path, run?.name, run?.original]).toEqual(["folders/1/r1", "r1", "weaver/r1"]);
  });

  it("walks an alias to its home in another root", async () => {
    const t = foldersTree(source());
    const w = await walk(t, "folders/1/opener/batches", (home) => !home.startsWith("folders"));
    expect(w.steps.at(-1)?.home).toBe("vireo/subjects/opener");
    expect(w.rest).toEqual(["batches"]);
    expect(await homeAt(t, "folders/1/r1")).toBe("weaver/r1");
  });

  it("follows a folder that moved: the item says where it is now", async () => {
    const t = foldersTree(source());
    // Cold (3) sits under Leads (2), not at the top
    expect(await t.item("folders/3")).toMatchObject({ path: "folders/1/2/3", was: "folders/3" });
    expect(await homeAt(t, "folders/3")).toBe("folders/1/2/3");
    await expect(t.children("folders/3")).rejects.toMatchObject({ code: "unknown-path" });
  });

  it("refuses what is not there", async () => {
    const t = foldersTree(source());
    for (const p of ["folders/9", "folders/1/nope", "things"])
      await expect(t.item(p)).rejects.toBeInstanceOf(PathError);
  });

  it("finds folders and filed items, under a folder too", async () => {
    const t = foldersTree(source());
    expect((await t.find("cold")).map((i) => i.path)).toEqual(["folders/1/2/3"]);
    expect((await t.find("opener")).map((i) => i.path)).toEqual(["vireo/subjects/opener"]);
    expect((await t.find("o", "folders/1/2")).map((i) => i.path)).toEqual(["folders/1/2/3"]);
  });

  it("loads once per adapter, and asks for runs only when one is filed", async () => {
    const calls: string[] = [];
    const t = foldersTree(source({ calls }));
    await t.children("folders");
    await t.children("folders/1");
    await t.item("folders/1/2");
    expect(calls).toEqual(["tree", "subjects", "runs"]);
  });
});
