/**
 * Email link clicks against the migrated schema: the hourly pull stores one row per code and
 * page, a code names its message and company, a code no message holds stays unnamed, and a pull
 * that dies half way never counts a view twice.
 */
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { syncClicks } from "../../src/inbox/click-sync.js";
import {
  type ClickedEmail,
  clickedEmails,
  clickFollowUps,
  SITE_PAGE,
  type SiteApplication,
  SiteExportError,
  type SiteHit,
} from "../../src/inbox/clicks.js";
import { clickSyncs, emailClicks } from "../../src/schema.js";
import { allMessages, makeCompany, makePerson, runCompose, TABLES } from "./compose-fixtures.js";

const BASE = "https://site.example";
const SECRET = "not-the-real-one";
const MIN = 60_000;
/** Views are dated from the wall clock: nothing here depends on today's date. */
const T0 = Date.now() - 3 * 24 * 60 * MIN;
const at = (min: number) => new Date(T0 + min * MIN).toISOString();

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, [...TABLES, "click_syncs", "email_clicks"]));
const db = (): Db => pg.db;

let n = 0;
const view = (min: number, over: Partial<SiteHit> = {}): SiteHit => ({
  id: ++n,
  ts: at(min),
  visitor: "v1",
  page: "/",
  secs: 20,
  cta: 0,
  touched: 0,
  r: "",
  ...over,
});
beforeEach(() => {
  n = 0;
});

/** A stand-in for the lander's /api/export: pages by id like the real one, refuses a wrong bearer. */
function lander(rows: () => SiteHit[], opts: { failAfter?: number; expectSecret?: string } = {}) {
  const calls: URL[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    calls.push(parsed);
    if (new Headers(init?.headers).get("authorization") !== `Bearer ${opts.expectSecret ?? SECRET}`)
      return new Response("no", { status: 401 });
    if (opts.failAfter !== undefined && calls.length > opts.failAfter)
      return new Response("down", { status: 503 });
    const since = Number(parsed.searchParams.get("since") ?? "0");
    const limit = Number(parsed.searchParams.get("limit") ?? "5000");
    return Response.json({
      hits: rows()
        .filter((h) => h.id > since)
        .slice(0, limit),
    });
  };
  return { fetch, calls };
}

const sync = (fetch: ReturnType<typeof lander>["fetch"], baseUrl = BASE) =>
  syncClicks(db(), { baseUrl, exportToken: SECRET, fetch });

async function sentCode(domain: string, name: string): Promise<string> {
  const company = await makeCompany(db(), { domain, name });
  await makePerson(db(), company, { email: `jane@${domain}` });
  await runCompose(db());
  const mine = (await allMessages(db())).filter((m) => m.toEmail === `jane@${domain}`);
  const code = mine[0]?.linkCode;
  if (!code) throw new Error("no link code minted");
  return code;
}

describe("syncClicks", () => {
  it("stores one row per code and page, names the message, and ignores views with no code", async () => {
    const code = await sentCode("oakbridge.example", "Oakbridge");
    const rows = [
      view(1, { r: code }),
      view(2, { page: "/recruiting" }),
      view(3, { r: code }),
      view(4, { r: code, page: "/book/reactivation" }),
      view(5, { r: "typedByHand1" }),
    ];

    const stats = await sync(lander(() => rows).fetch);

    expect(stats).toMatchObject({
      fetched: 5,
      coded: 4,
      matched: 3,
      unknown_code: 1,
      unreadable: 0,
    });
    const stored = await db().select().from(emailClicks);
    // Codes are random, so order the rows by what they say, not by the code.
    const byPage = stored
      .map((r) => [
        r.linkCode === code ? "mine" : r.linkCode,
        r.url,
        r.clicks,
        r.messageId !== null,
      ])
      .sort(
        (x, y) =>
          String(x[1]).localeCompare(String(y[1])) || String(x[0]).localeCompare(String(y[0])),
      );
    expect(byPage).toEqual([
      ["mine", "/", 2, true],
      ["typedByHand1", "/", 1, false],
      ["mine", "/book/reactivation", 1, true],
    ]);
    const home = stored.find((r) => r.url === "/" && r.linkCode === code);
    expect(home?.firstAt.toISOString()).toBe(at(1));
    expect(home?.lastAt.toISOString()).toBe(at(3));
  });

  it("a second pull of the same window counts nothing new, and a later view adds to the row", async () => {
    const code = await sentCode("one.example", "One");
    const rows = [view(1, { r: code })];
    const { fetch, calls } = lander(() => rows);

    await sync(fetch);
    const again = await sync(fetch);
    expect(again.fetched).toBe(0);
    expect((await db().select().from(emailClicks))[0]?.clicks).toBe(1);
    expect(Number(calls.at(-1)?.searchParams.get("since"))).toBe(1);

    rows.push(view(90, { r: code }));
    await sync(fetch);
    const [row] = await db().select().from(emailClicks);
    expect(row?.clicks).toBe(2);
    expect(row?.firstAt.toISOString()).toBe(at(1));
    expect(row?.lastAt.toISOString()).toBe(at(90));
    const [cursor] = await db().select().from(clickSyncs).where(eq(clickSyncs.baseUrl, BASE));
    expect(cursor?.cursorId).toBe(2);
  });

  it("the cursor moves past views that carry no code", async () => {
    const rows = [view(1), view(2), view(3)];
    const { fetch, calls } = lander(() => rows);

    await sync(fetch);
    await sync(fetch);

    expect(await db().select().from(emailClicks)).toEqual([]);
    expect(Number(calls.at(-1)?.searchParams.get("since"))).toBe(3);
  });

  it("a coded view with no readable time is counted and left out", async () => {
    const code = await sentCode("bad.example", "Bad");
    const rows = [view(1, { r: code, ts: "not a time" }), view(2, { r: code })];

    const stats = await sync(lander(() => rows).fetch);

    expect(stats).toMatchObject({ coded: 2, unreadable: 1, matched: 1 });
    expect((await db().select().from(emailClicks))[0]?.clicks).toBe(1);
  });

  it("a pull that dies half way counts each view once on the next run", async () => {
    const code = await sentCode("big.example", "Big");
    // A full first page, then a few more: the second request is where the lander goes down.
    const rows: SiteHit[] = [];
    for (let i = 0; i < SITE_PAGE + 3; i++)
      rows.push(view(i % 100, i % 1000 === 0 ? { r: code } : {}));
    const coded = rows.filter((h) => h.r === code).length;
    const firstPageCoded = rows.slice(0, SITE_PAGE).filter((h) => h.r === code).length;
    rows.push(view(7, { r: code }));

    const raised = await sync(lander(() => rows, { failAfter: 1 }).fetch).catch(
      (err: unknown) => err,
    );
    expect(raised).toBeInstanceOf(SiteExportError);
    expect((await db().select().from(emailClicks))[0]?.clicks).toBe(firstPageCoded);
    const [held] = await db().select().from(clickSyncs);
    expect(held?.cursorId).toBe(SITE_PAGE);

    await sync(lander(() => rows).fetch);

    expect((await db().select().from(emailClicks))[0]?.clicks).toBe(coded + 1);
  });

  it("a refused credential is named without being printed", async () => {
    const raised = await sync(lander(() => [], { expectSecret: "something-else" }).fetch).catch(
      (err: unknown) => err,
    );

    expect(raised).toBeInstanceOf(SiteExportError);
    expect(String(raised)).toContain("WREN_SITE_EXPORT_TOKEN");
    expect(String(raised)).not.toContain(SECRET);
  });

  it("each host keeps its own cursor", async () => {
    const code = await sentCode("two.example", "Two");
    const rows = [view(1, { r: code })];
    const { fetch } = lander(() => rows);

    await sync(fetch, "https://one.example");
    await sync(fetch, "https://two.example");

    const cursors = await db().select().from(clickSyncs);
    expect(cursors.map((c) => c.baseUrl).sort()).toEqual([
      "https://one.example",
      "https://two.example",
    ]);
  });
});

describe("clickedEmails", () => {
  it("names the message and company behind each code, one row per email, latest click first", async () => {
    const oak = await sentCode("oakbridge.example", "Oakbridge");
    const pine = await sentCode("pine.example", "Pinecrest");
    const rows = [
      view(1, { r: oak }),
      view(5, { r: pine, page: "/recruiting" }),
      view(9, { r: oak }),
      view(30, { r: "typedByHand1" }),
    ];
    await sync(lander(() => rows).fetch);

    const clicks = await clickedEmails(db());

    expect(
      clicks.map((c) => [c.code === oak ? "oak" : c.code === pine ? "pine" : c.code, c.clicks]),
    ).toEqual([
      ["typedByHand1", 1],
      ["oak", 2],
      ["pine", 1],
    ]);
    expect(clicks[0]?.message).toBeNull();
    expect(clicks[1]?.message).toMatchObject({
      company: "Oakbridge",
      toEmail: "jane@oakbridge.example",
      step: 0,
    });
    expect(clicks[2]).toMatchObject({ pages: ["/recruiting"] });
    expect(await clickedEmails(db(), { limit: 1 })).toHaveLength(1);
  });

  it("folds one email's pages into one row: pages listed, clicks added, first and last kept", async () => {
    const oak = await sentCode("oakbridge.example", "Oakbridge");
    await sync(
      lander(() => [
        view(2, { r: oak }),
        view(8, { r: oak, page: "/recruiting" }),
        view(20, { r: oak }),
      ]).fetch,
    );

    const [row, ...rest] = await clickedEmails(db());

    expect(rest).toEqual([]);
    expect(row).toMatchObject({ code: oak, pages: ["/", "/recruiting"], clicks: 3 });
    expect(row?.firstAt.toISOString()).toBe(at(2));
    expect(row?.lastAt.toISOString()).toBe(at(20));
  });
});

const applied = (id: number, visitor: string, fit: 0 | 1, minutes: number): SiteApplication => ({
  id,
  ts: at(minutes),
  visitor,
  offer: "recruiting",
  fit,
  r: "",
});

describe("clickFollowUps", () => {
  const follow = async (rows: SiteHit[], apps: SiteApplication[] = []) => {
    await sync(lander(() => rows).fetch);
    const clicks: ClickedEmail[] = await clickedEmails(db());
    const after = clickFollowUps(rows, apps);
    return { clicks, after };
  };

  it("follows each clicker through later visits, the form, and an application, by code", async () => {
    const oak = await sentCode("oakbridge.example", "Oakbridge");
    const pine = await sentCode("pine.example", "Pinecrest");
    const rows = [
      view(1, { r: oak, visitor: "a", secs: 10 }),
      view(40, { visitor: "a", page: "/recruiting", secs: 30, cta: 1 }),
      view(50, { visitor: "a", page: "/book", secs: 5 }),
      view(2, { r: pine, visitor: "b", secs: 7 }),
      view(3, { visitor: "c", secs: 99 }),
    ];

    const { after } = await follow(rows, [applied(1, "a", 1, 60), applied(2, "c", 1, 61)]);

    expect(after.get(oak)).toEqual({
      visitors: 1,
      views: 3,
      secs: 45,
      reachedForm: true,
      applied: { offer: "recruiting", fit: true, ts: at(60) },
    });
    expect(after.get(pine)).toEqual({
      visitors: 1,
      views: 1,
      secs: 7,
      reachedForm: false,
      applied: null,
    });
  });

  it("counts a forwarded email's second browser, and picks a fit application over an earlier miss", async () => {
    const oak = await sentCode("oakbridge.example", "Oakbridge");
    const rows = [
      view(1, { r: oak, visitor: "phone", secs: 4 }),
      view(30, { r: oak, visitor: "desk", secs: 12, touched: 1 }),
    ];

    const { after } = await follow(rows, [applied(1, "phone", 0, 5), applied(2, "desk", 1, 31)]);

    expect(after.get(oak)).toMatchObject({
      visitors: 2,
      views: 2,
      secs: 16,
      reachedForm: true,
      applied: { fit: true, ts: at(31) },
    });
  });

  it("has no entry for a stored code the export no longer shows", async () => {
    const oak = await sentCode("oakbridge.example", "Oakbridge");
    await sync(lander(() => [view(1, { r: oak })]).fetch);

    const clicks = await clickedEmails(db());
    const after = clickFollowUps([view(2, { r: "other" })], []);

    expect(clicks.map((c) => c.code)).toEqual([oak]);
    expect(after.has(oak)).toBe(false);
  });
});
