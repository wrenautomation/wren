import { describe, expect, it } from "vitest";
import {
  type Adapter,
  aliasOf,
  childrenAt,
  columns,
  homeAt,
  type Item,
  itemFromParent,
  join,
  linksOf,
  PathError,
  rebase,
  relationRow,
  walk,
  wholeAt,
} from "./index.js";

// a: two topics; b borrows a's set; a line with a relation folder; one path offline
const LINE: Item = { path: "t/a/s1/L-1", name: "L-1", kind: "line" };
const SET: Item = { path: "t/a/s1", name: "s1", kind: "set", count: 1 };
const REF: Item = { path: "t/refs/r1", name: "A talk", kind: "reference", leaf: true };
const ROWS: Record<string, Item[]> = {
  t: [
    { path: "t/a", name: "a", kind: "topic" },
    { path: "t/b", name: "b", kind: "topic" },
    { path: "t/refs", name: "Refs", kind: "area" },
    { path: "t/dark", name: "dark", kind: "topic" },
  ],
  "t/a": [SET],
  "t/b": [aliasOf("t/b", SET, "a")],
  "t/a/s1": [LINE],
  "t/a/s1/L-1": relationRow("t/a/s1/L-1", "backed-by", [REF]),
  "t/a/s1/L-1/backed-by": [aliasOf("t/a/s1/L-1/backed-by", REF)],
  "t/refs": [REF],
};

const fixture = (): Adapter & { reads: string[] } => {
  const reads: string[] = [];
  const a: Adapter & { reads: string[] } = {
    root: "t",
    reads,
    children: async (path) => {
      reads.push(path);
      if (path.startsWith("t/dark")) throw new PathError("offline", "the Mac sleeps");
      const items = ROWS[path];
      if (!items) throw new PathError("unknown-path", `nothing at ${path}`);
      return { items };
    },
    item: (path) => itemFromParent(a, path),
    whole: async (path) => {
      const item = await a.item(path);
      return { ...item, body: `body of ${item.path}`, links: await linksOf(a, item) };
    },
    find: async () => [],
  };
  return a;
};

describe("walk", () => {
  it("goes through an alias to its home", async () => {
    const w = await walk(fixture(), "t/b/s1/L-1");
    expect(w.error).toBeUndefined();
    expect(w.steps.map((s) => [s.route, s.home])).toEqual([
      ["t", "t"],
      ["t/b", "t/b"],
      ["t/b/s1", "t/a/s1"],
      ["t/b/s1/L-1", "t/a/s1/L-1"],
    ]);
  });

  it("keeps the steps before a failed one", async () => {
    const w = await walk(fixture(), "t/a/nope/deeper");
    expect(w.steps.map((s) => s.route)).toEqual(["t", "t/a"]);
    expect(w.error).toMatchObject({ code: "unknown-path", route: "t/a/nope" });
  });

  it("refuses another root", async () => {
    expect((await walk(fixture(), "x/a")).error).toMatchObject({ code: "unknown-path" });
  });

  it("throws what is not a path error", async () => {
    const a = fixture();
    a.item = async () => {
      throw new Error("db down");
    };
    await expect(walk(a, "t/a")).rejects.toThrow("db down");
  });
});

describe("columns", () => {
  it("lists each step's rows under the route, then the last item whole", async () => {
    const shown = await columns(fixture(), "t/b/s1/L-1");
    expect(shown.columns.map((c) => c.items.map((i) => i.path))).toEqual([
      ["t/a", "t/b", "t/refs", "t/dark"],
      ["t/b/s1"],
      ["t/b/s1/L-1"],
      ["t/b/s1/L-1/backed-by"],
    ]);
    // rows read at the home carry it as `original` when the route differs
    expect(shown.columns[2]?.items[0]).toMatchObject({ original: "t/a/s1/L-1" });
    expect(shown.whole).toMatchObject({
      path: "t/a/s1/L-1",
      body: "body of t/a/s1/L-1",
      links: [{ rel: "backed-by", dir: "in", items: [{ original: "t/refs/r1" }] }],
    });
  });

  it("opens no preview for a folder, and no rows under a leaf", async () => {
    expect((await columns(fixture(), "t/refs")).whole).toBeUndefined();
    const leaf = await columns(fixture(), "t/refs/r1");
    expect(leaf.columns.at(-1)).toMatchObject({ route: "t/refs/r1", items: [] });
    expect(leaf.whole?.path).toBe("t/refs/r1");
  });

  it("shows the columns before an offline one, with its error", async () => {
    const shown = await columns(fixture(), "t/dark");
    expect(shown.columns.map((c) => c.route)).toEqual(["t"]);
    expect(shown.error).toMatchObject({ code: "offline", route: "t/dark" });
    expect(shown.whole).toBeUndefined();
  });
});

describe("routes", () => {
  it("reads any route at its home", async () => {
    const a = fixture();
    expect(await homeAt(a, "t/b/s1")).toBe("t/a/s1");
    expect((await childrenAt(a, "t/b/s1")).items).toEqual([
      { ...LINE, path: "t/b/s1/L-1", original: "t/a/s1/L-1" },
    ]);
    expect((await wholeAt(a, "t/b/s1/L-1")).path).toBe("t/a/s1/L-1");
    await expect(homeAt(a, "t/zz")).rejects.toMatchObject({ code: "unknown-path" });
  });

  it("rebases rows onto a route, keeping a home row's own path", () => {
    expect(rebase("t/a", [SET])).toEqual([SET]);
    expect(rebase(join("t", "b"), [SET])[0]).toMatchObject({ path: "t/b/s1", original: "t/a/s1" });
  });
});
