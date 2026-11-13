/**
 * Canon as paths on a real Postgres: the root, a topic's layers, a borrowed set as an alias, a
 * line's backing, a reference's backs, record pages, the file tree, find, the stamp, redirects
 * for a set and a topic retired `into` another, the Map's edges and lines, and the errors before a sync.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Adapter,
  allChildren,
  childrenAt,
  homeAt,
  lineAt,
  mapAt,
  walk,
  wholeAt,
} from "@wren/core/paths";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { syncCanonIndex } from "@wren/research/canon-index";
import { write } from "@wrenautomation/knowledge";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonPaths } from "../../src/canon.js";

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();
const REMOTE = "https://github.com/example-org/canon.git";
const T = "canon/topics/video-editing";
const FILLERS = 51;

let pg: TestPostgres;
let a: Adapter;
let head: string;
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "canon-paths-"));
  dirs.push(d);
  return d;
};
const put = (root: string, path: string, text: string | Buffer) => {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
};
const paths = (items: { path: string }[]) => items.map((i) => i.path);

beforeAll(async () => {
  pg = await startTestPostgres({ own: true });
  const repo = tmp();
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "t@example.com"]);
  git(repo, ["config", "user.name", "t"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  put(repo, "knowledge.json", JSON.stringify({ owner: "ana" }));
  const me = { by: "agent-1", why: "test" };
  await write(
    repo,
    [
      {
        op: "add",
        type: "source",
        id: "youtube-abc12345678",
        title: "A talk",
        kind: "video",
        url: "https://youtube.com/watch?v=abc12345678",
        tags: ["reference"],
      },
      {
        op: "add",
        type: "source",
        id: "web-example-com",
        title: "A page",
        kind: "page",
        url: "https://example.com/",
      },
      {
        op: "add",
        type: "finding",
        id: "cuts-land-on-the-beat",
        title: "Cuts land on the beat",
        source: "youtube-abc12345678",
        cites: ["youtube-abc12345678"],
        body: "Every cut sits on a kick.",
      },
      // one more than a page of findings
      ...Array.from({ length: FILLERS - 1 }, (_, i) => ({
        op: "add" as const,
        type: "finding" as const,
        id: `filler-${i}`,
        title: `Filler ${i}`,
        source: "web-example-com",
        cites: ["web-example-com"],
        body: "x",
      })),
    ],
    me,
  );
  await write(
    repo,
    [
      {
        op: "add",
        type: "rule",
        id: "video-editing-cuts",
        title: "Cuts",
        topic: "video-editing",
        prefix: "VC",
        cites: ["cuts-land-on-the-beat"],
        body: "# Cuts\n\n- **VC-1** Cut on the beat. [1]\n- **VC-2** Hold the first frame. [notes]\n",
      },
      {
        op: "add",
        type: "rule",
        id: "video-editing-old",
        title: "Old cuts",
        topic: "video-editing",
        prefix: "VO",
        cites: ["cuts-land-on-the-beat"],
        body: "# Old cuts\n\n- **VO-1** Cut on the beat. [1]\n",
      },
      {
        op: "add",
        type: "rule",
        id: "writing-tells-copy",
        title: "Copy",
        topic: "writing-tells",
        prefix: "WC",
        cites: ["web-example-com"],
        body: "# Copy\n\n- **WC-1** No dashes. [1]\n",
      },
    ],
    me,
  );
  await write(
    repo,
    [
      {
        op: "add",
        type: "guide",
        id: "video-editing",
        title: "Video editing",
        topic: "video-editing",
        description: "Edit a video well.",
        cites: ["video-editing-cuts", "writing-tells-copy"],
        body: "# Video editing\n\n1. Cut on the beat [1].\n",
      },
      {
        op: "add",
        type: "guide",
        id: "old-editing",
        title: "Old editing",
        topic: "old-editing",
        description: "Folded into video editing.",
        body: "# Old editing\n",
      },
      {
        op: "add",
        type: "conflict",
        id: "conflict-cuts",
        title: "Cuts disagree",
        topic: "video-editing",
        state: "open",
        lines: ["VC-1"],
        cites: ["web-example-com"],
        body: "A says one thing [1].",
      },
    ],
    me,
  );
  // a rename and a fold, named after the retire
  await write(
    repo,
    [
      { op: "retire", id: "video-editing-old", into: "video-editing-cuts" },
      { op: "retire", id: "old-editing", into: "video-editing" },
    ],
    me,
  );
  put(
    repo,
    "topics/video-editing/SKILL.md",
    "---\nname: sop-video-editing\n---\n\nFollow this SOP.",
  );
  put(repo, "topics/video-editing/notes.md", "# Notes\n\nKeep the music under the voice.");
  put(repo, "topics/video-editing/refs/board.pdf", Buffer.from([37, 80, 68, 70, 0, 1]));
  put(repo, "topics/writing-tells/checks/tells.sh", "#!/bin/sh\necho ok\n");
  put(repo, "direction/2026-11-12-brand.md", "# Personal brand\n\nYouTube first.");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  head = git(repo, ["rev-parse", "HEAD"]);
  await syncCanonIndex(pg.db, pg.url, "canon", { dir: tmp(), remote: repo, token: null });
  a = canonPaths(pg.db, REMOTE, null);
});
afterAll(async () => {
  await pg.stop();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("canonPaths", () => {
  it("opens on four areas", async () => {
    expect((await a.children("canon")).items).toEqual([
      { path: "canon/topics", name: "Topics", kind: "area", count: 2 },
      { path: "canon/references", name: "References", kind: "area", count: 1 },
      { path: "canon/records", name: "Records", kind: "area", count: 8 + FILLERS },
      { path: "canon/files", name: "Files", kind: "area", count: 2 },
    ]);
    expect(paths((await a.children("canon/topics")).items)).toEqual([
      T,
      "canon/topics/writing-tells",
    ]);
  });

  it("lists a topic by layer, a borrowed set as an alias from its owner", async () => {
    expect((await childrenAt(a, T)).items.map((i) => [i.name, i.count ?? null])).toEqual([
      ["Skill", null],
      ["Procedure", null],
      ["Rule sets", 2],
      ["References", 1],
      ["Evidence", 1],
      ["Notes", null],
      ["Conflicts", 1],
      ["Files", 1],
    ]);
    expect((await childrenAt(a, `${T}/sets`)).items).toEqual([
      {
        path: `${T}/sets/video-editing-cuts`,
        name: "video-editing-cuts",
        sub: "Cuts",
        kind: "set",
        count: 2,
      },
      expect.objectContaining({
        path: `${T}/sets/writing-tells-copy`,
        original: "canon/topics/writing-tells/sets/writing-tells-copy",
        from: "writing-tells",
      }),
    ]);
    // the alias walks to the owner's line
    expect(await homeAt(a, `${T}/sets/writing-tells-copy/WC-1`)).toBe(
      "canon/topics/writing-tells/sets/writing-tells-copy/WC-1",
    );
    expect((await wholeAt(a, `${T}/skill`)).body).toContain("Follow this SOP.");
    expect((await wholeAt(a, `${T}/guide`)).links).toEqual([
      expect.objectContaining({
        rel: "cites",
        dir: "out",
        items: [expect.anything(), expect.anything()],
      }),
    ]);
  });

  it("shows what backs a line, and what a reference backs", async () => {
    const line = `${T}/sets/video-editing-cuts/VC-1`;
    expect((await childrenAt(a, line)).items).toEqual([
      { path: `${line}/backed-by`, name: "Backed by", kind: "relation", count: 1 },
    ]);
    const whole = await wholeAt(a, line);
    expect(whole.body).toBe("Cut on the beat.");
    expect(whole.links).toEqual([
      expect.objectContaining({
        rel: "backed-by",
        dir: "in",
        items: [
          expect.objectContaining({
            original: "canon/references/youtube-abc12345678",
            kind: "reference",
          }),
        ],
      }),
    ]);
    const ref = "canon/references/youtube-abc12345678";
    expect(paths((await childrenAt(a, ref)).items)).toEqual([`${ref}/backs`, `${ref}/cited-by`]);
    expect((await childrenAt(a, `${ref}/backs`)).items).toEqual([
      expect.objectContaining({ path: `${ref}/backs/VC-1`, original: line, kind: "line" }),
    ]);
    // a relation route reads at the line's home
    expect(await homeAt(a, `${ref}/backs/VC-1`)).toBe(line);
  });

  it("pages records, and lists the file trees", async () => {
    const first = await a.children("canon/records/finding");
    expect(first.items).toHaveLength(50);
    expect(first.next).toBe("50");
    const second = await a.children("canon/records/finding", first.next);
    expect(second.items).toHaveLength(1);
    expect(second.next).toBeUndefined();
    expect(await allChildren(a, "canon/records/finding")).toHaveLength(FILLERS);
    // a live set's row under records leads to its topic
    expect((await childrenAt(a, "canon/records/rule")).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "canon/records/rule/video-editing-cuts",
          original: `${T}/sets/video-editing-cuts`,
        }),
      ]),
    );

    expect((await a.children("canon/files")).items).toEqual([
      { path: "canon/files/direction", name: "direction", kind: "folder", count: 1 },
      expect.objectContaining({ path: "canon/files/knowledge.json", kind: "file", leaf: true }),
    ]);
    expect((await wholeAt(a, "canon/files/direction/2026-11-12-brand.md")).body).toContain(
      "YouTube first.",
    );
    expect(paths((await childrenAt(a, `${T}/files/refs`)).items)).toEqual([
      `${T}/files/refs/board.pdf`,
    ]);
    expect(paths((await childrenAt(a, "canon/topics/writing-tells/checks")).items)).toEqual([
      "canon/topics/writing-tells/checks/tells.sh",
    ]);
    expect((await wholeAt(a, "canon/topics/writing-tells/checks/tells.sh")).body).toContain(
      "echo ok",
    );
  });

  it("finds by name or id, under a path, and stamps the head it read", async () => {
    expect(paths(await a.find("cuts"))).toEqual(
      expect.arrayContaining([
        `${T}/sets/video-editing-cuts`,
        "canon/records/finding/cuts-land-on-the-beat",
        "canon/records/conflict/conflict-cuts",
        // retired: last, under records
        "canon/records/rule/video-editing-old",
      ]),
    );
    expect((await a.find("cuts")).at(-1)).toMatchObject({ mark: "retired" });
    expect(paths(await a.find("cuts", "canon/records/finding"))).toEqual([
      "canon/records/finding/cuts-land-on-the-beat",
    ]);
    expect(paths(await a.find("brand"))).toEqual(["canon/files/direction/2026-11-12-brand.md"]);
    expect(await a.stamp?.()).toEqual({ root: "canon", head });
  });

  it("sends a retired set and a folded topic to what took their place", async () => {
    const set = await walk(a, `${T}/sets/video-editing-old`);
    expect(set.error).toBeUndefined();
    expect(set.steps.at(-1)?.item).toMatchObject({
      path: `${T}/sets/video-editing-cuts`,
      kind: "set",
      was: `${T}/sets/video-editing-old`,
    });
    expect(await homeAt(a, `${T}/sets/video-editing-old/VC-2`)).toBe(
      `${T}/sets/video-editing-cuts/VC-2`,
    );

    expect((await walk(a, "canon/topics/old-editing")).steps.at(-1)?.item).toMatchObject({
      path: T,
      was: "canon/topics/old-editing",
    });
    expect(await homeAt(a, "canon/topics/old-editing/guide")).toBe(`${T}/guide`);

    // the retired record still reads, with `into` as a relation
    const old = "canon/records/rule/video-editing-old";
    expect(paths((await childrenAt(a, old)).items)).toEqual([`${old}/into`, `${old}/cites`]);
    expect((await childrenAt(a, `${old}/into`)).items).toEqual([
      expect.objectContaining({
        path: `${old}/into/video-editing-cuts`,
        original: `${T}/sets/video-editing-cuts`,
      }),
    ]);
    expect((await wholeAt(a, "canon/records/guide/old-editing")).links).toEqual([
      expect.objectContaining({
        rel: "into",
        items: [expect.objectContaining({ original: `${T}/guide` })],
      }),
    ]);
  });

  it("refuses a path that is not there", async () => {
    await expect(homeAt(a, "canon/topics/nothing-here")).rejects.toMatchObject({
      code: "unknown-path",
    });
    await expect(homeAt(a, "canon/nope")).rejects.toMatchObject({ code: "unknown-path" });
    expect((await walk(a, `${T}/sets/video-editing-cuts/VC-9`)).error).toMatchObject({
      code: "unknown-path",
      route: `${T}/sets/video-editing-cuts/VC-9`,
    });
    await expect(a.children("canon/records/rule/nobody")).rejects.toMatchObject({
      code: "unknown-path",
    });
  });

  it("links homes for the Map: cites, backs, into; lifts them to the boxes a fold shows", async () => {
    const edges = (await a.edges?.("canon")) ?? [];
    const sets = `${T}/sets`;
    const ref = "canon/references/youtube-abc12345678";
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rel: "cites",
          from: `${T}/guide`,
          to: `${sets}/video-editing-cuts`,
        }),
        expect.objectContaining({
          rel: "cites",
          from: `${T}/guide`,
          to: "canon/topics/writing-tells/sets/writing-tells-copy",
        }),
        expect.objectContaining({ rel: "backs", from: ref, to: `${sets}/video-editing-cuts/VC-1` }),
        expect.objectContaining({
          rel: "into",
          from: "canon/records/rule/video-editing-old",
          to: `${sets}/video-editing-cuts`,
        }),
        expect.objectContaining({
          rel: "into",
          from: "canon/records/guide/old-editing",
          to: `${T}/guide`,
        }),
      ]),
    );
    // under a path: only edges with an end there
    expect(
      (await a.edges?.("canon/references"))?.every((e) => e.from === ref || e.to === ref),
    ).toBe(true);
    // a second read at the same head is the kept one
    expect(await canonPaths(pg.db, REMOTE, null).edges?.("canon")).toEqual(edges);

    const map = await mapAt(a, { depth: 2, open: {} });
    // the depth cut skips a box past 12 rows: Records counts every record
    expect(map.boxes.filter((b) => b.open).map((b) => b.path)).toEqual([
      "canon/topics",
      "canon/references",
      "canon/files",
    ]);
    expect(map.boxes.find((b) => b.path === "canon/records")).toMatchObject({ open: false });
    const line = map.lines.find((l) => l.id === `${ref}>${T}`);
    expect(line).toMatchObject({ count: 1, rels: { backs: 1 } });
    expect(map.inside[T]).toBeGreaterThan(0);
    const page = await lineAt(a, { path: ref, open: false }, { path: T, open: false });
    expect(page.edges.map((e) => [e.rel, e.to])).toEqual([
      ["backs", `${sets}/video-editing-cuts/VC-1`],
    ]);
  });

  it("answers not-indexed before the first sync", async () => {
    const fresh = await startTestPostgres({ own: true });
    try {
      const b = canonPaths(fresh.db, REMOTE, null);
      await expect(b.children("canon")).rejects.toMatchObject({ code: "not-indexed" });
      expect((await walk(b, "canon/topics")).error).toMatchObject({ code: "not-indexed" });
    } finally {
      await fresh.stop();
    }
  });
});
