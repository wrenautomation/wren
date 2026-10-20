/**
 * `wren shape` history commands on a real Postgres (designs/2026-10-19-business-map.md, "History
 * like git"): drafts, diff keys, blame, undo with a preview, tags, versions with their tags and
 * commits, and the mirror line after each save. The private repo is a fake that keeps its commits.
 * Synthetic data only.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import type { GithubFiles } from "@wren/core/github";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { mirrorShapes } from "@wren/pipeline/mirror";
import type { ShapeBody } from "@wren/pipeline/model";
import { exportShape } from "@wren/pipeline/shape-file";
import { Command } from "commander";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { registerShape } from "../../src/shape.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
}, 240_000);
afterAll(async () => {
  await pg?.stop();
});
afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

/** The private repo: null while the mirror is off. */
let files: GithubFiles | null = null;
const commits: Array<{ path: string; message: string }> = [];
let breakWrites = false;
const fakeFiles = (): GithubFiles => ({
  read: async () => null,
  write: async (path, _text, message) => {
    if (breakWrites) throw new Error("repo gone");
    commits.push({ path, message });
    return `c0ffee${commits.length}0000`;
  },
  lastCommit: async () => null,
});

const program = () => {
  const p = new Command("wren").exitOverride().configureOutput({ writeErr: () => {} });
  registerShape(p, {
    withDb: (fn) => fn(pg.db),
    writes: undefined,
    mirror: (db) => mirrorShapes(db, { files, repo: "o/shapes", workspace: "wren", log: () => {} }),
    mirrorAll: async () => [
      {
        workspace: "wren",
        result: await mirrorShapes(pg.db, { files, repo: "o/shapes", workspace: "wren" }),
      },
    ],
  });
  return p;
};

/** Run one command; its output lines, then its error lines. */
async function run(...argv: string[]): Promise<{ out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.join(" ")));
  await program().parseAsync(["shape", ...argv], { from: "user" });
  vi.restoreAllMocks();
  return { out, err };
}

const base: ShapeBody = {
  name: "History shape",
  nodes: [
    { id: "manual", kind: "source", name: "Manual", via: "manual" },
    {
      id: "engaged",
      kind: "step",
      name: "Engaged",
      action: "reply",
      advance: [{ trigger: "trigger.reply" }],
    },
  ],
  edges: [{ id: "manual_to_engaged", from: "manual", to: "engaged", kind: "flow" }],
};
const withCall: ShapeBody = {
  ...base,
  nodes: [
    ...base.nodes,
    {
      id: "call",
      kind: "step",
      name: "Call",
      action: "book",
      advance: [{ trigger: "trigger.booking" }],
    },
  ],
  edges: [...base.edges, { id: "engaged_to_call", from: "engaged", to: "call", kind: "flow" }],
};

const dir = mkdtempSync(join(tmpdir(), "wren-shape-history-"));
const fileOf = (name: string, body: ShapeBody, extra = "") => {
  const path = join(dir, name);
  writeFileSync(path, exportShape(body) + extra);
  return path;
};

describe("wren shape history", () => {
  it("says mirror off after a save while the mirror has no repo", async () => {
    const r = await run("import", fileOf("base.yaml", base), "--note", "first");
    expect(r.out).toEqual(["v1 saved", "mirror off"]);
    // Nothing changed: no save, so no mirror line.
    expect((await run("import", fileOf("base.yaml", base))).out).toEqual(["no change"]);
  });

  it("keeps a draft until it is applied, and the apply mirrors every missing version", async () => {
    files = fakeFiles();
    const made = await run(
      "draft",
      "new",
      fileOf("call.yaml", withCall, "note: Add the call step\n"),
      "--name",
      "Add a call",
    );
    expect(made.out).toEqual(["draft add-a-call saved on v1"]);
    expect((await run("draft", "list")).out[0]).toMatch(/^add-a-call {2}draft {2}v1 {2}\d{4}-/);

    const shown = (await run("draft", "show", "add-a-call")).out;
    expect(shown[1]).toBe("Add the call step");
    expect(shown).toContain("+ node call");
    expect(shown).toContain("+ edge engaged_to_call");

    expect((await run("draft", "propose", "add-a-call")).out).toEqual([
      "draft add-a-call proposed",
    ]);
    expect((await run("draft", "list", "--state", "draft")).out).toEqual(["no drafts"]);
    expect((await run("draft", "list", "--state", "proposed")).out).toHaveLength(1);

    const applied = await run("draft", "apply", "add-a-call");
    expect(applied.out).toEqual([
      "v2 saved from draft add-a-call",
      "mirrored v1 c0ffee1",
      "mirrored v2 c0ffee2",
    ]);
    expect(commits.map((c) => c.message.split("\n")[0])).toEqual([
      "shape wren v1: first",
      "shape wren v2: Add the call step",
    ]);
    expect((await run("draft", "list")).out).toEqual(["no drafts"]);
    expect((await run("draft", "list", "--state", "all")).out[0]).toMatch(/add-a-call {2}applied/);
    expect((await run("draft", "show", "add-a-call")).out).toContain(`applied as v2 by ${who()}`);
  });

  it("drops a draft with a reason and refuses to touch it after", async () => {
    await run(
      "draft",
      "new",
      fileOf("rename.yaml", { ...base, name: "Renamed" }),
      "--name",
      "Rename",
    );
    expect((await run("draft", "drop", "rename", "--reason", "not needed")).out).toEqual([
      "draft rename dropped",
    ]);
    const again = await run("draft", "propose", "rename");
    expect(again.err).toEqual(['The draft "rename" is dropped. Only a draft can be proposed.']);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    const none = await run("draft", "show", "nothing");
    expect(none.err).toEqual(['There is no draft "nothing".']);
    process.exitCode = undefined;
  });

  it("prints each diff line with its change key", async () => {
    const r = await run("diff", "1", "2");
    expect(r.out).toEqual([
      "+ node call  [node:call:added]",
      "+ edge engaged_to_call  [edge:engaged_to_call:added]",
    ]);
  });

  it("blames a node and an edge, newest first", async () => {
    const node = (await run("blame", "call")).out;
    expect(node).toHaveLength(1);
    expect(node[0]).toMatch(/^v2 {2}\d{4}-\d\d-\d\d {2}\S+ {2}added {2}Add the call step$/);
    expect((await run("blame", "engaged_to_call", "--edge")).out).toHaveLength(1);
    expect((await run("blame", "nothing")).out).toEqual(["no history for nothing"]);
  });

  it("previews an undo without saving, then saves it and mirrors", async () => {
    const preview = await run("undo", "1", "2", "node:call:added", "--preview");
    expect(preview.out.slice(0, 3)).toEqual([
      "undo: Added node Call.",
      "note: Undo: Added node Call.",
      "applies to v2",
    ]);
    expect(preview.out).toContain("- node call");
    expect((await run("versions")).out.filter((l) => l.startsWith("v"))).toHaveLength(2);

    const done = await run("undo", "1", "2", "node:call:added");
    expect(done.out).toEqual(["v3 saved", "mirrored v3 c0ffee3"]);
    expect(commits[2]?.message).toMatch(/^shape wren v3: Undo: Added node Call\./);

    // The change is gone: the second undo is refused and saves nothing.
    const second = await run("undo", "1", "2", "node:call:added");
    expect(second.out).toEqual([]);
    expect(second.err.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    const bad = await run("undo", "1", "2", "bogus", "--preview");
    expect(bad.err[0]).toMatch(/names no change/);
    process.exitCode = undefined;
  });

  it("tags a version once, lists tags, and shows tags and commits on versions", async () => {
    expect((await run("tag", "with-call", "2", "--note", "the call step")).out).toEqual([
      "tag with-call on v2",
    ]);
    const dup = await run("tag", "with-call", "3");
    expect(dup.err).toEqual(['The tag "with-call" is on version 2.']);
    process.exitCode = undefined;
    const tags = (await run("tags")).out;
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatch(/^with-call {2}v2 {2}\d{4}-\d\d-\d\d {2}\S+ {2}the call step$/);
    const versions = (await run("versions")).out;
    expect(versions[0]).toMatch(/^v1 .* first {2}c0ffee1$/);
    expect(versions[1]).toMatch(/^v2 .* Add the call step {2}\[with-call\] {2}c0ffee2$/);
    expect(versions[2]).toMatch(/^v3 .* Undo: Added node Call\. {2}c0ffee3$/);
  });

  it("runs the mirror by hand, and a broken repo never fails a save", async () => {
    expect((await run("mirror")).out).toEqual(["up to date"]);
    expect((await run("mirror", "--all")).out).toEqual(["wren: up to date"]);
    breakWrites = true;
    const saved = await run(
      "add-node",
      "won",
      "--kind",
      "step",
      "--name",
      "Won",
      "--action",
      "reply",
      "--from",
      "engaged",
      "--advance",
      "trigger.booking",
      "--note",
      "closing",
    );
    expect(saved.out[0]).toBe("v4 saved");
    expect(saved.out[1]).toBe("mirror failed: v4: repo gone");
    expect(process.exitCode).toBeUndefined();
    breakWrites = false;
    expect((await run("mirror")).out).toEqual(["mirrored v4 c0ffee4"]);
  });
});

const who = () => userInfo().username;
