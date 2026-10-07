/**
 * Learn end to end on a real Postgres: a source followed (its back catalog seen, not read), new
 * items read and scored along the `learn` workflow, a saved reel waiting for the Mac and read
 * there, search over transcripts, alerts and the digest, and an item written into an SOP's
 * folder. Feeds, pages, the video reader and the model are fakes; every address is made up.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Notifier } from "@wren/core/notify";
import type { PortalRequest } from "@wren/core/portal";
import { pgSpineStore, type Walk, walk } from "@wren/core/spine";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LEARN_COMPONENTS, LEARN_WORKFLOWS } from "../../src/components.js";
import { LEARN_FEEDS_FROM, LEARN_SAVED_FROM, learnConsoleApi } from "../../src/console.js";
import {
  type FetchFn,
  itemEvent,
  items,
  practiceOf,
  pullFeeds,
  readOnMac,
  readStep,
  scoreItem,
  scoreStep,
  searchItems,
  sopLibrary,
  sources,
  tellLearn,
  waitingForMac,
  writeAsked,
} from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await pg.db.execute(
    sql`TRUNCATE learn.sop_sources, learn.items, learn.sources, learn.digests, events RESTART IDENTITY CASCADE`,
  );
});

const viewer = { viewer: { email: "me@wren.example" } } as unknown as PortalRequest;
const LONG = "A long synthetic paragraph about warmup schedules. ".repeat(40);

const rss = (entries: string[]) =>
  `<?xml version="1.0"?><rss><channel><title>Synthetic Weekly</title>${entries
    .map(
      (e) =>
        `<item><title>${e}</title><link>https://news.example/${e}?utm_source=rss</link><description><![CDATA[<p>${e === "short" ? "Teaser." : `${e}: ${LONG}`}</p>]]></description><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item>`,
    )
    .join("")}</channel></rss>`;

/** The blog page names its feed; the feed and each post answer; anything else is a 404. */
function web(state: { entries: string[]; down?: boolean }): FetchFn {
  return async (url) => {
    if (state.down) return new Response("no", { status: 503 });
    if (url === "https://news.example/")
      return new Response(
        `<html><head><link rel="alternate" type="application/rss+xml" href="/feed"></head></html>`,
      );
    if (url === "https://news.example/feed") return new Response(rss(state.entries));
    if (url === "https://news.example/short")
      return new Response(
        `<html><head><meta property="og:title" content="Short, read whole"></head><body><article><p>The full post says to warm up slowly over four weeks.</p></article></body></html>`,
      );
    return new Response("gone", { status: 404 });
  };
}

const practices = async () => [practiceOf("email-infra", "Domains and warmup.\n## Warmup")];
const llmScoring = () =>
  new FakeLlm({
    respond: (p) => {
      const score = p.includes("warmup-change") ? 9 : p.includes("four weeks") ? 8 : 2;
      return JSON.stringify({
        score,
        summary: "It says a thing.",
        changes: score > 7 ? ["email-infra", "made-up-sop"] : [],
        why: "Because.",
      });
    },
  });

const walker = (llm: FakeLlm | null, fetchFn: FetchFn): Walk => ({
  flows: new Map(LEARN_WORKFLOWS.map((f) => [f.id, f])),
  parts: new Map(
    [
      ...LEARN_COMPONENTS,
      // The Monitor's reader stands in for the feeds node.
      {
        id: "watch.read",
        out: [{ id: "items", label: "items", kind: "item" }],
      } as unknown as (typeof LEARN_COMPONENTS)[number],
    ].map((c) => [c.id, c]),
  ),
  steps: {
    "learn.read": readStep(pg.db, fetchFn),
    "learn.score": scoreStep(pg.db, llm, practices),
  },
  store: pgSpineStore(pg.db),
  client: null,
  by: "inv1",
  run: (_name, fn) => fn(),
  later: () => {},
  rule: async () => false,
});

const notifier = () => {
  const sent: Array<{ title: string; body: string; level: string }> = [];
  const n: Notifier = {
    name: "test",
    notify: async (title, body = "", level = "info") => {
      sent.push({ title, body, level });
      return true;
    },
  };
  return { n, sent };
};

describe("Learn", () => {
  it("follows a blog by its page, reads and scores what's new, and tells by each source's pick", async () => {
    const state = { entries: ["old"] };
    const fetchFn = web(state);
    const api = learnConsoleApi(pg.db, fetchFn);
    expect(await api.follow({ ...viewer, url: "https://news.example/" })).toMatchObject({
      name: "Synthetic Weekly",
      kind: "blog",
      items: 1,
    });
    const [source] = await pg.db.select().from(sources);
    expect(source).toMatchObject({
      url: "https://news.example/feed",
      page: "https://news.example/",
    });

    state.entries = ["old", "warmup-change", "gossip", "short"];
    const later = new Date(Date.now() + 2 * 3_600_000);
    const { added } = await pullFeeds(pg.db, fetchFn, later);
    expect(added).toHaveLength(3);

    const tally = await walk(
      walker(llmScoring(), fetchFn),
      "learn",
      LEARN_FEEDS_FROM,
      added.map(itemEvent),
    );
    expect(tally).toMatchObject({ arrived: 6, failed: 0 });
    const rows = await pg.db.select().from(items).orderBy(asc(items.id));
    expect(rows.map((r) => [r.title, r.score, r.verdict, r.changes])).toEqual([
      ["old", null, null, []],
      ["warmup-change", 9, "show", ["email-infra"]],
      ["gossip", 2, "drop", []],
      ["short", 8, "show", ["email-infra"]],
    ]);
    // Tracking params gone; the short one was read from its page.
    expect(rows[3]?.url).toBe("https://news.example/short");
    expect(rows[3]?.transcript).toContain("warm up slowly over four weeks");

    const states = await pg.db.execute(sql`SELECT state FROM learn.item_records ORDER BY id`);
    expect([...states].map((r) => r.state)).toEqual(["done", "show", "drop", "show"]);

    // Score 8+ (the default) alerts both 8s and 9s at once; the digest then has nothing new.
    const { n, sent } = notifier();
    expect(await tellLearn(pg.db, n, { today: "2026-10-07", hour: 8, now: later })).toEqual({
      alerts: 2,
      digest: 0,
    });
    expect(sent[0]?.title).toBe("Learn: 2 new");
    expect(sent[0]?.level).toBe("action");
    expect(await tellLearn(pg.db, n, { today: "2026-10-07", hour: 9, now: later })).toEqual({
      alerts: 0,
      digest: 0,
    });
    // One digest a day.
    expect(await pg.db.execute(sql`SELECT items FROM learn.digests`)).toHaveLength(1);
  });

  it("digest only waits for 09:00, then names what's worth it, best first", async () => {
    const state = { entries: [] as string[] };
    const fetchFn = web(state);
    const api = learnConsoleApi(pg.db, fetchFn);
    await api.follow({ ...viewer, url: "https://news.example/feed", tell: "digest" });
    state.entries = ["warmup-change", "gossip"];
    const later = new Date(Date.now() + 2 * 3_600_000);
    const { added } = await pullFeeds(pg.db, fetchFn, later);
    await walk(walker(llmScoring(), fetchFn), "learn", LEARN_FEEDS_FROM, added.map(itemEvent));
    const { n, sent } = notifier();
    expect(await tellLearn(pg.db, n, { today: "2026-10-08", hour: 7, now: later })).toEqual({
      alerts: 0,
      digest: 0,
    });
    expect(await tellLearn(pg.db, n, { today: "2026-10-08", hour: 9, now: later })).toEqual({
      alerts: 0,
      digest: 1,
    });
    expect(sent[0]?.title).toBe("Learn: 1 to read");
    expect(sent[0]?.body).toContain("9/10 warmup-change");
    expect(sent[0]?.body).not.toContain("gossip");
  });

  it("saves a reel once, waits for the Mac, reads and scores it there, and searches its transcript", async () => {
    const fetchFn = web({ entries: [] });
    const api = learnConsoleApi(pg.db, fetchFn);
    const first = await api.save({
      ...viewer,
      url: "https://www.instagram.com/reel/Csynth1/?igsh=abc",
      via: "shortcut",
    });
    const again = await api.save({ ...viewer, url: "https://instagram.com/reel/Csynth1/" });
    expect(first).toMatchObject({ kind: "reel", fresh: true, unread: true });
    expect(again).toMatchObject({ id: first.id, fresh: false });
    await expect(api.save({ ...viewer, url: "nope" })).rejects.toThrow(/web address/);

    const tally = await walk(walker(llmScoring(), fetchFn), "learn", LEARN_SAVED_FROM, [
      itemEvent(Number(first.id)),
    ]);
    expect(tally).toMatchObject({ arrived: 1, failed: 0 });
    const [saved] = await pg.db.execute(
      sql`SELECT state, saved_via, source FROM learn.saved_records`,
    );
    expect(saved).toEqual({ state: "mac", saved_via: "shortcut", source: "Saved" });

    expect((await waitingForMac(pg.db)).map((w) => w.id)).toEqual([Number(first.id)]);
    const md = `---\nsource: "instagram:Csynth1"\ntitle: "Three warmup rules"\nchannel: "synthetic.creator"\npriority: 5\n---\n\n# Three warmup rules\n\n## Speech\n\n[0:00] Never send more than forty a day from a new inbox.\n\n## On screen\n\nA table of daily caps.\n`;
    const reader = async () => ({ file: "instagram-Csynth1.md", md });
    expect(await readOnMac(pg.db, reader, Number(first.id))).toBe("read");
    expect(await scoreItem(pg.db, llmScoring(), await practices(), Number(first.id))).toBe("drop");
    const [row] = await pg.db
      .select()
      .from(items)
      .where(eq(items.id, Number(first.id)));
    expect(row).toMatchObject({
      title: "Three warmup rules",
      creator: "synthetic.creator",
      file: "instagram-Csynth1.md",
    });

    const hits = await searchItems(pg.db, "forty inbox");
    expect(hits.map((h) => h.id)).toEqual([Number(first.id)]);
    expect(hits[0]?.snippet).toContain("«forty»");
    expect(await searchItems(pg.db, "nothing-like-this")).toEqual([]);

    // A saved item never alerts.
    const { n, sent } = notifier();
    await tellLearn(pg.db, n, { today: "2026-10-07", hour: 10, now: new Date() });
    expect(sent).toEqual([]);
  });

  it("keeps a failed read with why, and reads it again on ask", async () => {
    const api = learnConsoleApi(pg.db, web({ entries: [] }));
    const s = await api.save({ ...viewer, url: "https://youtu.be/synthVid01?si=x" });
    expect(s).toMatchObject({ url: "https://youtube.com/watch?v=synthVid01", kind: "video" });
    expect(
      await readOnMac(pg.db, async () => Promise.reject(new Error("no captions")), Number(s.id)),
    ).toBe("failed");
    expect(await waitingForMac(pg.db)).toEqual([]);
    expect(await waitingForMac(pg.db, { retry: true })).toHaveLength(1);
    expect((await api.readAgain({ ...viewer, ids: [s.id] })).done).toEqual([s.id]);
    expect(await waitingForMac(pg.db)).toHaveLength(1);
  });

  it("writes an asked item into its SOP's folder and shows it in the library", async () => {
    const dir = await mkdtemp(join(tmpdir(), "learn-sops-"));
    try {
      const fetchFn = web({ entries: [] });
      const api = learnConsoleApi(pg.db, fetchFn);
      const s = await api.save({ ...viewer, url: "https://news.example/short" });
      await walk(walker(llmScoring(), fetchFn), "learn", LEARN_SAVED_FROM, [
        itemEvent(Number(s.id)),
      ]);
      await expect(api.toSop({ ...viewer, ids: [s.id], sop: "Bad Name!" })).rejects.toThrow(
        /lowercase/,
      );
      expect((await api.toSop({ ...viewer, ids: [s.id], sop: "email-infra" })).done).toEqual([
        s.id,
      ]);

      const extracted: string[] = [];
      const writer = {
        add: async (d: string, src: { name: string; md: string }) => {
          const { mkdir, writeFile } = await import("node:fs/promises");
          await mkdir(join(d, "sources"), { recursive: true });
          await writeFile(join(d, "sources", src.name), src.md);
          return join(d, "sources", src.name);
        },
        extract: async (_d: string, stem: string) => {
          extracted.push(stem);
        },
      };
      const out = await writeAsked(pg.db, dir, writer);
      expect(out).toEqual([{ sop: "email-infra", file: "web-news-example-short.md", error: null }]);
      expect(extracted).toEqual(["web-news-example-short"]);
      expect(await readdir(join(dir, "email-infra", "sources"))).toEqual([
        "web-news-example-short.md",
      ]);
      expect(
        await readFile(join(dir, "email-infra", "sources", "web-news-example-short.md"), "utf8"),
      ).toContain("four weeks");
      // Written once: a second pass has nothing asked.
      expect(await writeAsked(pg.db, dir, writer)).toEqual([]);

      const lib = await sopLibrary(pg.db, dir);
      expect(lib).toEqual([
        expect.objectContaining({
          sop: "email-infra",
          seen: "folder",
          sources: 1,
          fromItems: 1,
          state: "unpushed",
        }),
      ]);
      const onWorker = await sopLibrary(pg.db, null);
      expect(onWorker).toEqual([
        expect.objectContaining({ sop: "email-infra", seen: "database", state: "unknown" }),
      ]);
      const [rec] = await pg.db.execute(sql`SELECT sops FROM learn.item_records`);
      expect(rec).toEqual({ sops: "email-infra" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses an Instagram creator follow as in development, and keeps a failing source's error", async () => {
    const state = { entries: ["a"], down: false };
    const fetchFn = web(state);
    const api = learnConsoleApi(pg.db, fetchFn);
    await expect(
      api.follow({ ...viewer, url: "https://www.instagram.com/someone/" }),
    ).rejects.toThrow(/in development/);
    await expect(
      api.follow({ ...viewer, url: "https://news.example/feed", tell: "loud" }),
    ).rejects.toThrow(/Tell me/);
    await api.follow({ ...viewer, url: "https://news.example/feed", name: "News" });
    state.down = true;
    const later = new Date(Date.now() + 2 * 3_600_000);
    expect((await pullFeeds(pg.db, fetchFn, later)).failed).toEqual([
      { source: "News", error: "https://news.example/feed: HTTP 503" },
    ]);
    await api.unfollow({ ...viewer, ids: ["1"] });
    expect((await pullFeeds(pg.db, fetchFn, later)).failed).toEqual([]);
    const [src] = await pg.db.execute(sql`SELECT state FROM learn.source_records`);
    expect(src).toEqual({ state: "stopped" });
  });
});
