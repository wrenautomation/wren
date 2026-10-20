/**
 * The shape's git mirror on a real Postgres, against a fake GitHub (a `fetch` that keeps files and
 * commits): oldest version first, the commit message, a stop at the first failure, a retry that
 * lands the rest. Synthetic data only.
 */
import { githubRepo } from "@wren/core/github";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type MirrorResult, mirrorShapes } from "../../src/mirror.js";
import { shapeMirrors } from "../../src/schema.js";
import { exportShape } from "../../src/shape-file.js";
import { saveShape, shapeVersionsOf } from "../../src/store.js";
import { shape, TRIGGERS } from "../fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

/** A GitHub that keeps files and counts commits. `failOn` makes the commit whose message holds it fail. */
function fakeGithub() {
  const files = new Map<string, { text: string; sha: string }>();
  const commits: Array<{ path: string; message: string; sha: string }> = [];
  const state = { failOn: "" };
  const fetchFake = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = decodeURIComponent(
      /\/contents\/([^?]+)/.exec(url)?.[1] ?? /[?&]path=([^&]+)/.exec(url)?.[1] ?? "",
    );
    if (url.includes("/commits?")) {
      const last = [...commits].reverse().find((c) => c.path === path);
      return Response.json(last ? [{ sha: last.sha }] : []);
    }
    if (method === "GET") {
      const f = files.get(path);
      return f
        ? Response.json({ content: Buffer.from(f.text).toString("base64"), sha: f.sha })
        : new Response("{}", { status: 404 });
    }
    const body = JSON.parse(String(init?.body)) as { message: string; content: string };
    if (state.failOn && body.message.includes(state.failOn))
      return Response.json({ message: "Server Error" }, { status: 500 });
    const sha = `c${commits.length + 1}`.padEnd(8, "0");
    files.set(path, { text: Buffer.from(body.content, "base64").toString(), sha: `f${sha}` });
    commits.push({ path, message: body.message, sha });
    return Response.json({ commit: { sha } });
  }) as typeof fetch;
  return {
    files,
    commits,
    state,
    repo: githubRepo({ token: "t", repo: "o/shapes", fetch: fetchFake }),
  };
}

const save = (n: number) => {
  const body = shape({ name: `Mirror shape ${n}` });
  return saveShape(pg.db, {
    body,
    note: `change ${n}`,
    by: "ada@example.test",
    triggers: TRIGGERS,
  });
};
const rows = async () =>
  (await pg.db.select().from(shapeMirrors)).sort((a, b) => a.version - b.version);
const committed = (r: MirrorResult) => (r.off ? [] : r.committed);

describe("mirrorShapes", () => {
  it("is off without files, and says so once per logger", async () => {
    await save(1);
    const log = vi.fn();
    expect(
      await mirrorShapes(pg.db, { files: null, repo: "o/shapes", workspace: "wren", log }),
    ).toEqual({
      off: true,
    });
    await mirrorShapes(pg.db, { files: null, repo: "o/shapes", workspace: "wren", log });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toMatch(/WREN_SHAPES_GITHUB_TOKEN/);
    expect(await rows()).toEqual([]);
  });

  it("commits every version oldest first, with the file and the message, and records the sha", async () => {
    await save(2);
    await save(3);
    const gh = fakeGithub();
    const r = await mirrorShapes(pg.db, { files: gh.repo, repo: "o/shapes", workspace: "wren" });
    expect(r).toEqual({
      committed: [
        { version: 1, sha: "c1000000" },
        { version: 2, sha: "c2000000" },
        { version: 3, sha: "c3000000" },
      ],
    });
    expect(gh.commits.map((c) => c.path)).toEqual(Array(3).fill("shapes/wren.yaml"));
    expect(gh.commits[0]?.message).toBe("shape wren v1: change 1\n\nAuthor: ada@example.test");
    const versions = await shapeVersionsOf(pg.db);
    expect(gh.files.get("shapes/wren.yaml")?.text).toBe(exportShape(versions[2]?.body as never));
    expect(await rows()).toMatchObject([
      { version: 1, repo: "o/shapes", path: "shapes/wren.yaml", sha: "c1000000" },
      { version: 2, sha: "c2000000" },
      { version: 3, sha: "c3000000" },
    ]);
    // Caught up: a second run commits nothing.
    const again = await mirrorShapes(pg.db, {
      files: gh.repo,
      repo: "o/shapes",
      workspace: "wren",
    });
    expect(again).toEqual({ committed: [] });
    expect(gh.commits).toHaveLength(3);
  });

  it("names a client's file by its workspace, and keeps a note to one line", async () => {
    await pg.db.delete(shapeMirrors);
    await saveShape(pg.db, {
      body: shape({ name: "Mirror shape 9" }),
      note: "first line\nsecond   line",
      by: "ada@example.test",
      triggers: TRIGGERS,
    });
    const gh = fakeGithub();
    const r = await mirrorShapes(pg.db, { files: gh.repo, repo: "o/shapes", workspace: "acme" });
    expect(committed(r).length).toBeGreaterThan(0);
    expect(gh.commits.every((c) => c.path === "shapes/acme.yaml")).toBe(true);
    expect(gh.commits.at(-1)?.message.split("\n")[0]).toBe("shape acme v4: first line second line");
  });

  it("stops at the first failure, keeps rows for what landed, and a retry lands the rest", async () => {
    await pg.db.delete(shapeMirrors);
    await save(5);
    await save(6);
    const gh = fakeGithub();
    gh.state.failOn = "v5:";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await mirrorShapes(pg.db, { files: gh.repo, repo: "o/shapes", workspace: "wren" });
    warn.mockRestore();
    expect(committed(r).map((c) => c.version)).toEqual([1, 2, 3, 4]);
    expect(r).toMatchObject({ failed: expect.stringContaining("v5") });
    expect((await rows()).map((x) => x.version)).toEqual([1, 2, 3, 4]);
    expect(gh.commits.map((c) => c.message.split(":")[0])).not.toContain("shape wren v6");

    gh.state.failOn = "";
    const retry = await mirrorShapes(pg.db, {
      files: gh.repo,
      repo: "o/shapes",
      workspace: "wren",
    });
    expect(committed(retry).map((c) => c.version)).toEqual([5, 6]);
    expect(retry).not.toHaveProperty("failed");
    expect((await rows()).map((x) => x.version)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("takes the last commit of the file when the text is already there", async () => {
    await pg.db.delete(shapeMirrors);
    const gh = fakeGithub();
    await mirrorShapes(pg.db, { files: gh.repo, repo: "o/shapes", workspace: "wren" });
    const landed = gh.commits.length;
    // The commit of v6 landed, but its row did not: the retry writes the same text.
    await pg.db.delete(shapeMirrors).where(eq(shapeMirrors.version, 6));
    const r = await mirrorShapes(pg.db, { files: gh.repo, repo: "o/shapes", workspace: "wren" });
    expect(gh.commits).toHaveLength(landed);
    expect(r).toEqual({ committed: [{ version: 6, sha: gh.commits.at(-1)?.sha }] });
    expect((await rows()).map((x) => x.version)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("never throws: a database error comes back as a failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = new Proxy(pg.db, {
      get: () => () => {
        throw new Error("connection lost");
      },
    });
    const gh = fakeGithub();
    const r = await mirrorShapes(broken as never, {
      files: gh.repo,
      repo: "o/shapes",
      workspace: "wren",
    });
    warn.mockRestore();
    expect(r).toMatchObject({ committed: [], failed: expect.stringContaining("connection lost") });
  });
});
