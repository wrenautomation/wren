import { Command, CommanderError } from "commander";
import { describe, expect, it } from "vitest";
import { guardClient } from "./client-scope.js";
import { linkLines, objectLines, registerObjects } from "./objects.js";

/**
 * `wren objects …`: `withDb` records the client it was asked for and stops, so no database opens.
 * main.ts's `withDb` reads the same `program.opts().client`.
 */
const program = () => {
  const asked: Array<string | undefined> = [];
  const p = new Command("wren")
    .option("--client <id>", "run against this client's database")
    .exitOverride()
    .configureOutput({ writeErr: () => {}, writeOut: () => {} });
  guardClient(p);
  registerObjects(p, {
    withDb: async () => {
      asked.push(p.opts<{ client?: string }>().client);
      throw new Error("stop: no database in this test");
    },
    by: "tester",
  });
  p.command("status").action(() => {});
  return { p, asked };
};

const run = (args: string[]) => {
  const t = program();
  return { ...t, done: t.p.parseAsync(args, { from: "user" }) };
};

const found = {
  platform: "linkedin",
  ref: "urn:li:ugcPost:22",
  kind: "post",
  post: null,
  parent: null,
  url: "https://linkedin.com/posts/example-person_words-activity-11-aB1c",
  author: "example-author",
  at: null,
  firstSeen: new Date("2026-10-02T12:00:00Z"),
  lastSeen: new Date("2026-10-05T09:30:00Z"),
  aliases: ["urn:li:activity:11"],
} as never;

describe("wren objects", () => {
  it("opens the client's database for find and link", async () => {
    for (const args of [
      ["objects", "find", "t3_abc"],
      ["objects", "find", "abc", "--platform", "reddit"],
      ["objects", "link", "reddit", "abc", "def"],
    ]) {
      const { asked, done } = run(["--client", "acme", ...args]);
      await expect(done, args.join(" ")).rejects.toThrow(/^stop/);
      expect(asked, args.join(" ")).toEqual(["acme"]);
    }
  });

  it("asks for Wren's own database without --client", async () => {
    const { asked, done } = run(["objects", "find", "t3_abc"]);
    await expect(done).rejects.toThrow(/^stop/);
    expect(asked).toEqual([undefined]);
  });

  it("refuses an unknown platform before it opens a database", async () => {
    const { asked, done } = run(["objects", "link", "myspace", "a", "b"]);
    await expect(done).rejects.toBeInstanceOf(CommanderError);
    expect(asked).toEqual([]);
  });

  it("needs both spellings", async () => {
    const { done } = run(["objects", "link", "reddit", "abc"]);
    await expect(done).rejects.toBeInstanceOf(CommanderError);
  });

  it("is not refused under --client", async () => {
    const { done } = run(["--client", "acme", "objects", "find", "x"]);
    await expect(done).rejects.not.toThrow(/does not take --client/);
  });
});

describe("output", () => {
  it("prints the object, its aliases and the rows that name it", () => {
    expect(
      objectLines(found, [
        { table: "reach_posts", column: "ref", count: 1, ids: ["7"] },
        { table: "comments", column: "post", count: 25, ids: ["1", "2"] },
      ]),
    ).toEqual([
      "linkedin urn:li:ugcPost:22  post",
      "  first seen 2026-10-02 12:00, last seen 2026-10-05 09:30",
      "  author example-author",
      "  url https://linkedin.com/posts/example-person_words-activity-11-aB1c",
      "aliases (1)",
      "  urn:li:activity:11",
      "named by",
      "  reach_posts.ref  1  id 7",
      "  comments.post  25  id 1, 2, ...",
    ]);
    expect(objectLines(found, []).at(-1)).toBe("named by no row");
  });

  it("prints what a link moved", () => {
    expect(
      linkLines({
        platform: "linkedin",
        kept: "urn:li:ugcPost:22",
        dropped: "urn:li:activity:11",
        moves: [{ table: "reach_posts", column: "ref", moved: 0, folded: 1 }],
      }),
    ).toEqual([
      "linkedin: kept urn:li:ugcPost:22, dropped urn:li:activity:11",
      "  reach_posts.ref  moved 0, folded 1",
    ]);
    expect(linkLines({ platform: "reddit", kept: "t3_p1", dropped: null, moves: [] })).toEqual([
      "reddit: both spellings already name t3_p1; nothing moved",
    ]);
  });
});
