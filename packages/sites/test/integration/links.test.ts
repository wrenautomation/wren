/**
 * Sites phase 2 leftovers on a real Postgres: tracked `/go/` links and what each brought, a
 * client's copy edits through its approver, and retiring a stopped split's pages through To
 * approve. Synthetic data only, no network.
 */
import { addClient, addMember, addOperator, clients } from "@wren/core/clients";
import type { PortalRefusal } from "@wren/core/portal";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { OFFERS } from "@wren/offers";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pageApprovalId, retireApprovalId, sitesApi } from "../../src/console.js";
import { hopOf } from "../../src/hops.js";
import { sitesPublicApi } from "../../src/service.js";
import { importLanderClicks, waitingRetires } from "../../src/store.js";

let pg: TestPostgres;
const TABLES = [
  "site_links",
  "site_hops",
  "site_split_arms",
  "site_splits",
  "site_events",
  "site_forms",
  "site_form_defs",
  "site_page_versions",
  "site_pages",
  "hooks",
  "client_domains",
  "client_members",
  "operators",
];
const offer = OFFERS.find((o) => o.status === "live") ?? OFFERS[0];
if (!offer) throw new Error("no offer");

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme Roofing", products: {} });
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, TABLES);
  await addOperator(pg.db, "ada@example.test");
  await addMember(pg.db, "acme", "cam@acme.example", { role: "member" });
  await pg.db.update(clients).set({ approver: "wren" });
});

const ADA = { email: "ada@example.test", operator: true } as never;
const CAM = { email: "cam@acme.example" } as never;
const api = () => sitesApi({ db: pg.db, write: null });
const pub = () => sitesPublicApi(pg.db);
const refused = async (p: Promise<unknown>, status: number) => {
  const err = (await p.catch((e: unknown) => e)) as PortalRefusal;
  expect(err?.status).toBe(status);
};

async function livePage(angle = "speed", owner: string | null = null) {
  const made = await api().create({ viewer: ADA, offer: offer!.id, angle, owner });
  await api().ask({ viewer: ADA, id: made.id });
  await api().approve({ viewer: ADA, ids: [pageApprovalId(made.id, 1)] });
  return made;
}

const host = (client: string, hostname: string) =>
  pg.db.execute(sql`
    insert into client_domains (hostname, client_id, cf_id, status, ssl_status, records, added_by)
    values (${hostname}, ${client}, 'cf-1', 'active', 'active', '{}'::jsonb, 'ada@example.test')`);

describe("tracked links", () => {
  it("makes one link per page and utm, on the owner's host, and counts what it brought", async () => {
    const page = await livePage("ads", "acme");
    await host("acme", "pages.acme.example");
    const t = await api().linkTargets({ viewer: CAM, owner: "acme" } as never);
    expect(t.host).toBe("pages.acme.example");
    expect(t.pages.map((p) => p.id)).toEqual([page.id]);
    expect(t.owners.map((o) => o.id)).toEqual(["acme"]);
    const all = await api().linkTargets({ viewer: ADA } as never);
    expect(all.owners.map((o) => o.id)).toEqual(["wren", "acme"]);

    const made = await api().linkCreate({
      viewer: CAM,
      owner: "acme",
      page: page.id,
      link: "ads",
      campaign: "Spring Promo",
      content: "120211234567890",
    } as never);
    expect(made.url).toBe(
      `https://pages.acme.example/go/ads/spring-promo/120211234567890?to=/o/${page.slug}`,
    );
    // The same utm again: the same link.
    const again = await api().linkCreate({
      viewer: ADA,
      owner: "acme",
      page: page.id,
      link: "ads",
      campaign: "spring-promo",
      content: "120211234567890",
    } as never);
    expect(again.id).toBe(made.id);
    // No campaign: the page's slug.
    const plain = await api().linkCreate({
      viewer: CAM,
      owner: "acme",
      page: page.id,
      link: "sms",
    } as never);
    expect(plain.url).toBe(`https://pages.acme.example/go/sms/${page.slug}?to=/o/${page.slug}`);

    // A click on the link, then its visit and form, as the edge and the kit send them.
    const u = new URL(made.url as string);
    const hop = hopOf(u.pathname, u.searchParams)!;
    await pub().hop({ client: "acme", ...hop });
    const touch = {
      source: "meta",
      medium: "paid",
      campaign: "spring-promo",
      content: "120211234567890",
    };
    await pub().track({ page: page.id, view: "v1", name: "view", touch });
    await pub().track({ page: page.id, view: "v1", name: "book", touch });
    await pub().track({ page: page.id, view: "v2", name: "view", touch: { source: "sms" } });
    const list = await api().recordsList({
      viewer: CAM,
      client: "acme",
      record: "sites.link",
    } as never);
    const row = list.rows.find((r) => r.id === made.id);
    expect(row).toMatchObject({ clicks: 1, visits: 1, books: 1, forms: 0, channel: "ads" });
    // The owner reads as the client's name; its id stays for filters.
    expect(row).toMatchObject({ owner: "acme", ownerName: "Acme Roofing" });
    expect(list.rows.find((r) => r.id === plain.id)).toMatchObject({ clicks: 0, visits: 0 });
  });

  it("puts Wren's links on the lander with its utm, and refuses another owner's page", async () => {
    const mine = await livePage("speed");
    const theirs = await livePage("theirs", "acme");
    const made = await api().linkCreate({
      viewer: ADA,
      page: mine.id,
      link: "gads",
      campaign: "q4",
    } as never);
    expect(made.url).toBe(`https://wrenautomation.com/go/gads/q4?to=/o/${mine.slug}`);
    const [row] = await pg.db.execute(sql`select source, medium, channel from site_links`);
    // The lander doesn't know `gads`: it credits the name.
    expect(row).toEqual({ source: "gads", medium: "link", channel: "other" });
    await refused(api().linkCreate({ viewer: ADA, page: theirs.id, link: "ads" } as never), 404);
    await refused(
      api().linkCreate({ viewer: CAM, owner: "acme", page: mine.id, link: "ads" } as never),
      404,
    );
    await refused(api().linkCreate({ viewer: CAM, page: mine.id, link: "ads" } as never), 403);
    await refused(api().linkCreate({ viewer: ADA, page: mine.id, link: "--" } as never), 400);
  });

  it("counts Wren's clicks from the lander's click log, by the page each went to", async () => {
    const mine = await livePage("speed");
    const other = await livePage("other");
    const made = await api().linkCreate({
      viewer: ADA,
      page: mine.id,
      link: "yt",
      campaign: "q4",
      content: "abc123",
    } as never);
    const click = (id: number, page: string, content = "abc123") => ({
      id,
      ts: "2026-10-08T12:00:00.000Z",
      link: "yt",
      source: "youtube",
      medium: "organic",
      campaign: "q4",
      content,
      page,
      ref: null,
    });
    const n = await importLanderClicks(pg.db, [
      click(1, `/o/${mine.slug}`),
      click(2, `/o/${mine.slug}`),
      // Another page, another post, a page that isn't Wren's: not this link's.
      click(3, `/o/${other.slug}`),
      click(4, `/o/${mine.slug}`, "zzz"),
      click(5, "/book"),
      // Not a click: no name.
      { ...click(6, `/o/${mine.slug}`), link: "" },
    ]);
    expect(n).toBe(5);
    // Wren's links list off the view itself (the core console serves Wren's records).
    const [row] = await pg.db.execute(
      sql`select clicks, owner, owner_name, last from site_link_records where id = ${made.id}`,
    );
    expect(row).toMatchObject({ clicks: 2, owner: "wren", owner_name: "Wren" });
    expect(new Date(row?.last as string).toISOString()).toBe("2026-10-08T12:00:00.000Z");
    const [hop] = await pg.db.execute(
      sql`select client, page, "to" from site_hops where "to" = '/book'`,
    );
    expect(hop).toEqual({ client: null, page: null, to: "/book" });
  });
});

describe("a client's copy editor", () => {
  it("saves a new version and asks through the client's approver", async () => {
    const page = await livePage("edit", "acme");
    const d = await api().detail({ viewer: CAM, id: page.id });
    const saved = await api().save({
      viewer: CAM,
      id: page.id,
      content: { ...d.draft!.content, headline: "Roof checks in a day" },
      expect: d.draft!.number,
    });
    expect(saved.draft).toBe(2);
    // An older draft open elsewhere can't overwrite it.
    await refused(
      api().save({ viewer: CAM, id: page.id, content: d.draft!.content, expect: 1 }),
      409,
    );
    await api().ask({ viewer: CAM, id: page.id });
    await refused(api().approve({ viewer: CAM, ids: [page.id] }), 403);
    await pg.db.update(clients).set({ approver: "client" }).where(eq(clients.id, "acme"));
    expect(await api().approve({ viewer: CAM, ids: [page.id] })).toEqual({ approved: 1 });
    const live = await pub().serve({ client: "acme", slug: page.slug });
    expect(live.html).toContain("Roof checks in a day");
  });
});

describe("retiring a stopped split's pages", () => {
  async function stoppedPair(owner: string | null = null) {
    const a = await livePage("speed", owner);
    const { made } = await api().duplicate({ viewer: ADA, ids: [a.id], angle: "cost" });
    const b = made[0]!;
    await api().ask({ viewer: ADA, id: b.id });
    await api().approve({ viewer: ADA, ids: [b.id] });
    await api().splitStart({ viewer: ADA, id: a.id, arms: [b.id] });
    return { a, b };
  }

  it("asks, waits in To approve, and on the yes answers gone with its numbers kept", async () => {
    const { a, b } = await stoppedPair();
    await pub().track({ page: b.id, view: "b1", name: "view", touch: {} });
    // Not while the split runs; never A.
    await refused(api().retireAsk({ viewer: ADA, id: b.id }), 409);
    await api().splitStop({ viewer: ADA, id: a.id });
    await refused(api().retireAsk({ viewer: ADA, id: a.id }), 409);

    expect(await api().retireAsk({ viewer: ADA, id: b.id })).toEqual({ id: b.id, asked: true });
    expect((await waitingRetires(pg.db)).map((r) => r.id)).toEqual([b.id]);
    // Still up until the yes; its copy can't be asked for meanwhile.
    expect((await pub().serve({ slug: b.slug })).status).toBe(200);
    await refused(api().ask({ viewer: ADA, id: b.id }), 409);
    const d = await api().detail({ viewer: ADA, id: a.id });
    expect(d.split?.split.arms.find((x) => x.label === "B")).toMatchObject({ retiring: true });

    // A no keeps it up; ask again, then the yes.
    expect(await api().decline({ viewer: ADA, ids: [retireApprovalId(b.id)] })).toEqual({
      declined: 1,
    });
    expect(await waitingRetires(pg.db)).toEqual([]);
    await api().retireAsk({ viewer: ADA, id: b.id });
    expect(await api().approve({ viewer: ADA, ids: [retireApprovalId(b.id)] })).toEqual({
      approved: 1,
    });
    expect((await pub().serve({ slug: b.slug })).status).toBe(410);
    const [row] = await pg.db.execute(
      sql`select status, views from site_page_records where id = ${b.id}`,
    );
    expect(row).toEqual({ status: "retired", views: 1 });
    await refused(api().approve({ viewer: ADA, ids: [retireApprovalId(b.id)] }), 409);
  });

  it("takes the yes from the client when it approves its own", async () => {
    const { a, b } = await stoppedPair("acme");
    await api().splitStop({ viewer: CAM, id: a.id });
    await api().retireAsk({ viewer: CAM, id: b.id });
    const list = await api().recordsList({
      viewer: CAM,
      client: "acme",
      record: "sites.page",
      view: "waiting",
    } as never);
    expect(list.rows.map((r) => [r.id, r.asked])).toEqual([[b.id, "retire"]]);
    await refused(api().approve({ viewer: CAM, ids: [b.id] }), 403);
    await pg.db.update(clients).set({ approver: "client" }).where(eq(clients.id, "acme"));
    // The row is the page: its yes is on the retire waiting on it.
    expect(await api().approve({ viewer: CAM, ids: [b.id] })).toEqual({ approved: 1 });
    expect((await pub().serve({ client: "acme", slug: b.slug })).status).toBe(410);
  });
});
