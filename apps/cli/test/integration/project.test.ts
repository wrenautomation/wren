/**
 * `wren project` on a real Postgres (designs/2026-11-13-studio-suite.md, D1, D7): new, list, set,
 * film; an edit holds one project; a dropped edit leaves the project unfilmed. Synthetic rows only.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { videoEdits } from "@wren/starling-studio/schema";
import { Command } from "commander";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inspirationOf, registerProject } from "../../src/project.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
}, 240_000);
afterAll(async () => {
  await pg?.stop();
});

async function wren(...argv: string[]): Promise<unknown> {
  const out: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  try {
    const program = new Command().exitOverride();
    registerProject(program, (fn) => fn(pg.db), "tester");
    await program.parseAsync(["node", "wren", "project", ...argv]);
  } finally {
    log.mockRestore();
  }
  return JSON.parse(out.join("\n"));
}

const edit = async () => {
  const [e] = await pg.db
    .insert(videoEdits)
    .values({
      dir: "/tmp/rec",
      tracks: { main: { file: "/tmp/rec/main.mkv", durationS: 60 } } as never,
    })
    .returning({ id: videoEdits.id });
  return (e as { id: number }).id;
};

describe("wren project", () => {
  it("reads post and canon refs, with a why", () => {
    expect(inspirationOf("post:abc=the hook")).toEqual({
      kind: "post",
      ref: "abc",
      why: "the hook",
    });
    expect(inspirationOf("canon:web-x")).toEqual({ kind: "canon", ref: "web-x" });
    expect(() => inspirationOf("x:1")).toThrow(/post:<id>/);
  });

  it("makes, lists, sets and films a project", async () => {
    const p = (await wren(
      "new",
      "Building my video system",
      "--brief",
      "the meta video",
      "--from",
      "post:p1=pace",
    )) as { id: number; kind: string; by: string; edit: unknown };
    expect(p).toMatchObject({ kind: "long", by: "tester", edit: null });

    const set = (await wren(
      "set",
      String(p.id),
      "--kind",
      "demo",
      "--subject",
      "hook=4",
      "--subject",
      "cta=5",
    )) as { kind: string; subjects: Record<string, number>; inspiration: unknown[] };
    expect(set.kind).toBe("demo");
    expect(set.subjects).toEqual({ hook: 4, cta: 5 });
    expect(set.inspiration).toHaveLength(1);

    const e = await edit();
    const filmed = (await wren("film", String(p.id), String(e))) as {
      edit: { id: number; state: string };
    };
    expect(filmed.edit).toMatchObject({ id: e, state: "added" });

    // an edit holds one project
    const q = (await wren("new", "Another")) as { id: number };
    await expect(wren("film", String(q.id), String(e))).rejects.toThrow(/already belongs/);

    const list = (await wren("list")) as { id: number }[];
    expect(list.map((x) => x.id)).toEqual([q.id, p.id]);

    // the edit goes; the project stays, unfilmed
    await pg.db.execute(sql`delete from video_edits where id = ${e}`);
    expect(((await wren("show", String(p.id))) as { edit: unknown }).edit).toBeNull();
  });

  it("refuses a bad kind and a missing project", async () => {
    await expect(wren("new", "x", "--kind", "film")).rejects.toThrow();
    await expect(wren("show", "999")).rejects.toThrow(/isn't here/);
  });
});
