/**
 * Canon's whole brain on a real Postgres: home (topics, counts, direction, conflicts, stale), one
 * topic whole, every record with filters and file matches, one record with both link ways, a file.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { write } from "@wrenautomation/knowledge";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Reference } from "../../src/canon-console.js";
import { syncCanonIndex } from "../../src/canon-index.js";
import { canonLibraryApi, type SourceRow } from "../../src/canon-library.js";

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
const REMOTE = "https://github.com/example-org/canon.git";
// the console's shaper adds posters and players; ids are enough here
const shapes = async (rows: SourceRow[]) =>
  rows.map((r) => ({ id: r.id, title: r.title }) as unknown as Reference);

let pg: TestPostgres;
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "canon-library-"));
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

const put = (root: string, path: string, text: string | Buffer) => {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
};

/** What the base answers: home, both topics, the base's records, one record. */
const answers = async (api: ReturnType<typeof canonLibraryApi>) => ({
  home: await api.home(),
  topic: await api.topic("video-editing"),
  other: await api.topic("writing-tells"),
  records: await api.records({ client: "base" }),
  rules: await api.records({ client: "base", type: "rule" }),
  record: await api.record("video-editing-cuts"),
});
/** The answers less what a client adds: the head, client fields, the client facet. */
const baseOnly = ({
  home,
  topic,
  other,
  records,
  rules,
  record,
}: Awaited<ReturnType<typeof answers>>) => {
  const bare = (t: typeof topic) => ({
    ...t,
    clients: [],
    sets: t.sets.map((s) => ({ ...s, rules: s.rules.map((r) => ({ ...r, overrides: [] })) })),
  });
  const rows = (r: typeof records) => ({ ...r, facets: { ...r.facets, client: [] } });
  return {
    home: { ...home, head: null, clients: [] },
    topic: bare(topic),
    other: bare(other),
    records: rows(records),
    rules: rows(rules),
    record,
  };
};

describe("canonLibraryApi", () => {
  it("shows every topic, record and file the repo holds", async () => {
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
    put(
      repo,
      "topics/video-editing/SKILL.md",
      "---\nname: sop-video-editing\n---\n\nFollow this SOP.",
    );
    put(
      repo,
      "topics/video-editing/notes.md",
      "---\nset:\n---\n\n# Notes\n\nKeep the music under the voice.",
    );
    put(repo, "topics/video-editing/refs/board.pdf", Buffer.from([37, 80, 68, 70, 0, 1]));
    put(repo, "topics/writing-tells/checks/tells.sh", "#!/bin/sh\necho ok\n");
    put(repo, "direction/2026-11-12-brand.md", "# Personal brand\n\nYouTube first.");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "seed"]);
    const synced = await syncCanonIndex(pg.db, pg.url, "canon", {
      dir: tmp(),
      remote: repo,
      token: null,
    });
    expect(synced.files).toBe(6);

    const api = canonLibraryApi(pg.db, REMOTE, shapes);
    const home = await api.home();
    expect(home.indexed).toBe(true);
    expect(home.topics).toEqual([
      {
        name: "video-editing",
        title: "Video editing",
        description: "Edit a video well.",
        guide: "video-editing",
        sets: 1,
        lines: 2,
        skill: true,
        notes: true,
        conflicts: 1,
      },
      {
        name: "writing-tells",
        title: "writing-tells",
        description: null,
        guide: null,
        sets: 1,
        lines: 1,
        skill: false,
        notes: false,
        conflicts: 0,
      },
    ]);
    expect(home.types).toEqual(
      expect.arrayContaining([
        { value: "source", n: 2 },
        { value: "rule", n: 2 },
      ]),
    );
    expect(home.direction).toEqual([
      { path: "direction/2026-11-12-brand.md", size: 32, text: true, title: "Personal brand" },
    ]);
    expect(home.other.map((f) => f.path)).toEqual(["knowledge.json"]);
    expect(home.conflicts.map((c) => c.id)).toEqual(["conflict-cuts"]);
    expect(home.stale).toEqual([]);
    // a set another topic's guide cites
    expect(home.shared).toEqual([
      { id: "writing-tells-copy", title: "Copy", owner: "writing-tells", users: ["video-editing"] },
    ]);

    const topic = await api.topic("video-editing");
    expect(topic.guide).toMatchObject({
      id: "video-editing",
      cites: [
        { id: "video-editing-cuts", type: "rule" },
        { id: "writing-tells-copy", type: "rule" },
      ],
    });
    expect(topic.sets).toEqual([
      expect.objectContaining({
        id: "video-editing-cuts",
        prefix: "VC",
        lines: 2,
        cites: [expect.objectContaining({ id: "cuts-land-on-the-beat", type: "finding" })],
        // each line with the sources under it, through the finding
        rules: [
          expect.objectContaining({
            id: "VC-1",
            text: "Cut on the beat.",
            sources: ["youtube-abc12345678"],
          }),
          expect.objectContaining({ id: "VC-2", backing: "human", sources: [] }),
        ],
        usedBy: [],
      }),
    ]);
    expect(topic.borrowed).toEqual([
      expect.objectContaining({ id: "writing-tells-copy", topic: "writing-tells", usedBy: [] }),
    ]);
    expect(topic.skill).toContain("Follow this SOP.");
    expect(topic.notes).toBe("# Notes\n\nKeep the music under the voice.");
    expect(topic.files).toEqual([
      { path: "topics/video-editing/refs/board.pdf", size: 6, text: false },
    ]);
    expect(topic.conflicts).toEqual([
      expect.objectContaining({ id: "conflict-cuts", state: "open", lines: ["VC-1"] }),
    ]);
    // tagged reference: shaped, with the lines it backs; the rest are sources
    expect(topic.references).toEqual([
      expect.objectContaining({ id: "youtube-abc12345678", backs: ["VC-1"] }),
    ]);
    // through the set the guide borrows
    expect(topic.sources).toEqual([
      expect.objectContaining({ id: "web-example-com", kind: "page", backs: ["WC-1"] }),
    ]);
    expect(topic.github).toBe("https://github.com/example-org/canon");
    // a folder with no guide still makes a topic
    expect((await api.topic("writing-tells")).files.map((f) => f.path)).toEqual([
      "topics/writing-tells/checks/tells.sh",
    ]);
    await expect(api.topic("nothing-here")).rejects.toThrow(/no such topic/);

    const all = await api.records({});
    expect(all.total).toBe(7);
    expect(all.facets.type).toEqual(
      expect.arrayContaining([
        { value: "conflict", n: 1 },
        { value: "guide", n: 1 },
      ]),
    );
    const found = await api.records({ q: "kick" });
    expect(found.rows.map((r) => [r.id, r.summary])).toEqual([
      ["cuts-land-on-the-beat", "Every cut sits on a kick."],
    ]);
    expect((await api.records({ q: "music voice" })).files.map((f) => f.path)).toEqual([
      "topics/video-editing/notes.md",
    ]);
    expect(
      (await api.records({ topic: "video-editing", type: "rule" })).rows.map((r) => r.id),
    ).toEqual(["video-editing-cuts"]);
    // a filter keeps its own facet whole
    expect((await api.records({ type: "rule" })).facets.type.length).toBeGreaterThan(1);

    const finding = await api.record("cuts-land-on-the-beat");
    expect(finding).toMatchObject({
      type: "finding",
      body: "Every cut sits on a kick.",
      picture: null,
      cites: [{ id: "youtube-abc12345678", type: "source", title: "A talk", status: "live" }],
      citedBy: [{ id: "video-editing-cuts", type: "rule" }],
      github: "https://github.com/example-org/canon/blob/main/findings/cuts-land-on-the-beat.md",
    });
    expect(finding.data.source).toBe("youtube-abc12345678");
    await expect(api.record("none")).rejects.toThrow(/no such record/);

    expect(await api.file("topics/video-editing/refs/board.pdf")).toMatchObject({
      size: 6,
      text: false,
      body: null,
    });
    expect((await api.file("direction/2026-11-12-brand.md")).body).toContain("YouTube first.");
    await expect(api.file("nope.md")).rejects.toThrow(/no such file/);

    // a client's overlay: the base answers stay as they were; the client shows in fields of its own
    const base = await answers(api);
    await write(
      repo,
      [
        {
          op: "add",
          type: "rule",
          id: "acme-video-editing-cuts",
          title: "Acme cuts",
          topic: "video-editing",
          client: "acme",
          prefix: "AV",
          cites: ["video-editing-cuts"],
          replaces: [{ line: "AV-1", base: "VC-2", set: "video-editing-cuts" }],
          body: "# Acme cuts\n\n- **AV-1** Hold the first frame on the logo.\n- **AV-2** Cut on the snare.\n",
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
          id: "acme-video-editing",
          title: "Acme video editing",
          topic: "video-editing",
          client: "acme",
          description: "Acme's way.",
          cites: ["acme-video-editing-cuts"],
          body: "# Acme video editing\n\n1. Cut on the snare [1].\n",
        },
      ],
      me,
    );
    put(repo, "clients/acme/topics/video-editing/notes.md", "# Notes\n\nLogo first.");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "acme"]);
    await syncCanonIndex(pg.db, pg.url, "canon", { dir: tmp(), remote: repo, token: null });
    const withClient = await answers(api);
    expect(withClient.home.clients).toEqual([
      { client: "acme", records: 2, sets: 1, overrides: 1, stale: 0 },
    ]);
    const vc2 = withClient.topic.sets[0]?.rules.find((r) => r.id === "VC-2");
    expect(vc2?.overrides).toEqual([
      {
        client: "acme",
        set: "acme-video-editing-cuts",
        topic: "video-editing",
        line: "AV-1",
        text: "Hold the first frame on the logo.",
        stale: false,
      },
    ]);
    expect(withClient.topic.clients).toEqual([
      {
        client: "acme",
        sets: [{ id: "acme-video-editing-cuts", type: "rule", title: "Acme cuts", status: "live" }],
        notes: "# Notes\n\nLogo first.",
      },
    ]);
    expect(withClient.record.client).toBeNull();
    expect((await api.record("acme-video-editing")).client).toBe("acme");
    expect((await api.records({})).facets.client).toEqual([
      { value: "base", n: 7 },
      { value: "acme", n: 2 },
    ]);
    expect((await api.records({ client: "acme" })).rows.map((r) => [r.id, r.client])).toEqual([
      ["acme-video-editing", "acme"],
      ["acme-video-editing-cuts", "acme"],
    ]);
    // with the client fields cleared, every base answer is the one before
    expect(baseOnly(withClient)).toEqual(baseOnly(base));

    // one client whole: its lines and the base line each stands in for
    const acme = await api.client("acme");
    expect(acme.summary).toEqual(withClient.home.clients[0]);
    expect(acme.records.map((r) => r.id).sort()).toEqual([
      "acme-video-editing",
      "acme-video-editing-cuts",
    ]);
    expect(acme.files.map((f) => f.path)).toEqual(["clients/acme/topics/video-editing/notes.md"]);
    expect(acme.sets[0]?.rules).toEqual([
      {
        id: "AV-1",
        text: "Hold the first frame on the logo.",
        replaces: {
          set: "video-editing-cuts",
          topic: "video-editing",
          line: "VC-2",
          text: "Hold the first frame.",
          stale: false,
          gone: false,
        },
      },
      { id: "AV-2", text: "Cut on the snare.", replaces: null },
    ]);
    await expect(api.client("nobody")).rejects.toThrow(/no such client/);

    // the base drops VC-2: the client line keeps its text, its base line reads gone
    const at = join(repo, (await api.record("video-editing-cuts")).path);
    writeFileSync(at, readFileSync(at, "utf8").replace(/^- \*\*VC-2\*\*.*\n/m, ""));
    git(repo, ["commit", "-qam", "drop VC-2"]);
    await syncCanonIndex(pg.db, pg.url, "canon", { dir: tmp(), remote: repo, token: null });
    expect((await api.client("acme")).sets[0]?.rules[0]?.replaces).toEqual({
      set: "video-editing-cuts",
      topic: "video-editing",
      line: "VC-2",
      text: null,
      stale: true,
      gone: true,
    });
  });

  it("answers indexed: false before the first sync", async () => {
    const fresh = await startTestPostgres({ own: true });
    try {
      const api = canonLibraryApi(fresh.db, REMOTE, shapes);
      expect(await api.home()).toMatchObject({ indexed: false, topics: [] });
      expect(await api.records({})).toMatchObject({ indexed: false, rows: [] });
      expect(await api.clients()).toEqual([]);
      await expect(api.client("acme")).rejects.toThrow(/no index/);
    } finally {
      await fresh.stop();
    }
  });
});
