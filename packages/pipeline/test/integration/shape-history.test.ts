/**
 * The shape's history routes on a real Postgres (designs/2026-10-19-business-map.md, "History
 * like git"): drafts, a diff against a draft, blame, undo, tags and the mirror step. Who may do
 * what, and that a refusal reads as a portal refusal. Synthetic data only.
 */
import { addClient, addMember, addOperator } from "@wren/core/clients";
import type { GithubFiles } from "@wren/core/github";
import type { Viewer } from "@wren/core/portal";
import { resolveProfile } from "@wren/core/profiles";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pipelineConsoleApi, saveThenMirror } from "../../src/console.js";
import type { ShapeBody } from "../../src/model.js";
import { journeys } from "../../src/schema.js";
import { Refused, shapeVersionsOf } from "../../src/store.js";
import { flow } from "../fixtures.js";

let pg: TestPostgres;
const OWNER = "owner@acme.example.test";
const VAL = "val@acme.example.test";
const ADA = "ada@example.test";
const as = (email: string, client?: string, operator = false) => ({
  viewer: { email, ...(operator ? { operator: true } : {}) } as Viewer,
  ...(client ? { client } : {}),
});
const op = () => as(ADA, undefined, true);

/** A GitHub that keeps what is written to it. */
function fakeFiles() {
  const commits: Array<{ path: string; text: string; message: string }> = [];
  const files: GithubFiles = {
    read: async () => null,
    write: async (path, text, message) => {
      commits.push({ path, text, message });
      return `sha${commits.length}`;
    },
    lastCommit: async () => null,
  };
  return { commits, files };
}
const github = fakeFiles();
const api = () =>
  pipelineConsoleApi({
    db: pg.db,
    open: () => pg.db,
    shapes: { files: github.files, repo: "o/shapes" },
  });

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
  edges: [flow("manual", "engaged")],
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
  edges: [...base.edges, flow("engaged", "call")],
};

beforeAll(async () => {
  pg = await startTestPostgres({ own: true });
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme Plumbing", products: {} });
  await addMember(pg.db, "acme", OWNER, { role: "owner" });
  await addMember(pg.db, "acme", VAL, { role: "viewer" });
  await addOperator(pg.db, ADA);
});
afterAll(() => pg.stop());

describe("drafts through the console", () => {
  it("saves a draft, lists it, compares it with a version, and applies it", async () => {
    const a = api();
    expect(await a.shapeVersion({ ...op(), note: "first", body: base })).toEqual({ version: 1 });
    expect(await a.shapeDraftNew({ ...op(), name: "Add a call", body: withCall })).toEqual({
      id: "add-a-call",
      base: 1,
    });

    const list = await a.recordsList({ ...op(), record: "pipeline.shape_draft", view: "open" });
    expect(list.rows.map((r) => [r.id, r.state])).toEqual([["add-a-call", "draft"]]);
    const got = await a.recordsGet({ ...op(), record: "pipeline.shape_draft", id: "add-a-call" });
    expect(got.detail).toMatchObject({ body: { name: "History shape" }, moves: {} });

    // A draft against the live version: the call node and its edge are new.
    const diff = await a.shapeDiff({ ...op(), a: 1, b: "draft:add-a-call" });
    expect(diff).toMatchObject({ a: 1, b: "draft:add-a-call" });
    expect(diff.diff.nodes.added).toEqual(["call"]);
    expect(diff.bodies[1].nodes.map((n) => n.id)).toContain("call");
    await expect(a.shapeDiff({ ...op(), a: 1, b: "draft:none" })).rejects.toThrow(
      /no draft "none"/,
    );
    await expect(a.shapeDiff({ ...op(), a: 1, b: "later" as never })).rejects.toMatchObject({
      status: 400,
    });

    expect(await a.shapeDraftPropose({ ...op(), id: "add-a-call" })).toEqual({
      id: "add-a-call",
      state: "proposed",
    });
    const proposed = await a.recordsList({
      ...op(),
      record: "pipeline.shape_draft",
      view: "proposed",
    });
    expect(proposed.rows).toHaveLength(1);
    expect(await a.shapeDraftApply({ ...op(), id: "add-a-call" })).toEqual({
      id: "add-a-call",
      version: 2,
    });
    const after = await a.recordsList({ ...op(), record: "pipeline.shape_draft", view: "open" });
    expect(after.rows).toEqual([]);
    const versions = await shapeVersionsOf(pg.db);
    expect(versions.map((v) => [v.number, v.draft])).toEqual([
      [1, null],
      [2, "add-a-call"],
    ]);
  });

  it("updates and drops a draft, and refuses a viewer", async () => {
    const a = api();
    await a.shapeDraftNew({ ...op(), name: "Try a rename", body: { ...base, name: "Renamed" } });
    const u = await a.shapeDraftUpdate({
      ...op(),
      id: "try-a-rename",
      body: { ...base, name: "Renamed twice" },
      note: "second try",
    });
    expect(u.id).toBe("try-a-rename");
    await expect(a.shapeDraftDrop({ ...op(), id: "try-a-rename", reason: " " })).rejects.toThrow(
      /Say why/,
    );
    expect(await a.shapeDraftDrop({ ...op(), id: "try-a-rename", reason: "no need" })).toEqual({
      id: "try-a-rename",
      state: "dropped",
    });
    await expect(
      a.shapeDraftNew({ ...as(VAL, "acme"), name: "Viewer draft", body: base }),
    ).rejects.toThrow(/can't do that/);
    await expect(a.shapeDraftApply({ ...as(VAL, "acme"), id: "add-a-call" })).rejects.toThrow(
      /can't do that/,
    );
    // A viewer reads the drafts, as they read the shape.
    const rows = await a.recordsList({
      ...as(VAL, "acme"),
      record: "pipeline.shape_draft",
      view: "all",
    });
    expect(rows.rows.length).toBeGreaterThan(0);
    await expect(a.shapeDraftNew({ ...op(), name: "", body: base })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("blame, undo and tags", () => {
  it("blames a node and an edge, one of them at a time", async () => {
    const a = api();
    const node = await a.shapeBlame({ ...op(), node: "call" });
    expect(node.lines).toHaveLength(1);
    expect(node.lines[0]).toMatchObject({ version: 2, how: "added", note: "Draft Add a call" });
    expect(node.lines[0]?.by).toBe(ADA);
    const edge = await a.shapeBlame({ ...op(), edge: "engaged_to_call" });
    expect(edge.lines.map((l) => [l.version, l.how])).toEqual([[2, "added"]]);
    expect((await a.shapeBlame({ ...op(), node: "nothing" })).lines).toEqual([]);
    await expect(a.shapeBlame({ ...op() })).rejects.toThrow(/exactly one/);
    await expect(a.shapeBlame({ ...op(), node: "call", edge: "x" })).rejects.toThrow(/exactly one/);
  });

  it("previews an undo without saving, and refuses every bad key with its reasons", async () => {
    const a = api();
    const p = await a.shapeUndoPreview({ ...op(), a: 1, b: 2, change: "node:call:added" });
    expect(p).toMatchObject({
      line: "Added node Call.",
      note: "Undo: Added node Call.",
      newest: 2,
    });
    expect(p.diff.nodes.removed).toEqual(["call"]);
    expect(p.bodies[1].nodes.map((n) => n.id)).not.toContain("call");
    expect((await shapeVersionsOf(pg.db)).length).toBe(2);

    await expect(
      a.shapeUndoPreview({ ...op(), a: 1, b: 2, change: "bogus" }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("names no change") });
    await expect(
      a.shapeUndoPreview({ ...op(), a: 1, b: 2, change: "node:engaged:renamed" }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("not between these versions"),
    });
    await expect(
      a.shapeUndoPreview({ ...op(), a: 1, b: 9, change: "node:call:added" }),
    ).rejects.toThrow(/no shape version 9/);
  });

  it("refuses to undo an added node while open journeys sit on it", async () => {
    const a = api();
    const profile = (
      await resolveProfile(pg.db, [{ kind: "email", value: "bo@example.test" }], "test")
    )?.id as number;
    const [j] = await pg.db
      .insert(journeys)
      .values({ profileId: profile, version: 2, node: "call", entry: "manual" })
      .returning();
    if (!j) throw new Error("no journey");
    const ask = { ...op(), a: 1, b: 2, change: "node:call:added" };
    await expect(a.shapeUndoPreview(ask)).rejects.toThrow(
      "1 open journey sits on call. Move them first.",
    );
    await expect(a.shapeUndo(ask)).rejects.toMatchObject({ status: 400 });
    expect((await shapeVersionsOf(pg.db)).length).toBe(2);
    await pg.db.update(journeys).set({ status: "dropped" }).where(eq(journeys.id, j.id));
  });

  it("saves an undo as the next version with the note Undo, and a viewer cannot", async () => {
    const a = api();
    const ask = { a: 1, b: 2, change: "node:call:added" };
    await expect(a.shapeUndo({ ...as(VAL, "acme"), ...ask })).rejects.toThrow(/can't do that/);
    expect(await a.shapeUndo({ ...op(), ...ask })).toEqual({ version: 3 });
    const v3 = (await shapeVersionsOf(pg.db)).at(-1);
    expect(v3).toMatchObject({
      number: 3,
      parent: 2,
      note: "Undo: Added node Call.",
      createdBy: ADA,
    });
    expect(v3?.body.nodes.map((n) => n.id)).toEqual(["manual", "engaged"]);
    expect(v3?.body.edges.map((e) => e.id)).toEqual(["manual_to_engaged"]);
    // The change is gone now: undoing it again says so, and nothing is saved.
    await expect(a.shapeUndo({ ...op(), ...ask })).rejects.toMatchObject({ status: 400 });
    expect((await shapeVersionsOf(pg.db)).length).toBe(3);
  });

  it("tags a version once, and shows tags and mirrors on the versions", async () => {
    const a = api();
    expect(
      await a.shapeTag({ ...op(), name: "with-call", version: 2, note: "the call step" }),
    ).toEqual({ name: "with-call", version: 2 });
    await expect(a.shapeTag({ ...op(), name: "with-call", version: 3 })).rejects.toThrow(
      'The tag "with-call" is on version 2.',
    );
    await expect(a.shapeTag({ ...as(VAL, "acme"), name: "mine", version: 1 })).rejects.toThrow(
      /can't do that/,
    );
    const mirrored = await a.mirror(op());
    expect(mirrored).toMatchObject({ committed: [{ version: 1 }, { version: 2 }, { version: 3 }] });
    const got = await a.recordsGet({ ...op(), record: "pipeline.shape", id: "shape" });
    const detail = got.detail as { versions: Array<Record<string, unknown>> };
    expect(detail.versions.map((v) => v.number)).toEqual([3, 2, 1]);
    expect(detail.versions[1]).toMatchObject({
      draft: "add-a-call",
      tags: [{ name: "with-call", note: "the call step", by: ADA }],
      mirror: { sha: "sha2", url: "https://github.com/o/shapes/commit/sha2" },
    });
    expect(detail.versions[0]).toMatchObject({ draft: null, tags: [] });
  });
});

describe("the mirror step", () => {
  it("commits the missing versions to the workspace's file, and is off without a repo", async () => {
    const a = api();
    await a.shapeVersion({ ...op(), note: "renamed", body: { ...base, name: "History shape 2" } });
    const r = await a.mirror(op());
    expect(r).toMatchObject({ committed: [{ version: 4 }] });
    const last = github.commits.at(-1);
    expect(last?.path).toBe("shapes/wren.yaml");
    expect(last?.message).toBe(`shape wren v4: renamed\n\nAuthor: ${ADA}`);
    // A client's file is named by the client.
    const acme = await a.mirror({ ...as(OWNER, "acme") });
    expect(acme).toMatchObject({ committed: [] });

    const off = pipelineConsoleApi({ db: pg.db, open: () => pg.db });
    expect(await off.mirror(op())).toEqual({ off: true });
  });

  it("never fails: a refused viewer or a broken repo comes back as a failure", async () => {
    const failing: GithubFiles = {
      read: async () => null,
      write: async () => {
        throw new Error("repo gone");
      },
      lastCommit: async () => null,
    };
    const a = pipelineConsoleApi({
      db: pg.db,
      open: () => pg.db,
      shapes: { files: failing, repo: "o/shapes" },
    });
    await a.shapeVersion({ ...op(), note: "again", body: { ...base, name: "History shape 3" } });
    const r = await a.mirror(op());
    expect(r).toMatchObject({ committed: [], failed: expect.stringContaining("repo gone") });
    const stranger = await a.mirror(as("nobody@example.test"));
    expect(stranger).toMatchObject({ committed: [], failed: expect.any(String) });
  });
});

describe("save, then mirror", () => {
  const calls: string[] = [];
  const ctx = {
    run: async <T>(name: string, fn: () => Promise<T>) => {
      calls.push(name);
      return fn();
    },
  } as never;
  const req = op();

  it("runs the save, then the mirror, and answers the save", async () => {
    calls.length = 0;
    const api = { mirror: async () => ({ committed: [] }) };
    expect(
      await saveThenMirror(ctx, api, "shape version", req, async () => ({ version: 7 })),
    ).toEqual({
      version: 7,
    });
    expect(calls).toEqual(["shape version", "shape mirror"]);
  });

  it("skips the mirror when the save is refused", async () => {
    calls.length = 0;
    const api = { mirror: async () => ({ committed: [] }) };
    await expect(
      saveThenMirror(ctx, api, "shape undo", req, async () => {
        throw new Refused(["Nothing changed."]);
      }),
    ).rejects.toBeTruthy();
    expect(calls).toEqual(["shape undo"]);
  });
});
