/**
 * Learn's alerts (designs/2026-10-07-learn.md, "Alerts"): each workspace's people get the
 * portal's bell by their own pick per source, at most N an hour, the rest rolled into Today. The
 * digest mail is off until someone who manages the workspace turns it on. Synthetic clients,
 * people and addresses only.
 */
import { addClient, addMember } from "@wren/core/clients";
import { guard, type PortalRequest } from "@wren/core/portal";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { learnConsoleApi } from "../../src/console.js";
import { LEARN_CONSOLE_APPS, LEARN_CONSOLE_ROUTES } from "../../src/console-routes.js";
import {
  type AlertPick,
  alertLearn,
  alerts,
  type DigestMail,
  items,
  learnPeople,
  mailLearnDigests,
  oneLine,
  setDigestMail,
  setPick,
  sources,
  type Tell,
} from "../../src/index.js";

const ADMIN = "ada@wren.example.test";
const OPS = "otto@wren.example.test"; // Wren's operator: no team, so no Wren Learn
const AMY = "amy@alpha.example.test"; // alpha's owner
const VAL = "val@alpha.example.test"; // alpha's viewer
const BO = "bo@beta.example.test"; // beta's owner

let pg: TestPostgres;
let n = 0;

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, { id: "alpha", name: "Alpha Dental" });
  await addClient(pg.db, pg.url, { id: "beta", name: "Beta Roofing" });
  await pg.db.execute(sql`insert into operators (email, role) values (${ADMIN}, 'admin')`);
  await pg.db.execute(sql`insert into operators (email, role) values (${OPS}, 'operator')`);
  await addMember(pg.db, "alpha", AMY, { role: "owner" });
  await addMember(pg.db, "alpha", VAL, { role: "viewer" });
  await addMember(pg.db, "beta", BO, { role: "owner" });
}, 180_000);
afterAll(() => pg?.stop());
beforeEach(async () => {
  await pg.db.execute(
    sql`TRUNCATE learn.alerts, learn.alert_picks, learn.readers, learn.settings, learn.items, learn.sources RESTART IDENTITY CASCADE`,
  );
  n = 0;
});

const fetchNone = (async () => new Response("", { status: 404 })) as typeof fetch;
const api = () => learnConsoleApi(pg.db, fetchNone);
type Api = ReturnType<typeof api>;
type Route = keyof typeof LEARN_CONSOLE_ROUTES & keyof Api;

/** A call as the portal makes it: the route's guard first, then the handler. */
async function as<K extends Route>(
  email: string,
  route: K,
  body: Record<string, unknown> = {},
): Promise<Awaited<ReturnType<Api[K]>>> {
  const operator = email === ADMIN || email === OPS;
  const req = { viewer: { email, ...(operator ? { operator } : {}) }, ...body } as PortalRequest;
  const passed = await guard(pg.db, LEARN_CONSOLE_ROUTES[route], req, "wren", {
    app: LEARN_CONSOLE_APPS["*"],
  });
  const fn = api()[route] as (r: PortalRequest) => Promise<Awaited<ReturnType<Api[K]>>>;
  return fn(passed);
}
const refused = async (p: Promise<unknown>, status: number) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e as { status?: number },
  );
  expect(err, "expected a refusal").not.toBeNull();
  expect(err?.status).toBe(status);
};

const T0 = new Date();
const ago = (min: number) => new Date(T0.getTime() - min * 60_000);

async function source(client: string, tell: Tell = "top") {
  const [s] = await pg.db
    .insert(sources)
    .values({
      client,
      url: `https://feeds.example/${client}-${tell}.xml`,
      name: `${client} ${tell}`,
      tell,
    })
    .returning();
  return s?.id as number;
}
async function item(
  client: string,
  p: { source?: number; score?: number | null; saved?: boolean; at?: Date; archived?: boolean },
) {
  n += 1;
  const at = p.at ?? ago(10);
  const scored = p.score !== undefined && p.score !== null;
  const [row] = await pg.db
    .insert(items)
    .values({
      client,
      url: `https://news.example/${client}/${n}`,
      title: `${client} item ${n}`,
      sourceId: p.source ?? null,
      summary: `Item ${n} says one thing. Then another.`,
      createdAt: at,
      ...(scored
        ? {
            readAt: at,
            score: p.score,
            verdict: (p.score as number) >= 7 ? "show" : "hold",
            scoredAt: at,
          }
        : {}),
      ...(p.saved ? { savedAt: at, savedBy: AMY, savedVia: "portal" as const } : {}),
      ...(p.archived ? { archivedAt: at } : {}),
    })
    .returning();
  return row?.id as number;
}
const told = async () =>
  (await pg.db.select().from(alerts).orderBy(alerts.email, alerts.itemId)).map(
    (a) => `${a.client} ${a.email} ${a.itemId} ${a.why} ${a.state}`,
  );

describe("who hears", () => {
  it("each workspace's people with Learn: Wren's team, a client's members", async () => {
    expect(await learnPeople(pg.db, "wren")).toEqual([ADMIN]);
    expect(await learnPeople(pg.db, "alpha")).toEqual([AMY, VAL]);
    expect(await learnPeople(pg.db, "beta")).toEqual([BO]);
  });
});

describe("alertLearn", () => {
  it("rings by each person's pick, defaulting to the source's own, never across workspaces", async () => {
    const top = await source("alpha", "top");
    const every = await source("alpha", "every");
    const quiet = await source("alpha", "digest");
    const high = await item("alpha", { source: top, score: 9 });
    await item("alpha", { source: top, score: 5 });
    const posted = await item("alpha", { source: every });
    await item("alpha", { source: quiet, score: 10 });
    await item("alpha", { source: top, score: 10, archived: true });
    await item("alpha", { source: top, score: 10, at: ago(25 * 60) });
    const beta = await item("beta", { source: await source("beta"), score: 9 });
    // Val wants nothing from the top source.
    await setPick(pg.db, "alpha", VAL, top, "off");

    expect(await alertLearn(pg.db, T0)).toEqual({ bell: 4, digest: 0 });
    expect(await told()).toEqual([
      `alpha ${AMY} ${high} score bell`,
      `alpha ${AMY} ${posted} new bell`,
      `beta ${BO} ${beta} score bell`,
      `alpha ${VAL} ${posted} new bell`,
    ]);
    // Nothing twice.
    expect(await alertLearn(pg.db, T0)).toEqual({ bell: 0, digest: 0 });
  });

  it("a saved link alerts once it scores high, unless the person turned saved links off", async () => {
    const low = await item("alpha", { saved: true, score: 4 });
    const high = await item("alpha", { saved: true, score: 9 });
    await item("alpha", { saved: true });
    await setPick(pg.db, "alpha", VAL, "saved", "off");
    await alertLearn(pg.db, T0);
    expect(await told()).toEqual([`alpha ${AMY} ${high} saved bell`]);
    expect(low).toBeGreaterThan(0);
  });

  it("rings at most N an hour per person; the rest roll into Today", async () => {
    const top = await source("alpha", "top");
    for (const s of [10, 9, 8, 8]) await item("alpha", { source: top, score: s });
    await setPick(pg.db, "alpha", VAL, top, "off");
    expect(await alertLearn(pg.db, T0, 2)).toEqual({ bell: 2, digest: 2 });
    const later = await item("alpha", { source: top, score: 9 });
    // Still within the hour: held. An hour on: it rings.
    expect(await alertLearn(pg.db, new Date(T0.getTime() + 30 * 60_000), 2)).toEqual({
      bell: 0,
      digest: 1,
    });
    await pg.db.delete(alerts).where(eq(alerts.itemId, later));
    expect(await alertLearn(pg.db, new Date(T0.getTime() + 61 * 60_000), 2)).toEqual({
      bell: 1,
      digest: 0,
    });
    const today = await as(AMY, "today", { client: "alpha" });
    expect(today.items.map((i) => i.score)).toEqual([10, 9, 9, 8, 8]);
    expect(today.held).toBe(2);
    expect(today.items[0]?.line).toBe("Item 1 says one thing.");
  });
});

describe("the console", () => {
  it("the bell, seen, Today and picks are each person's own", async () => {
    const top = await source("alpha", "top");
    const high = await item("alpha", { source: top, score: 9 });
    await alertLearn(pg.db, new Date());
    const bell = await as(AMY, "bell", { client: "alpha" });
    expect(bell.unseen).toBe(1);
    expect(bell.alerts.map((a) => [a.itemId, a.why, a.seen])).toEqual([[high, "score", false]]);
    expect(await as(AMY, "bellSeen", { client: "alpha" })).toEqual({ n: 1 });
    expect((await as(AMY, "bell", { client: "alpha" })).unseen).toBe(0);
    expect((await as(VAL, "bell", { client: "alpha" })).unseen).toBe(1);
    // Beta's owner sees none of it; Wren's bell is Wren's.
    expect((await as(BO, "bell", { client: "beta" })).alerts).toEqual([]);
    expect((await as(ADMIN, "bell")).alerts).toEqual([]);

    // A viewer picks for themself, not for anyone else.
    await as(VAL, "alertPick", { client: "alpha", source: String(top), pick: "every" });
    const kinds = async (who: string) =>
      (await as(who, "sources", { client: "alpha" })).kinds.flatMap((k) =>
        k.sources.map((s) => s.alert as AlertPick | null),
      );
    expect(await kinds(VAL)).toEqual(["every"]);
    expect(await kinds(AMY)).toEqual(["top"]);
    await refused(as(VAL, "alertPick", { client: "alpha", source: "saved", pick: "every" }), 400);
    await refused(
      as(VAL, "alertPick", { client: "alpha", source: String(top), pick: "loud" }),
      400,
    );
    const other = await source("beta");
    await refused(
      as(VAL, "alertPick", { client: "alpha", source: String(other), pick: "off" }),
      404,
    );
    await as(VAL, "alertPick", { client: "alpha", source: "saved", pick: "off" });
    expect((await as(VAL, "alerts", { client: "alpha" })).saved).toBe("off");
  });

  it("the digest mail is off until someone who manages the workspace turns it on", async () => {
    const off = await as(AMY, "alerts", { client: "alpha" });
    expect(off.mail).toEqual({ on: false, may: true, to: AMY });
    expect((await as(VAL, "alerts", { client: "alpha" })).mail.may).toBe(false);
    await refused(as(VAL, "digestMail", { client: "alpha", on: true }), 403);
    expect(await as(AMY, "digestMail", { client: "alpha", on: true })).toEqual({ on: true });
    expect((await as(VAL, "alerts", { client: "alpha" })).mail.on).toBe(true);
    // Wren's own: an admin only.
    await refused(as(OPS, "digestMail", { on: true }), 403);
    expect((await as(ADMIN, "alerts")).mail).toEqual({ on: false, may: true, to: ADMIN });
  });
});

describe("mailLearnDigests", () => {
  it("sends nothing while off, then once a day per person from 09:00", async () => {
    const top = await source("alpha", "top");
    await item("alpha", { source: top, score: 9 });
    await item("wren", { source: await source("wren"), score: 8 });
    const sent: DigestMail[] = [];
    const send = async (m: DigestMail) => void sent.push(m);
    const at = { now: T0, today: "2026-10-07", hour: 10, portal: "https://app.example.test" };
    expect(await mailLearnDigests(pg.db, send, at)).toEqual({ sent: 0, failed: 0 });

    await setDigestMail(pg.db, "alpha", true, AMY);
    expect(await mailLearnDigests(pg.db, send, { ...at, hour: 8 })).toEqual({
      sent: 0,
      failed: 0,
    });
    expect(await mailLearnDigests(pg.db, send, at)).toEqual({ sent: 2, failed: 0 });
    expect(sent.map((m) => m.to)).toEqual([AMY, VAL]);
    expect(sent[0]?.subject).toBe("Learn: 1 new today");
    expect(sent[0]?.text).toContain("9/10 alpha item");
    expect(sent[0]?.text).toContain("https://app.example.test/learn/today?client=alpha");
    expect(await mailLearnDigests(pg.db, send, at)).toEqual({ sent: 0, failed: 0 });
    expect(await mailLearnDigests(pg.db, send, { ...at, today: "2026-10-08" })).toEqual({
      sent: 2,
      failed: 0,
    });
  });

  it("a failed send is tried again next pass", async () => {
    await item("alpha", { source: await source("alpha"), score: 9 });
    await setDigestMail(pg.db, "alpha", true, AMY);
    const at = { now: T0, today: "2026-10-07", hour: 9, portal: null };
    const fail = async () => {
      throw new Error("smtp down");
    };
    expect(await mailLearnDigests(pg.db, fail, at)).toEqual({ sent: 0, failed: 2 });
    const sent: string[] = [];
    expect(await mailLearnDigests(pg.db, async (m) => void sent.push(m.to), at)).toEqual({
      sent: 2,
      failed: 0,
    });
  });
});

describe("oneLine", () => {
  it("keeps the first sentence, cut to fit", () => {
    expect(oneLine("First one. Second.")).toBe("First one.");
    expect(oneLine("  ")).toBeNull();
    expect(oneLine("x".repeat(200), 20)).toHaveLength(20);
  });
});
