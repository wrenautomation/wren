/**
 * Canon › References reads on a real Postgres: the video list with its filters and counts, one
 * reference whole, and "Backs": the rule line above it, found through `knowledge_cites`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { write } from "@wrenautomation/knowledge";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonConsoleApi } from "../../src/canon-console.js";
import { syncCanonIndex } from "../../src/canon-index.js";

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();

let pg: TestPostgres;
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "canon-console-"));
  dirs.push(d);
  return d;
};
beforeAll(async () => {
  pg = await startTestPostgres({ own: true });
});
afterAll(async () => {
  await pg.stop();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("canonConsoleApi", () => {
  it("lists video references, filters them, and reads one with the rule lines it backs", async () => {
    const repo = tmp();
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "t"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    writeFileSync(join(repo, "knowledge.json"), JSON.stringify({ owner: "ana" }));
    const me = { by: "agent-1", why: "test" };
    const note = { text: "A long note. ".repeat(40).trim(), by: "ana", at: "2026-11-01" };
    await write(
      repo,
      [
        {
          op: "add",
          type: "source",
          id: "instagram-AbC123",
          title: "Cut on the beat",
          kind: "reel",
          url: "https://www.instagram.com/reel/AbC123/",
          handle: "editor.one",
          length: 21,
          provider: { kind: "human", who: "ana" },
          note,
          tags: ["video-editing"],
          body: "# Cut on the beat\n\n## Caption\n\nWatch the cuts.\n\n## Transcript\n\nOne two three.\n",
        },
        {
          op: "add",
          type: "source",
          id: "youtube-xyz98765432",
          title: "A long talk",
          kind: "video",
          url: "https://youtube.com/watch?v=xyz98765432",
          provider: { kind: "agent", who: "feed" },
        },
        {
          op: "add",
          type: "source",
          id: "web-example-com",
          title: "A page",
          kind: "page",
          url: "https://example.com/",
        },
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
          cites: ["instagram-AbC123"],
          body: "# Cuts\n\n- **VC-1** Cut on the beat, never between. [1]\n- **VC-2** Hold the first frame. [notes]\n",
        },
      ],
      me,
    );
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "seed"]);
    await syncCanonIndex(pg.db, pg.url, "canon", { dir: tmp(), remote: repo, token: null });

    const signed: string[] = [];
    const api = canonConsoleApi(pg.db, {
      bucket: "media",
      sign: async (uri) => {
        signed.push(uri);
        return `https://signed/${uri.slice("s3://media/".length)}`;
      },
    });

    const all = await api.references({});
    expect(all).toMatchObject({ indexed: true, total: 2, next: null });
    expect(all.head).toMatch(/^[0-9a-f]{40}$/);
    expect(all.rows.map((r) => r.id).sort()).toEqual(["instagram-AbC123", "youtube-xyz98765432"]);
    const reel = all.rows.find((r) => r.id === "instagram-AbC123");
    expect(reel).toMatchObject({
      platform: "instagram",
      length: 21,
      handle: "editor.one",
      video: "https://signed/cache/instagram/AbC123.mp4",
      poster: "https://signed/cache/instagram/AbC123.jpg",
      embed: "https://www.instagram.com/reel/AbC123/embed",
      tags: ["video-editing"],
    });
    // his note comes back whole
    expect(reel?.note?.text).toBe(note.text);
    const talk = all.rows.find((r) => r.id === "youtube-xyz98765432");
    expect(talk).toMatchObject({
      poster: "https://i.ytimg.com/vi/xyz98765432/hqdefault.jpg",
      video: null,
    });
    expect(all.facets.platform).toEqual(
      expect.arrayContaining([
        { value: "instagram", n: 1 },
        { value: "youtube", n: 1 },
      ]),
    );

    expect((await api.references({ provider: "human" })).rows.map((r) => r.id)).toEqual([
      "instagram-AbC123",
    ]);
    expect((await api.references({ tag: "video-editing" })).total).toBe(1);
    expect((await api.references({ q: "long talk" })).rows.map((r) => r.id)).toEqual([
      "youtube-xyz98765432",
    ]);
    expect((await api.references({ noted: true })).total).toBe(1);
    // a filter keeps its own facet whole, so the other values stay pickable
    expect((await api.references({ platform: "youtube" })).facets.platform).toHaveLength(2);
    const paged = await api.references({ limit: 1 });
    expect(paged).toMatchObject({ total: 2, next: 1 });

    const one = await api.reference("instagram-AbC123");
    expect(one).toMatchObject({
      caption: "Watch the cuts.",
      transcript: "One two three.",
      backs: [
        {
          set: "video-editing-cuts",
          setTitle: "Cuts",
          line: "VC-1",
          text: "Cut on the beat, never between.",
        },
      ],
    });
    await expect(api.reference("instagram-none")).rejects.toThrow(/no such reference/);
  });

  it("answers indexed: false before the first sync", async () => {
    const fresh = await startTestPostgres({ own: true });
    try {
      expect(await canonConsoleApi(fresh.db).references({})).toMatchObject({
        indexed: false,
        rows: [],
      });
    } finally {
      await fresh.stop();
    }
  });
});
