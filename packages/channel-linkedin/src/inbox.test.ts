import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { type InboxNote, IngestError, ingestNotes, moveToDone, readInbox } from "./inbox.js";

async function inbox(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "inbox-"));
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
  return dir;
}

describe("readInbox", () => {
  it("pairs same-stem and -N images with their note", async () => {
    const dir = await inbox({
      "monday.md": "hi",
      "monday.png": "",
      "monday-2.jpg": "",
      "other.png": "",
    });
    const [note] = await readInbox(dir);
    expect(note?.imagePaths.map((p) => basename(p))).toEqual(["monday-2.jpg", "monday.png"]);
  });
  it("gives each image exactly one owner, longest stem wins", async () => {
    const dir = await inbox({
      "monday.md": "a",
      "monday-2.md": "b",
      "monday-2.png": "",
      "monday.png": "",
    });
    const notes = await readInbox(dir);
    const byName = Object.fromEntries(
      notes.map((n) => [basename(n.path), n.imagePaths.map((p) => basename(p))]),
    );
    expect(byName).toEqual({ "monday-2.md": ["monday-2.png"], "monday.md": ["monday.png"] });
  });
  it("skips empty notes and returns [] for a missing dir", async () => {
    const dir = await inbox({ "empty.md": "  \n", "real.md": "x" });
    expect((await readInbox(dir)).map((n) => basename(n.path))).toEqual(["real.md"]);
    expect(await readInbox(join(dir, "nope"))).toEqual([]);
  });
  it("ignores subdirectories such as done/", async () => {
    const dir = await inbox({ "a.md": "a" });
    await mkdir(join(dir, "done"));
    await writeFile(join(dir, "done", "old.md"), "old");
    expect((await readInbox(dir)).length).toBe(1);
  });
});

describe("ingestNotes", () => {
  const note = (p: string): InboxNote => ({ path: p, body: p, imagePaths: [] });
  it("inserts then moves, in order, and counts", async () => {
    const log: string[] = [];
    const n = await ingestNotes([note("a"), note("b")], {
      insert: async (x) => void log.push(`insert ${x.path}`),
      move: async (x) => void log.push(`move ${x.path}`),
    });
    expect(n).toBe(2);
    expect(log).toEqual(["insert a", "move a", "insert b", "move b"]);
  });
  it("stops at the first failed move; earlier notes stay ingested", async () => {
    const inserted: string[] = [];
    await expect(
      ingestNotes([note("a"), note("b"), note("c")], {
        insert: async (x) => void inserted.push(x.path),
        move: async (x) => {
          if (x.path === "b") throw new IngestError("stuck b");
        },
      }),
    ).rejects.toThrow("stuck b");
    expect(inserted).toEqual(["a", "b"]);
  });
});

describe("moveToDone", () => {
  it("moves the note and its images into done/", async () => {
    const dir = await inbox({ "n.md": "x", "n.png": "" });
    const [note] = await readInbox(dir);
    if (!note) throw new Error("no note");
    await moveToDone(dir, note);
    expect((await readdir(join(dir, "done"))).sort()).toEqual(["n.md", "n.png"]);
    expect(await readdir(dir)).toEqual(["done"]);
  });
  it("wraps a failed rename in IngestError naming the file", async () => {
    const dir = await inbox({});
    const ghost = { path: join(dir, "ghost.md"), body: "x", imagePaths: [] };
    await expect(moveToDone(dir, ghost)).rejects.toThrow(/ghost\.md/);
  });
});
