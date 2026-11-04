/**
 * The kept Learn path on a real Postgres: a link saved, read (a page here, a video by the reader),
 * asked into an SOP and written into its folder. Pages and the reader are fakes; addresses made up.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { PoliteFetcher } from "@wrenautomation/read/fetch";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  askSop,
  readItem,
  readVideo,
  saveLink,
  waitingForMac,
  writeAsked,
} from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await pg.db.execute(sql`TRUNCATE learn.sop_sources, learn.items RESTART IDENTITY CASCADE`);
});

const page = `<html><head><meta property="og:title" content="Short, read whole"></head><body><article><p>The full post says to warm up slowly over four weeks.</p></article></body></html>`;
const pages = new PoliteFetcher("test", {
  fetch: (async (url: string) =>
    url === "https://news.example/short"
      ? new Response(page)
      : new Response("gone", { status: 404 })) as typeof fetch,
  retries: 1,
});
const save = (url: string) => saveLink(pg.db, { client: "wren", url, by: "me", via: "cli" });

describe("Learn sources", () => {
  it("keeps a failed video read with why, and offers it again on retry", async () => {
    const s = await save("https://youtu.be/synthVid01?si=x");
    expect(s).toMatchObject({ url: "https://youtube.com/watch?v=synthVid01", kind: "video" });
    expect(await readVideo(pg.db, () => Promise.reject(new Error("no captions")), s.id)).toBe(
      "failed",
    );
    expect(await waitingForMac(pg.db)).toEqual([]);
    expect(await waitingForMac(pg.db, { retry: true })).toHaveLength(1);
  });

  it("reads a saved page and writes it, once, into the SOP it was asked into", async () => {
    const dir = await mkdtemp(join(tmpdir(), "learn-sops-"));
    try {
      const s = await save("https://news.example/short");
      expect(await readItem(pg.db, pages, s.id)).toBe("read");
      await expect(
        askSop(pg.db, { client: "wren", itemId: s.id, sop: "Bad Name!", by: "me" }),
      ).rejects.toThrow(/lowercase/);
      await askSop(pg.db, { client: "wren", itemId: s.id, sop: "email-infra", by: "me" });

      const extracted: string[] = [];
      const writer = {
        add: async (d: string, src: { name: string; md: string }) => {
          await mkdir(join(d, "sources"), { recursive: true });
          await writeFile(join(d, "sources", src.name), src.md);
          return join(d, "sources", src.name);
        },
        extract: async (_d: string, stem: string) => {
          extracted.push(stem);
        },
      };
      expect(await writeAsked(pg.db, dir, writer)).toEqual([
        { sop: "email-infra", file: "web-news-example-short.md", error: null },
      ]);
      expect(extracted).toEqual(["web-news-example-short"]);
      expect(await readdir(join(dir, "email-infra", "sources"))).toEqual([
        "web-news-example-short.md",
      ]);
      expect(
        await readFile(join(dir, "email-infra", "sources", "web-news-example-short.md"), "utf8"),
      ).toContain("four weeks");
      expect(await writeAsked(pg.db, dir, writer)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
