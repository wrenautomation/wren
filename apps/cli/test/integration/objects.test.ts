/**
 * `wren objects find` and `wren objects link` against a real Postgres: what `find` prints for a
 * spelling, what `link` moves and prints, and the exit code for an unknown spelling. Synthetic
 * rows only.
 */
import { resolveObject } from "@wren/core/objects";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { Command } from "commander";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { registerObjects } from "../../src/objects.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
}, 240_000);
afterAll(async () => {
  await pg?.stop();
});
afterEach(() => {
  process.exitCode = undefined;
});

/** Runs the command, returns what it printed to stdout and stderr. */
async function wren(...argv: string[]): Promise<{ out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  const error = vi.spyOn(console, "error").mockImplementation((...a) => {
    err.push(a.join(" "));
  });
  try {
    const program = new Command().exitOverride();
    registerObjects(program, { withDb: (fn) => fn(pg.db), by: "tester" });
    await program.parseAsync(["objects", ...argv], { from: "user" });
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  return { out, err };
}

describe("wren objects", () => {
  it("finds an object by an alias and lists the rows that name it", async () => {
    await resolveObject(pg.db, {
      platform: "linkedin",
      kind: "post",
      raw: "urn:li:activity:11",
      url: "https://www.linkedin.com/posts/example-person_words-activity-11-aB1c",
    });
    await pg.db.execute(sql`insert into reach_posts (platform, ref, author, text, url, found_by, account, raw)
      values ('linkedin', 'urn:li:activity:11', 'Example Author', 'a post', 'https://example.com/p', 'topic: test',
        'linkedin@test', '{}')`);

    const { out } = await wren("find", "urn:li:activity:11", "--platform", "linkedin");
    expect(out[0]).toBe("linkedin urn:li:activity:11  post");
    expect(out).toContain("named by");
    expect(out.some((l) => /^ {2}reach_posts\.ref {2}1 {2}id \d+$/.test(l))).toBe(true);

    const { out: json } = await wren("find", "urn:li:activity:11", "--json");
    const parsed = JSON.parse(json.join("\n"));
    expect(parsed.object.ref).toBe("urn:li:activity:11");
    expect(parsed.rows[0]).toMatchObject({ table: "reach_posts", column: "ref", count: 1 });
  });

  it("links two spellings, prints what moved, and finds the object by the old one", async () => {
    const { out } = await wren("link", "linkedin", "urn:li:activity:11", "urn:li:ugcPost:22");
    expect(out).toEqual([
      "linkedin: kept urn:li:ugcPost:22, dropped urn:li:activity:11",
      "  reach_posts.ref  moved 1, folded 0",
    ]);
    const found = await wren("find", "urn:li:activity:11");
    expect(found.out[0]).toBe("linkedin urn:li:ugcPost:22  post");
    expect(found.out).toContain("  urn:li:activity:11");

    const again = await wren("link", "linkedin", "urn:li:activity:11", "urn:li:ugcPost:22");
    expect(again.out).toEqual([
      "linkedin: both spellings already name urn:li:ugcPost:22; nothing moved",
    ]);
  });

  it("says so and sets the exit code for a spelling no object holds", async () => {
    const { out, err } = await wren("find", "urn:li:activity:999");
    expect(out).toEqual([]);
    expect(err).toEqual(["no object holds: urn:li:activity:999"]);
    expect(process.exitCode).toBe(1);
  });
});
