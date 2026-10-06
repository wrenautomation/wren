/**
 * The radar in the Watch: a feed followed (its back catalog seen, not scored), new items pulled,
 * scored along the `watch` workflow into the queue, and moved by the Inbox app's hands. The feed
 * and the model are fakes; every address here is made up.
 */
import type { PortalRequest } from "@wren/core/portal";
import { pgSpineStore, type Walk, walk } from "@wren/core/spine";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { asc, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WATCH_COMPONENTS, WATCH_WORKFLOWS } from "../../src/components.js";
import { watchConsoleApi } from "../../src/console.js";
import {
  type FetchFn,
  itemEvent,
  items,
  parseFeed,
  practiceOf,
  pullFeeds,
  scoreStep,
} from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await pg.db.execute(sql`TRUNCATE watch.items, watch.feeds, events RESTART IDENTITY CASCADE`);
});

const NOW = new Date("2026-10-06T12:00:00Z");
const rss = (entries: string[]) =>
  `<?xml version="1.0"?><rss><channel><title>Cold Mail Weekly</title>${entries
    .map(
      (e) =>
        `<item><title>${e}</title><link>https://news.example/${e}</link><description><![CDATA[<p>About ${e} &amp; more</p>]]></description><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item>`,
    )
    .join("")}</channel></rss>`;

function feedOf(state: { entries: string[]; down?: boolean }): FetchFn {
  return async () =>
    state.down ? new Response("no", { status: 503 }) : new Response(rss(state.entries));
}

const viewer = { viewer: { email: "me@wren.example" } } as unknown as PortalRequest;

describe("parseFeed", () => {
  it("reads RSS and Atom: links, plain text, dates", () => {
    const r = parseFeed(rss(["one"]));
    expect(r.title).toBe("Cold Mail Weekly");
    expect(r.items).toEqual([
      {
        url: "https://news.example/one",
        title: "one",
        text: "About one & more",
        publishedAt: new Date("2026-10-05T10:00:00Z"),
      },
    ]);
    const atom = parseFeed(
      `<feed><title>Releases</title><entry><title>v2</title><link rel="alternate" href="https://git.example/v2"/><updated>2026-10-01T00:00:00Z</updated><content type="html">&lt;b&gt;New&lt;/b&gt; send API</content></entry></feed>`,
    );
    expect(atom.items[0]).toMatchObject({ url: "https://git.example/v2", text: "New send API" });
  });

  it("reads an SOP down to its first paragraph and headings", () => {
    expect(
      practiceOf(
        "email-infra",
        "# Email infra\n\nDomains, inboxes, warmup.\n\n## Domains\n## Warmup",
      ),
    ).toEqual({
      name: "email-infra",
      about: "Domains, inboxes, warmup.",
      headings: ["Domains", "Warmup"],
    });
  });
});

describe("the radar on the spine", () => {
  const practices = async () => [practiceOf("email-infra", "Domains and warmup.\n## Warmup")];
  const walker = (llm: FakeLlm | null): Walk => ({
    flows: new Map(WATCH_WORKFLOWS.map((f) => [f.id, f])),
    parts: new Map(WATCH_COMPONENTS.map((c) => [c.id, c])),
    steps: { "watch.score": scoreStep(pg.db, llm, practices) },
    store: pgSpineStore(pg.db),
    client: null,
    by: "inv1",
    run: (_name, fn) => fn(),
    later: () => {},
    rule: async () => false,
  });

  it("follows without scoring the back catalog, then scores what's new into the queue", async () => {
    const state = { entries: ["old"] };
    const api = watchConsoleApi(pg.db, null, feedOf(state));
    expect(await api.follow({ ...viewer, url: "https://news.example/feed" })).toMatchObject({
      name: "Cold Mail Weekly",
      items: 1,
    });

    state.entries = ["old", "warmup-change", "gossip", "tool"];
    // Read within the hour: not due.
    expect((await pullFeeds(pg.db, feedOf(state), new Date())).added).toEqual([]);
    const later = new Date(Date.now() + 2 * 3_600_000);
    const { added } = await pullFeeds(pg.db, feedOf(state), later);
    expect(added).toHaveLength(3);

    const prompts: string[] = [];
    const llm = new FakeLlm({
      respond: (p) => {
        prompts.push(p);
        const score = p.includes("Title: warmup-change") ? 9 : p.includes("Title: tool") ? 5 : 1;
        return JSON.stringify({
          score,
          summary: "It says a thing.",
          changes: score > 8 ? ["email-infra", "made-up-sop"] : [],
          why: "Because.",
        });
      },
    });
    const tally = await walk(walker(llm), "watch", "read.items", added.map(itemEvent));
    expect(tally).toMatchObject({ arrived: 3, failed: 0 });
    expect(prompts[0]).toContain("- email-infra: Domains and warmup. Covers: Warmup.");
    const rows = await pg.db.select().from(items).orderBy(asc(items.id));
    expect(rows.map((r) => [r.title, r.score, r.verdict, r.changes])).toEqual([
      ["old", null, "drop", []],
      ["warmup-change", 9, "show", ["email-infra"]],
      ["gossip", 1, "drop", []],
      ["tool", 5, "hold", []],
    ]);
    const outs = await pg.db.execute(sql`SELECT port FROM events WHERE node = 'out'`);
    expect([...outs]).toEqual([{ port: "to_read" }]);

    const queue = await pg.db.execute(sql`SELECT title, queue FROM watch.item_records ORDER BY id`);
    expect([...queue].map((r) => r.queue)).toEqual(["dropped", "needs_you", "dropped", "held"]);
    const shown = String(rows[1]?.id);
    expect((await api.itemDone({ ...viewer, ids: [shown] })).done).toEqual([shown]);
    const [feed] = await pg.db.execute(sql`SELECT state, items, shown FROM watch.feed_records`);
    expect(feed).toEqual({ state: "following", items: 4, shown: 1 });
  });

  it("keeps a failing feed's error, refuses a bad address, and stops on unfollow", async () => {
    const state = { entries: ["a"], down: false };
    const api = watchConsoleApi(pg.db, null, feedOf(state));
    await expect(api.follow({ ...viewer, url: "ftp://x" })).rejects.toThrow(/https/);
    await api.follow({ ...viewer, url: "https://news.example/feed", name: "News" });
    state.down = true;
    const later = new Date(Date.now() + 2 * 3_600_000);
    expect((await pullFeeds(pg.db, feedOf(state), later)).failed).toEqual([
      { feed: "News", error: "https://news.example/feed: HTTP 503" },
    ]);
    await api.unfollow({ ...viewer, ids: ["1"] });
    expect((await pullFeeds(pg.db, feedOf(state), later)).failed).toEqual([]);
    const [feed] = await pg.db.execute(sql`SELECT state FROM watch.feed_records`);
    expect(feed).toEqual({ state: "stopped" });
  });
});
