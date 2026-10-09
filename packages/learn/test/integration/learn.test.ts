/**
 * Learn end to end on a real Postgres: a source followed (its back catalog seen, not read), new
 * items read and scored along the `learn` workflow, a saved reel waiting for the Mac and read
 * there, search over transcripts, alerts and the digest, and an item written into an SOP's
 * folder, and the drive: types, thumbnails, places, filters, marks, collections, tags and
 * where playback is. Feeds, pages, the video reader and the model are fakes; every address is
 * made up.
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
  judges,
  practiceOf,
  pullFeeds,
  readItem,
  readStep,
  readVideo,
  scoreItem,
  scoreStep,
  searchItems,
  sopLibrary,
  sources,
  tellLearn,
  type VideoReader,
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
    sql`TRUNCATE learn.item_tags, learn.collections, learn.sop_sources, learn.items, learn.sources, learn.digests, learn.seen, events RESTART IDENTITY CASCADE`,
  );
});

const viewer = { viewer: { email: "me@wren.example", operator: true } } as unknown as PortalRequest;
/** A source with a picture, and items from it: synthetic addresses only. Wren's own. */
async function fromSource(n: number, o: { at?: Date } = {}) {
  const [src] = await pg.db
    .insert(sources)
    .values({
      client: "wren",
      url: `https://feeds.example/${n}.xml`,
      name: `Synthetic ${n}`,
      avatarUrl: `https://img.example/s${n}.png`,
    })
    .returning();
  const [item] = await pg.db
    .insert(items)
    .values({
      url: `https://news.example/${n}`,
      title: `Item ${n}`,
      sourceId: src?.id,
      thumbnailUrl: `https://img.example/t${n}.jpg`,
      client: "wren",
      ...(o.at ? { createdAt: o.at } : {}),
    })
    .returning();
  return item?.id as number;
}
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
/** Wren's judge on this model, against the synthetic SOP. */
const judge = (llm: FakeLlm | null) => judges({ db: pg.db, llm, wrenPractices: practices });
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
    "learn.score": scoreStep(pg.db, judge(llm)),
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
    expect([...states].map((r) => r.state)).toEqual(["archived", "show", "drop", "show"]);

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
    expect(await readVideo(pg.db, reader, Number(first.id))).toBe("read");
    expect(await scoreItem(pg.db, judge(llmScoring()), Number(first.id))).toBe("drop");
    const [row] = await pg.db
      .select()
      .from(items)
      .where(eq(items.id, Number(first.id)));
    expect(row).toMatchObject({
      title: "Three warmup rules",
      creator: "synthetic.creator",
      file: "instagram-Csynth1.md",
    });

    const hits = await searchItems(pg.db, "wren", "forty inbox");
    expect(hits.map((h) => h.id)).toEqual([Number(first.id)]);
    expect(hits[0]?.snippet).toContain("«forty»");
    expect(await searchItems(pg.db, "wren", "nothing-like-this")).toEqual([]);

    // A saved item never alerts.
    const { n, sent } = notifier();
    await tellLearn(pg.db, n, { today: "2026-10-07", hour: 10, now: new Date() });
    expect(sent).toEqual([]);
  });

  it("reads a YouTube save on the worker, and leaves it to the Mac when that fails", async () => {
    const api = learnConsoleApi(pg.db, web({ entries: [] }));
    const ok = await api.save({ ...viewer, url: "https://youtu.be/synthVid02a?si=x" });
    const md = `---\nsource: "youtube:synthVid02a"\ntitle: "Reply rates"\nchannel: "Synth"\npriority: 5\n---\n\n# Reply rates\n\n## Speech\n\n[0:00] Words.\n`;
    const seen: unknown[] = [];
    const reader: VideoReader = async ({ url, kind, duration }) => {
      seen.push([url, kind, duration]);
      return { file: "youtube-synthVid02a.md", md };
    };
    expect(await readItem(pg.db, web({ entries: [] }), Number(ok.id), reader)).toBe("read");
    expect(seen).toEqual([["https://youtube.com/watch?v=synthVid02a", "video", null]]);

    const bad = await api.save({ ...viewer, url: "https://youtu.be/synthVid03b" });
    const fail = async () => Promise.reject(new Error("keys spent"));
    expect(await readItem(pg.db, web({ entries: [] }), Number(bad.id), fail)).toBe("mac");
    expect((await waitingForMac(pg.db)).map((w) => w.id)).toEqual([Number(bad.id)]);
  });

  it("keeps a failed read with why, and reads it again on ask", async () => {
    const api = learnConsoleApi(pg.db, web({ entries: [] }));
    const s = await api.save({ ...viewer, url: "https://youtu.be/synthVid01?si=x" });
    expect(s).toMatchObject({ url: "https://youtube.com/watch?v=synthVid01", kind: "video" });
    expect(
      await readVideo(pg.db, async () => Promise.reject(new Error("no captions")), Number(s.id)),
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

      const lib = await sopLibrary(pg.db, "wren", dir);
      expect(lib).toEqual([
        expect.objectContaining({
          sop: "email-infra",
          seen: "folder",
          sources: 1,
          fromItems: 1,
          state: "unpushed",
        }),
      ]);
      const onWorker = await sopLibrary(pg.db, "wren", null);
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

  it("browses like a drive: types and pictures from feeds, places, filters, marks, folders, tags, resume", async () => {
    const yt = { entries: [] as string[] };
    // The show's back catalog is seen, not new.
    const pod = { entries: ["zero"] };
    const atom = (ids: string[]) =>
      `<?xml version="1.0"?><feed xmlns:media="http://search.yahoo.com/mrss/"><title>Synthetic Channel</title><icon>https://yt.example/avatar.jpg</icon>${ids
        .map(
          (id) =>
            `<entry><title>Video ${id}</title><link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/><published>2026-10-06T10:00:00Z</published><media:group><media:thumbnail url="https://i.ytimg.com/vi/${id}/hqdefault.jpg"/><media:description>About ${id}. ${LONG}</media:description></media:group></entry>`,
        )
        .join("")}</feed>`;
    const show = (eps: string[]) =>
      `<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Synthetic Show</title><itunes:image href="https://cdn.example/art.jpg"/>${eps
        .map(
          (e) =>
            `<item><title>Episode ${e}</title><link>https://show.example/ep/${e}</link><enclosure url="https://cdn.example/${e}.mp3" type="audio/mpeg" length="1"/><itunes:duration>12:34</itunes:duration><itunes:image href="https://cdn.example/${e}.jpg"/><description>${e}: ${LONG}</description><pubDate>Tue, 06 Oct 2026 10:00:00 GMT</pubDate></item>`,
        )
        .join("")}</channel></rss>`;
    const fetchFn: FetchFn = async (url) => {
      if (url.startsWith("https://www.youtube.com/feeds/")) return new Response(atom(yt.entries));
      if (url === "https://show.example/feed") return new Response(show(pod.entries));
      return new Response("gone", { status: 404 });
    };
    const api = learnConsoleApi(pg.db, fetchFn);
    await api.follow({
      ...viewer,
      url: "https://www.youtube.com/feeds/videos.xml?channel_id=synth",
    });
    await api.follow({ ...viewer, url: "https://show.example/feed" });
    yt.entries = ["synthVid01", "synthVid02"];
    pod.entries = ["zero", "one"];
    const later = new Date(Date.now() + 2 * 3_600_000);
    expect((await pullFeeds(pg.db, fetchFn, later)).added).toHaveLength(3);
    const saved = await api.save({ ...viewer, url: "https://www.youtube.com/shorts/synthShort1" });

    const rows = (await pg.db.select().from(items).orderBy(asc(items.id))).filter(
      (r) => !r.archivedAt,
    );
    expect(rows.map((r) => [r.type, r.thumbnailUrl, r.duration, r.mediaUrl])).toEqual([
      ["youtube", "https://i.ytimg.com/vi/synthVid01/hqdefault.jpg", null, null],
      ["youtube", "https://i.ytimg.com/vi/synthVid02/hqdefault.jpg", null, null],
      ["podcast", "https://cdn.example/one.jpg", 754, "https://cdn.example/one.mp3"],
      ["shorts", "https://i.ytimg.com/vi/synthShort1/hqdefault.jpg", null, null],
    ]);
    const srcs = await pg.db.select().from(sources).orderBy(asc(sources.id));
    expect(srcs.map((s) => [s.kind, s.avatarUrl])).toEqual([
      ["youtube", "https://yt.example/avatar.jpg"],
      ["podcast", "https://cdn.example/art.jpg"],
    ]);

    // Inbox: everything new, counted by type and by source.
    const inbox = await api.browse({ ...viewer });
    expect(inbox.total).toBe(4);
    expect(inbox.types).toEqual({ youtube: 2, podcast: 1, shorts: 1 });
    expect(inbox.sources.map((s) => [s.name, s.n])).toEqual([
      ["Synthetic Channel", 2],
      ["Synthetic Show", 1],
    ]);
    const vids = await api.browse({ ...viewer, types: ["youtube"], sort: "title" });
    expect(vids.items.map((c) => c.title)).toEqual(["Video synthVid01", "Video synthVid02"]);
    expect(vids.items[0]).toMatchObject({
      type: "youtube",
      status: "unread",
      source: { name: "Synthetic Channel", kind: "youtube" },
    });
    await expect(api.browse({ ...viewer, place: "nowhere" })).rejects.toThrow(/no such place/);

    // Marks: star, watch later, archive, pin first.
    const [v1, v2, ep, short] = rows.map((r) => String(r.id));
    if (!v1 || !v2 || !ep || !short) throw new Error("four items");
    await api.mark({ ...viewer, ids: [v1], mark: "star" });
    await api.mark({ ...viewer, ids: [v2, ep], mark: "later" });
    await api.mark({ ...viewer, ids: [short], mark: "pin" });
    await expect(api.mark({ ...viewer, ids: [v1], mark: "loud" })).rejects.toThrow(/mark is/);
    expect((await api.browse({ ...viewer, place: "starred" })).items.map((c) => c.id)).toEqual([
      Number(v1),
    ]);
    expect((await api.browse({ ...viewer, place: "later" })).total).toBe(2);
    expect((await api.browse({ ...viewer, place: "all", sort: "title" })).items[0]?.id).toBe(
      Number(short),
    );
    expect((await api.mark({ ...viewer, ids: [v2], mark: "archive" })).done).toEqual([v2]);
    // Archiving takes it off Watch later too.
    expect((await api.browse({ ...viewer, place: "later" })).total).toBe(1);
    expect((await api.browse({ ...viewer, place: "archived" })).total).toBe(2);
    expect((await api.mark({ ...viewer, ids: [v2], mark: "archive" })).done).toEqual([]);

    // Collections nest like folders; never inside themselves; deleting keeps the items.
    const top = await api.collectionAdd({ ...viewer, name: "Deliverability" });
    const sub = await api.collectionAdd({ ...viewer, name: "Warmup", parent: top.id });
    await expect(api.collectionAdd({ ...viewer, name: "  " })).rejects.toThrow(/a name/);
    await expect(api.collectionEdit({ ...viewer, id: top.id, parent: sub.id })).rejects.toThrow(
      /inside itself/,
    );
    await api.collectionEdit({ ...viewer, id: sub.id, name: "Warmup rules" });
    await api.move({ ...viewer, ids: [v1, ep], collection: sub.id });
    await expect(api.move({ ...viewer, ids: [v1], collection: "999" })).rejects.toThrow(
      /no such collection/,
    );
    const inSub = await api.browse({ ...viewer, place: `c${sub.id}` });
    expect(inSub.items.map((c) => c.id).sort()).toEqual([Number(v1), Number(ep)].sort());
    const r1 = await api.rail(viewer);
    expect(r1.collections.map((c) => [c.name, c.parentId, c.n])).toEqual([
      ["Deliverability", null, 0],
      ["Warmup rules", Number(top.id), 2],
    ]);
    expect(r1.places).toMatchObject({ inbox: 3, later: 1, starred: 1, archived: 2, saved: 1 });
    expect(r1.sources.map((g) => g.kind)).toEqual(["youtube", "podcast"]);

    // Tags, kept short and lower case.
    await api.tag({ ...viewer, ids: [v1, ep], add: ["Cold Email", "#warmup"] });
    await api.tag({ ...viewer, ids: [ep], remove: ["warmup"] });
    expect(
      (await api.browse({ ...viewer, place: "all", tag: "warmup" })).items.map((c) => c.id),
    ).toEqual([Number(v1)]);
    expect((await api.rail(viewer)).tags).toEqual([
      { tag: "cold-email", n: 2 },
      { tag: "warmup", n: 1 },
    ]);

    // Where playback is: resume, Continue watching, and the item's page.
    await api.progress({ ...viewer, id: ep, position: 300.4 });
    // Played later, by the clock: two calls in one millisecond would tie.
    await new Promise((r) => setTimeout(r, 5));
    await api.progress({ ...viewer, id: v1, position: 95, duration: 600 });
    await pg.db
      .update(items)
      .set({ transcript: "## [0:00] Intro\n\nHello.\n\n## [1:30] The rule\n\nForty a day." })
      .where(eq(items.id, Number(v1)));
    const page = await api.item({ ...viewer, id: v1 });
    expect(page).toMatchObject({
      status: "read",
      position: 95,
      duration: 600,
      starred: true,
      collection: { name: "Warmup rules" },
      tags: ["cold-email", "warmup"],
      moments: [
        { t: 0, label: "Intro" },
        { t: 90, label: "The rule" },
      ],
    });
    const home = await api.home(viewer);
    expect(home.continue.map((c) => c.id)).toEqual([Number(v1), Number(ep)]);
    expect(home.shelves.map((s) => [s.type, s.total])).toEqual([["shorts", 1]]);
    expect(home.top).toEqual([]);

    await api.collectionDrop({ ...viewer, id: top.id });
    expect((await api.rail(viewer)).collections).toEqual([]);
    const [after] = await pg.db
      .select()
      .from(items)
      .where(eq(items.id, Number(v1)));
    expect(after?.collectionId).toBeNull();
    const kinds = await api.sources(viewer);
    expect(kinds.kinds.find((k) => k.kind === "podcast")?.sources[0]).toMatchObject({
      name: "Synthetic Show",
      items: 2,
      avatar: "https://cdn.example/art.jpg",
    });
    expect(saved.kind).toBe("reel");
  });

  it("asks the scorer for moments when the transcript is timed", async () => {
    const api = learnConsoleApi(pg.db, web({ entries: [] }));
    const s = await api.save({ ...viewer, url: "https://youtu.be/synthVid03" });
    const md = `---\nsource: "youtube:synthVid03"\ntitle: "Synthetic talk"\nchannel: "Synthetic Channel"\npriority: 5\nduration: 640\n---\n\n# Synthetic talk\n\n[0:00] Hello.\n\n[2:05] The warmup rule.\n`;
    expect(
      await readVideo(pg.db, async () => ({ file: "youtube-synthVid03.md", md }), Number(s.id)),
    ).toBe("read");
    let asked = "";
    const llm = new FakeLlm({
      respond: (p) => {
        asked = p;
        return JSON.stringify({
          score: 5,
          summary: "It says a thing.",
          changes: [],
          why: "Because.",
          moments: [
            { at: "2:05", label: "The warmup rule" },
            { at: "soon", label: "Unplaced" },
          ],
        });
      },
    });
    expect(await scoreItem(pg.db, judge(llm), Number(s.id))).toBe("hold");
    expect(asked).toContain('"moments"');
    const [row] = await pg.db
      .select()
      .from(items)
      .where(eq(items.id, Number(s.id)));
    expect(row).toMatchObject({
      duration: 640,
      moments: [{ t: 125, label: "The warmup rule" }],
    });
  });
  it("counts what sources brought since this viewer last looked", async () => {
    const api = learnConsoleApi(pg.db, web({ entries: [] }));
    await fromSource(1, { at: new Date(Date.now() - 60_000) });
    await api.save({ ...viewer, url: "https://news.example/saved-by-hand" });
    // Never looked: everything new from a source; a save by hand isn't news.
    expect(await api.unseen(viewer)).toEqual({ n: 1 });
    await api.seen(viewer);
    expect(await api.unseen(viewer)).toEqual({ n: 0 });
    const later = await fromSource(2, { at: new Date(Date.now() + 60_000) });
    expect(await api.unseen(viewer)).toEqual({ n: 1 });
    // Opened is read, not new.
    await api.open({ ...viewer, id: String(later) });
    expect(await api.unseen(viewer)).toEqual({ n: 0 });
    // Each person's own.
    const other = {
      viewer: { email: "you@wren.example", operator: true },
    } as unknown as PortalRequest;
    expect(await api.unseen(other)).toEqual({ n: 1 });
  });
});
