/**
 * A client's own Learn (designs/2026-10-07-learn.md, "Client workspaces"): its logins see and
 * manage only its sources, items, collections and alerts, through LearnConsole (behind the
 * portal's guard) and through `wren learn --client`. Its items are scored on its own models
 * allowance, against its own SOPs, and an SOP from its items lands in its own Notes. Two clients
 * and Wren never mix. Synthetic clients, people and addresses only.
 */
import { addClient, addMember } from "@wren/core/clients";
import { addGrant } from "@wren/core/grants";
import { guard, type PortalRequest, whoIs } from "@wren/core/portal";
import { setManaged } from "@wren/core/vendors";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { notes } from "@wren/notes/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { learnConsoleApi } from "../../src/console.js";
import { LEARN_CONSOLE_APPS, LEARN_CONSOLE_ROUTES } from "../../src/console-routes.js";
import {
  askNoteSop,
  clientAskedOnRead,
  collections,
  items,
  judges,
  practiceOf,
  scoreItem,
  sopLibrary,
  sources,
  tellLearn,
  writeAsked,
} from "../../src/index.js";

const ADMIN = "ada@wren.example.test";
const AMY = "amy@alpha.example.test"; // alpha's owner
const VAL = "val@alpha.example.test"; // alpha's viewer
const BO = "bo@beta.example.test"; // beta's owner

let pg: TestPostgres;
let alphaDb: Db;
let betaDb: Db;
const open = (id: string) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${id}`));

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, { id: "alpha", name: "Alpha Dental" });
  await addClient(pg.db, pg.url, { id: "beta", name: "Beta Roofing" });
  await pg.db.execute(sql`insert into operators (email, role) values (${ADMIN}, 'admin')`);
  await addMember(pg.db, "alpha", AMY, { role: "owner" });
  await addMember(pg.db, "alpha", VAL, { role: "viewer" });
  await addMember(pg.db, "beta", BO, { role: "owner" });
  // Alpha has a models allowance; beta has none, so its scoring waits.
  await setManaged(pg.db, {
    client: "alpha",
    vendor: "models",
    perDay: 100,
    capCents: 500,
    by: "test",
  });
  alphaDb = open("alpha");
  betaDb = open("beta");
}, 180_000);
afterAll(() => pg?.stop());
beforeEach(async () => {
  await pg.db.execute(
    sql`TRUNCATE learn.item_tags, learn.collections, learn.sop_sources, learn.items, learn.sources, learn.seen, vendor_usage RESTART IDENTITY CASCADE`,
  );
  for (const db of [pg.db, alphaDb, betaDb]) await db.execute(sql`delete from notes`);
});

const fetchNone = (async () => new Response("", { status: 404 })) as typeof fetch;
const api = () => learnConsoleApi(pg.db, fetchNone, open);
type Api = ReturnType<typeof api>;
type Route = keyof typeof LEARN_CONSOLE_ROUTES & keyof Api;

/** A call as the portal makes it: the route's guard first, then the handler. */
async function as<K extends Route>(
  email: string,
  route: K,
  body: Record<string, unknown> = {},
): Promise<Awaited<ReturnType<Api[K]>>> {
  const operator = email === ADMIN;
  const req = { viewer: { email, ...(operator ? { operator } : {}) }, ...body } as PortalRequest;
  const app = LEARN_CONSOLE_APPS["*"];
  const passed = await guard(pg.db, LEARN_CONSOLE_ROUTES[route], req, "wren", { app });
  const fn = api()[route] as (r: PortalRequest) => Promise<Awaited<ReturnType<Api[K]>>>;
  return fn(passed);
}
const refused = async (p: Promise<unknown>, status: number, words?: RegExp) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e as { status?: number; message?: string },
  );
  expect(err, "expected a refusal").not.toBeNull();
  expect(err?.status).toBe(status);
  if (words) expect(err?.message).toMatch(words);
};

/** One workspace's source, item, collection and tag: synthetic addresses only. */
async function seed(client: string, n: number) {
  const [src] = await pg.db
    .insert(sources)
    .values({
      client,
      url: `https://feeds.example/${client}.xml`,
      name: `${client} feed`,
      avatarUrl: `https://img.example/${client}.png`,
    })
    .returning();
  const [item] = await pg.db
    .insert(items)
    .values({
      client,
      url: `https://news.example/${client}/${n}`,
      title: `${client} item ${n}`,
      sourceId: src?.id,
      text: `${client} words about recall reminders`,
      transcript: `${client} words about recall reminders`,
      thumbnailUrl: `https://img.example/${client}-t.jpg`,
      readAt: new Date(),
      verdict: "show",
      score: 8,
      scoredAt: new Date(),
    })
    .returning();
  const [col] = await pg.db
    .insert(collections)
    .values({ client, name: `${client} folder` })
    .returning();
  return {
    source: src?.id as number,
    item: item?.id as number,
    collection: col?.id as number,
  };
}
const row = async (id: number) =>
  (await pg.db.select().from(items).where(eq(items.id, id)))[0] ?? null;

describe("a client's login in its own Learn", () => {
  it("saves, browses, searches and counts in its own workspace only", async () => {
    const a = await seed("alpha", 1);
    await seed("beta", 1);
    await seed("wren", 1);
    const saved = await as(AMY, "save", { url: "https://news.example/alpha-saved" });
    expect((await row(Number(saved.id)))?.client).toBe("alpha");

    const all = await as(AMY, "browse", { place: "all" });
    expect(all.items.map((c) => c.title).sort()).toEqual([
      "alpha item 1",
      "https://news.example/alpha-saved",
    ]);
    const rail = await as(AMY, "rail");
    expect(rail.places.all).toBe(2);
    expect(rail.collections.map((c) => c.id)).toEqual([a.collection]);
    expect(rail.sources.flatMap((k) => k.sources.map((s) => s.id))).toEqual([a.source]);
    const home = await as(AMY, "home");
    expect(home.top.map((c) => c.id)).toEqual([a.item]);
    const kinds = (await as(AMY, "sources")).kinds;
    expect(kinds.flatMap((k) => k.sources.map((s) => s.id))).toEqual([a.source]);
    const hits = (await as(AMY, "search", { q: "recall reminders" })).hits;
    expect(hits.map((h) => h.id)).toEqual([a.item]);
    expect(await as(AMY, "unseen")).toEqual({ n: 1 });
    await as(AMY, "seen");
    expect(await as(AMY, "unseen")).toEqual({ n: 0 });
    // Following a feed is the client's own source, even when Wren follows the same one.
    const both = "https://feeds.example/wren.xml";
    const feed = `<?xml version="1.0"?><rss><channel><title>Shared</title></channel></rss>`;
    const fetchFeed = (async () => new Response(feed, { status: 200 })) as typeof fetch;
    const got = await learnConsoleApi(pg.db, fetchFeed, open).follow(
      await guard(
        pg.db,
        "act",
        { viewer: { email: AMY }, url: both } as unknown as PortalRequest & { url: string },
        "wren",
        { app: "learn" },
      ),
    );
    const [mine] = await pg.db
      .select()
      .from(sources)
      .where(eq(sources.id, Number(got.id)));
    expect(mine?.client).toBe("alpha");
    expect(
      (await pg.db.select().from(sources).where(eq(sources.url, both))).map((s) => s.client).sort(),
    ).toEqual(["alpha", "wren"]);
  });

  it("can't list, read, move, tag or delete another workspace's things", async () => {
    const a = await seed("alpha", 1);
    for (const other of [await seed("beta", 1), await seed("wren", 1)]) {
      const id = String(other.item);
      await refused(as(AMY, "item", { id }), 404, /no such item/);
      expect((await as(AMY, "mark", { ids: [id], mark: "archive" })).done).toEqual([]);
      expect((await as(AMY, "mark", { ids: [id], mark: "star" })).done).toEqual([]);
      expect((await as(AMY, "move", { ids: [id], collection: String(a.collection) })).done).toEqual(
        [],
      );
      await refused(
        as(AMY, "move", { ids: [String(a.item)], collection: String(other.collection) }),
        400,
        /no such collection/,
      );
      expect((await as(AMY, "tag", { ids: [id], add: ["mine"] })).done).toEqual([]);
      await refused(as(AMY, "collectionDrop", { id: String(other.collection) }), 404);
      await refused(
        as(AMY, "collectionEdit", { id: String(other.collection), name: "Taken" }),
        400,
        /no such collection/,
      );
      await refused(
        as(AMY, "collectionAdd", { name: "Inside", parent: String(other.collection) }),
        400,
        /no such collection/,
      );
      expect(
        (await as(AMY, "unfollow", { ids: [String(other.source)] })).done,
        "unfollow another's source",
      ).toEqual([]);
      expect((await as(AMY, "tell", { ids: [String(other.source)], tell: "every" })).done).toEqual(
        [],
      );
      expect((await as(AMY, "readAgain", { ids: [id] })).done).toEqual([]);
      await refused(as(AMY, "toSop", { ids: [id], sop: "recalls" }), 400, /No item/);
      expect((await as(AMY, "media", { ids: [id] })).urls).toEqual([]);
      await as(AMY, "open", { id });
      await as(AMY, "progress", { id, position: 99 });
      const after = await row(other.item);
      expect(after).toMatchObject({
        archivedAt: null,
        starredAt: null,
        collectionId: null,
        openedAt: null,
        position: null,
      });
      const src = (await pg.db.select().from(sources).where(eq(sources.id, other.source)))[0];
      expect(src).toMatchObject({ stoppedAt: null, tell: "top" });
      const col = (
        await pg.db.select().from(collections).where(eq(collections.id, other.collection))
      )[0];
      expect(col?.name).not.toBe("Taken");
      // A place naming another's source or collection shows nothing.
      expect((await as(AMY, "browse", { place: `s${other.source}` })).items).toEqual([]);
      expect((await as(AMY, "browse", { place: `c${other.collection}` })).items).toEqual([]);
    }
    const tagged = await pg.db.execute(sql`select count(*)::int n from learn.item_tags`);
    expect(tagged[0]).toEqual({ n: 0 });
  });

  it("can't name another client, or Wren's own", async () => {
    await seed("beta", 1);
    await refused(as(AMY, "browse", { client: "beta" }), 403);
    await refused(as(AMY, "save", { client: "beta", url: "https://news.example/x" }), 403);
    await refused(as(AMY, "browse", { client: "wren" }), 403);
    await refused(as(BO, "rail", { client: "alpha" }), 403);
  });

  it("reads with a viewer's role, and acts with an act grant on Learn", async () => {
    const a = await seed("alpha", 1);
    expect((await as(VAL, "browse", { place: "all" })).items.map((c) => c.id)).toEqual([a.item]);
    await refused(as(VAL, "mark", { ids: [String(a.item)], mark: "star" }), 403);
    await refused(as(VAL, "save", { url: "https://news.example/val" }), 403);
    const admin = await whoIs(pg.db, { email: ADMIN });
    await addGrant(pg.db, admin, ADMIN, {
      email: VAL,
      client: "alpha",
      verbs: ["act"],
      apps: ["learn"],
    });
    expect((await as(VAL, "mark", { ids: [String(a.item)], mark: "star" })).done).toEqual([
      String(a.item),
    ]);
    // The workspace's alerts per source are a manager's: an act grant isn't enough.
    expect((await as(VAL, "sources")).may).toBe(false);
    await refused(as(VAL, "tell", { ids: [String(a.source)], tell: "every" }), 403);
    expect((await as(AMY, "sources")).may).toBe(true);
    expect((await as(AMY, "tell", { ids: [String(a.source)], tell: "every" })).done).toEqual([
      String(a.source),
    ]);
  });

  it("leaves Wren's team in Wren's own unless it names a client", async () => {
    const a = await seed("alpha", 1);
    const w = await seed("wren", 1);
    expect((await as(ADMIN, "browse", { place: "all" })).items.map((c) => c.id)).toEqual([w.item]);
    expect(
      (await as(ADMIN, "browse", { place: "all", client: "alpha" })).items.map((c) => c.id),
    ).toEqual([a.item]);
    expect(
      (await as(ADMIN, "media", { ids: [String(a.item), String(w.item)] })).urls.sort(),
    ).toEqual(["https://img.example/wren-t.jpg", "https://img.example/wren.png"]);
    expect(
      (
        await as(ADMIN, "media", { client: "alpha", ids: [String(a.item), String(w.item)] })
      ).urls.sort(),
    ).toEqual(["https://img.example/alpha-t.jpg", "https://img.example/alpha.png"]);
  });
});

describe("a client's items are its own to score and keep", () => {
  const prompts: string[] = [];
  const llm = new FakeLlm({
    respond: (prompt, system) => {
      prompts.push(`${system ?? ""}\n${prompt}`);
      return JSON.stringify({
        score: 8,
        summary: "It says a thing.",
        changes: [],
        why: "Because.",
      });
    },
  });
  const judge = () =>
    judges({
      db: pg.db,
      llm,
      wrenPractices: async () => [practiceOf("wren-secret-playbook", "Wren's own way.")],
    });
  const unscored = async (client: string, n: number) => {
    const [i] = await pg.db
      .insert(items)
      .values({
        client,
        url: `https://news.example/${client}/u${n}`,
        title: `${client} unscored ${n}`,
        text: "Words.",
        transcript: "Words.",
        readAt: new Date(),
      })
      .returning();
    return i?.id as number;
  };

  it("scores a client's on its own allowance, against its own SOPs, never Wren's", async () => {
    prompts.length = 0;
    const a = await unscored("alpha", 1);
    await pg.db.execute(
      sql`insert into learn.sop_sources (item_id, sop, state) values (${a}, 'patient-recalls', 'added')`,
    );
    expect(await scoreItem(pg.db, judge(), a)).toBe("show");
    const [p] = prompts;
    expect(p).toContain("Alpha Dental");
    expect(p).toContain("patient-recalls");
    expect(p).not.toMatch(/Wren|wren-secret-playbook/);
    const used = await pg.db.execute(
      sql`select client, vendor, part, units from vendor_usage order by id`,
    );
    expect(used).toEqual([{ client: "alpha", vendor: "models", part: "learn.score", units: 1 }]);
    // Wren's own is judged against Wren's SOPs, and spends no client's allowance.
    prompts.length = 0;
    const w = await unscored("wren", 2);
    expect(await scoreItem(pg.db, judge(), w)).toBe("show");
    expect(prompts[0]).toContain("wren-secret-playbook");
    expect(await pg.db.execute(sql`select count(*)::int n from vendor_usage`)).toEqual([{ n: 1 }]);
  });

  it("waits, unscored, when the client has no models allowance", async () => {
    prompts.length = 0;
    const b = await unscored("beta", 1);
    expect(await scoreItem(pg.db, judge(), b)).toBeNull();
    expect(prompts).toEqual([]);
    expect(await row(b)).toMatchObject({
      verdict: null,
      why: expect.stringMatching(/^Waits for models/),
    });
    // Read again puts it back once the allowance is set.
    expect((await as(BO, "readAgain", { ids: [String(b)] })).done).toEqual([String(b)]);
  });

  it("tells William about Wren's own items only", async () => {
    const sent: string[] = [];
    const notifier = {
      name: "test",
      notify: async (title: string, body = "") => {
        sent.push(`${title}\n${body}`);
        return true;
      },
    };
    for (const client of ["alpha", "wren"]) {
      const s = await seed(client, 7);
      await pg.db.update(sources).set({ tell: "every" }).where(eq(sources.id, s.source));
    }
    const now = new Date();
    expect(await tellLearn(pg.db, notifier, { today: "2026-10-07", hour: 8, now })).toEqual({
      alerts: 1,
      digest: 0,
    });
    expect(sent.join("\n")).toContain("wren item 7");
    expect(sent.join("\n")).not.toContain("alpha");
  });

  it("a note's words into an SOP: a client's into its Notes now, Wren's asked for the Mac", async () => {
    const ask = {
      noteId: "00000000-0000-4000-8000-000000000001",
      sop: "patient-recalls",
      title: "Front desk",
      text: "Call within two days.",
      by: AMY,
    };
    await expect(
      askNoteSop(pg.db, alphaDb, { ...ask, client: "alpha", sop: "Bad!" }),
    ).rejects.toThrow(/lowercase/);
    const out = await askNoteSop(pg.db, alphaDb, { ...ask, client: "alpha" });
    expect(out).toMatchObject({ sop: "patient-recalls", state: "added" });
    const inAlpha = await alphaDb.select().from(notes);
    const parent = inAlpha.find((n) => n.parentId === null);
    expect(parent?.title).toBe("patient-recalls");
    expect(inAlpha.find((n) => n.id === out.note)).toMatchObject({
      parentId: parent?.id,
      title: "Front desk",
      text: expect.stringContaining("two days"),
    });
    expect((await sopLibrary(pg.db, "alpha", null)).map((r) => [r.sop, r.fromItems])).toEqual([
      ["patient-recalls", 1],
    ]);
    expect(await sopLibrary(pg.db, "beta", null)).toEqual([]);

    const wren = await askNoteSop(pg.db, pg.db, { ...ask, client: "wren", sop: "email-infra" });
    expect(wren).toEqual({ sop: "email-infra", state: "asked", note: null });
    expect(await pg.db.select().from(notes)).toEqual([]);
    const written: Array<{ name: string; md: string }> = [];
    const out2 = await writeAsked(pg.db, "/sops", {
      add: async (_d, s) => {
        written.push(s);
        return s.name;
      },
      extract: async () => {},
    });
    expect(out2).toEqual([
      { sop: "email-infra", file: expect.stringMatching(/^note-00000000-\d+\.md$/), error: null },
    ]);
    expect(written[0]?.md).toBe("# Front desk\n\nCall within two days.");
    expect(
      await writeAsked(pg.db, "/sops", { add: async () => "", extract: async () => {} }),
    ).toEqual([]);
  });

  it("writes a client's SOP into its own Notes, never Wren's or another's", async () => {
    const a = await seed("alpha", 1);
    expect(
      (await as(AMY, "toSop", { ids: [String(a.item)], sop: "patient-recalls" })).done,
    ).toEqual([String(a.item)]);
    const inAlpha = await alphaDb.select().from(notes);
    const parent = inAlpha.find((n) => n.parentId === null);
    expect(parent).toMatchObject({ title: "patient-recalls", general: "workspace" });
    const child = inAlpha.find((n) => n.parentId === parent?.id);
    expect(child?.title).toBe("alpha item 1");
    expect(child?.text).toContain("recall reminders");
    expect(await pg.db.select().from(notes)).toEqual([]);
    expect(await betaDb.select().from(notes)).toEqual([]);
    const [ask] = await pg.db.execute(sql`select state, file from learn.sop_sources`);
    expect(ask).toEqual({ state: "added", file: `note:${child?.id}` });

    // One not read yet waits, and goes in once it's read and scored.
    const later = await pg.db
      .insert(items)
      .values({ client: "alpha", url: "https://news.example/alpha/later", title: "Later one" })
      .returning();
    const id = later[0]?.id as number;
    await as(AMY, "toSop", { ids: [String(id)], sop: "patient-recalls" });
    expect(await alphaDb.select().from(notes)).toHaveLength(2);
    await pg.db
      .update(items)
      .set({ readAt: new Date(), transcript: "Later words." })
      .where(eq(items.id, id));
    await clientAskedOnRead(pg.db, open)(id);
    const after = await alphaDb.select().from(notes);
    expect(after).toHaveLength(3);
    expect(
      after
        .filter((n) => n.parentId === parent?.id)
        .map((n) => n.title)
        .sort(),
    ).toEqual(["Later one", "alpha item 1"]);
  });
});
