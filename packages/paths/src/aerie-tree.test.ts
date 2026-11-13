import { columns, homeAt, PathError, wholeAt } from "@wren/core/paths";
import { describe, expect, it } from "vitest";
import {
  type AerieTreeSource,
  type AerieTreeTask,
  aerieRouteOf,
  aerieTree,
  OUTSIDE,
} from "./aerie-tree.js";

const task = (id: string, area: string, o: Partial<AerieTreeTask> = {}): AerieTreeTask => ({
  id,
  title: `title ${id}`,
  status: "To Do",
  area,
  aliases: [],
  dependencies: [],
  ...o,
});

// EX-1 parent of EX-1.1; EX-2 waits on EX-1 and also shows in ops; EX-3 alone in inbox
const TASKS = [
  task("EX-1", "dev/site"),
  task("EX-1.1", "dev/site", { parentId: "EX-1", status: "Done" }),
  task("EX-2", "dev/site", { dependencies: ["EX-1"], aliases: ["ops"] }),
  task("EX-3", "inbox"),
];
const AREAS = [
  { path: "dev", name: "Dev", description: null },
  { path: "dev/site", name: "Site", description: "the public site" },
  { path: "ops", name: "Ops", description: null },
  { path: "inbox", name: "Inbox", description: null },
];
const src = (kept: string[] | null = null): AerieTreeSource => ({
  areas: AREAS,
  tasks: TASKS,
  kept: kept ? new Set(kept) : null,
});
const names = async (a: ReturnType<typeof aerieTree>, path: string) =>
  (await a.children(path)).items.map((i) => i.name);

describe("aerieTree", () => {
  it("roots areas, then child areas and homed tasks, a child under its parent", async () => {
    const a = aerieTree(src());
    expect(await names(a, "aerie")).toEqual(["Dev", "Ops", "Inbox"]);
    expect(await names(a, "aerie/dev")).toEqual(["Site"]);
    expect(await names(a, "aerie/dev/site")).toEqual(["title EX-1", "title EX-2"]);
    const kids = (await a.children("aerie/dev/site/EX-1")).items;
    expect(kids.map((i) => i.path)).toEqual([
      "aerie/dev/site/EX-1/EX-1.1",
      "aerie/dev/site/EX-1/blocks",
    ]);
    expect(aerieRouteOf(TASKS, "EX-1.1")).toBe("aerie/dev/site/EX-1/EX-1.1");
  });

  it("counts shown top tasks in an area's subtree", async () => {
    const rows = (await aerieTree(src()).children("aerie")).items;
    expect(rows.map((r) => r.count)).toEqual([2, 1, 1]);
  });

  it("shows an alias area's task as an alias that walks to its home", async () => {
    const a = aerieTree(src());
    const [row] = (await a.children("aerie/ops")).items;
    expect(row).toMatchObject({
      path: "aerie/ops/EX-2",
      original: "aerie/dev/site/EX-2",
      from: "Site",
    });
    expect(await homeAt(a, "aerie/ops/EX-2")).toBe("aerie/dev/site/EX-2");
  });

  it("gives a task its waits-on and blocks and a leaf none", async () => {
    const a = aerieTree(src());
    const w = await wholeAt(a, "aerie/dev/site/EX-2");
    expect(w.links).toMatchObject([
      { rel: "waits-on", dir: "out", items: [{ name: "title EX-1" }] },
    ]);
    expect(w.data).toEqual({ id: "EX-2" });
    expect((await a.item("aerie/inbox/EX-3")).leaf).toBe(true);
  });

  it("with a filter: hides empty areas, keeps the parent of a match as outside", async () => {
    const a = aerieTree(src(["EX-1.1"]));
    expect(await names(a, "aerie")).toEqual(["Dev"]);
    const [parent] = (await a.children("aerie/dev/site")).items;
    expect(parent).toMatchObject({ name: "title EX-1", mark: OUTSIDE });
    // relations are facts: they stay with a filter on
    expect(await names(a, "aerie/dev/site/EX-1")).toEqual(["title EX-1.1", "Blocks"]);
  });

  it("walks a route into columns and the last task whole", async () => {
    const s = await columns(aerieTree(src()), "aerie/dev/site/EX-1/EX-1.1");
    expect(s.columns.map((c) => c.route)).toEqual([
      "aerie",
      "aerie/dev",
      "aerie/dev/site",
      "aerie/dev/site/EX-1",
      "aerie/dev/site/EX-1/EX-1.1",
    ]);
    expect(s.whole?.data).toEqual({ id: "EX-1.1" });
  });

  it("stops a loop in the parents at the area", () => {
    const loop = [task("A", "x", { parentId: "B" }), task("B", "x", { parentId: "A" })];
    expect(aerieRouteOf(loop, "A")).toBe("aerie/x/B/A");
    expect(aerieRouteOf(loop, "B")).toBe("aerie/x/B");
  });

  it("rejects a path it does not hold", async () => {
    await expect(aerieTree(src()).children("aerie/nope/EX-9")).rejects.toBeInstanceOf(PathError);
  });

  it("finds by id or title words under a path", async () => {
    const a = aerieTree(src());
    expect((await a.find("ex-1.1", "aerie/dev")).map((i) => i.name)).toEqual(["title EX-1.1"]);
    expect(await a.find("title", "aerie/inbox")).toHaveLength(1);
  });
});
