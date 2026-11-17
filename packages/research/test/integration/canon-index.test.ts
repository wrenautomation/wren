/**
 * Canon's prod index on a real Postgres: the bare clone, the diff sync as `canon_index`, main reads
 * a rebuilt table, and `canon_index` reaches nothing outside schema `canon`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { write } from "@wrenautomation/knowledge";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canonClientDb,
  canonIndexUrl,
  readCanonAs,
  syncCanonIndex,
} from "../../src/canon-index.js";

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();

let pg: TestPostgres;
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "canon-index-"));
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

function origin(): string {
  const d = tmp();
  git(d, ["init", "-q", "-b", "main"]);
  git(d, ["config", "user.email", "t@example.com"]);
  git(d, ["config", "user.name", "t"]);
  git(d, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(d, "knowledge.json"), JSON.stringify({ owner: "ana" }));
  git(d, ["add", "knowledge.json"]);
  git(d, ["commit", "-q", "-m", "init"]);
  return d;
}
const me = { by: "agent-1", why: "test" };
const addSource = async (repo: string, id: string, title: string) => {
  await write(repo, [{ op: "add", type: "source", id, title, kind: "video" }], me);
  if (git(repo, ["status", "--porcelain"])) {
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", id]);
  }
};

describe("syncCanonIndex", () => {
  it("clones, then syncs each push as canon_index; main reads; canon_index sees only canon", async () => {
    const repo = origin();
    await addSource(repo, "youtube-one", "One talk");
    // a local path remote: no token
    const checkout = {
      dir: tmp(),
      remote: repo,
      token: null,
    };

    const first = await syncCanonIndex(pg.db, pg.url, "canon", checkout);
    expect(first).toMatchObject({ mode: "full", broken: 0 });
    const ids = async () =>
      (
        await pg.db.execute<{ id: string }>(
          sql`select id from canon.knowledge_records where type = 'source' order by id`,
        )
      ).map((r) => r.id);
    expect(await ids()).toEqual(["youtube-one"]);

    await addSource(repo, "youtube-two", "Two talk");
    const second = await syncCanonIndex(pg.db, pg.url, "canon", checkout);
    expect(second).toMatchObject({ mode: "diff", upserted: 1 });
    expect(await ids()).toEqual(["youtube-one", "youtube-two"]);

    // nothing new: no work
    expect(await syncCanonIndex(pg.db, pg.url, "canon", checkout)).toMatchObject({ mode: "none" });

    // a full rebuild makes the tables again; main still reads them (default privileges)
    await pg.db.execute(
      sql`drop table canon.knowledge_records, canon.knowledge_cites, canon.knowledge_meta`,
    );
    expect(await syncCanonIndex(pg.db, pg.url, "canon", checkout)).toMatchObject({ mode: "full" });
    expect(await ids()).toEqual(["youtube-one", "youtube-two"]);

    const as = createDb(canonIndexUrl(pg.url), { max: 1 });
    try {
      await pg.db.execute(sql`create table public.canon_probe (x int)`);
      // drizzle wraps the driver's error: the reason is on `cause`
      const refused = (q: Promise<unknown>) =>
        q.then(
          () => "allowed",
          (e: { cause?: { message?: string } }) => e.cause?.message ?? "",
        );
      expect(await refused(as.db.execute(sql`select * from public.canon_probe`))).toMatch(
        /permission denied/,
      );
      expect(await refused(as.db.execute(sql`create table public.canon_probe2 (x int)`))).toMatch(
        /permission denied/,
      );
    } finally {
      await as.close();
    }
  });

  it("canon_client_read sees the base and one client's overlay: never another client's", async () => {
    const repo = origin();
    await write(
      repo,
      [
        { op: "add", type: "source", id: "youtube-base", title: "Base talk", kind: "video" },
        {
          op: "add",
          type: "source",
          id: "acme-call",
          title: "Acme call",
          kind: "video",
          client: "acme",
          cites: ["youtube-base"],
        },
        {
          op: "add",
          type: "source",
          id: "zed-call",
          title: "Zed call",
          kind: "video",
          client: "zed",
          cites: ["youtube-base"],
        },
      ],
      me,
    );
    for (const c of ["acme", "zed"]) {
      mkdirSync(join(repo, "clients", c), { recursive: true });
      writeFileSync(join(repo, "clients", c, "notes.md"), `${c} notes\n`);
    }
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "notes"]);
    await syncCanonIndex(pg.db, pg.url, "canon-clients", { dir: tmp(), remote: repo, token: null });

    const h = canonClientDb(pg.url);
    try {
      const all = async (tx: Pick<typeof h.db, "execute">) => ({
        records: (
          await tx.execute<{ id: string }>(
            sql`select id from canon.knowledge_records where repo = 'canon-clients' order by id`,
          )
        ).map((r) => r.id),
        cites: (
          await tx.execute<{ from: string }>(
            sql`select "from" from canon.knowledge_cites where repo = 'canon-clients' order by 1`,
          )
        ).map((r) => r.from),
        files: (
          await tx.execute<{ path: string }>(
            sql`select path from canon.knowledge_files where repo = 'canon-clients' and path like 'clients/%' order by path`,
          )
        ).map((r) => r.path),
      });
      expect(await readCanonAs(h.db, "acme", all)).toEqual({
        records: ["acme-call", "youtube-base"],
        cites: ["acme-call"],
        files: ["clients/acme/notes.md"],
      });
      expect(await readCanonAs(h.db, "zed", all)).toEqual({
        records: ["youtube-base", "zed-call"],
        cites: ["zed-call"],
        files: ["clients/zed/notes.md"],
      });
      // no client set, or a setting from an ended transaction: the base only
      expect(await all(h.db)).toEqual({ records: ["youtube-base"], cites: [], files: [] });
      await expect(readCanonAs(h.db, "*", all)).rejects.toThrow();
      // main (the admin view) sees every client
      expect((await all(pg.db)).records).toEqual(["acme-call", "youtube-base", "zed-call"]);
    } finally {
      await h.close();
    }
  });
});
