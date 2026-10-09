/**
 * Sites phase 2 on a real Postgres: A/B splits (weights, the sticky arm, bots, each arm's numbers
 * and the call, "make B the page" through To approve), a client's own pages and approver, a
 * client's `/go/` clicks, and each ad's numbers on its page. Synthetic data only, no network.
 */
import { addClient, addMember, addOperator, clients } from "@wren/core/clients";
import type { PortalRefusal } from "@wren/core/portal";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { OFFERS } from "@wren/offers";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pageApprovalId, sitesApi } from "../../src/console.js";
import { hopOf } from "../../src/hops.js";
import { sitesPublicApi } from "../../src/service.js";
import { waitingPages } from "../../src/store.js";

let pg: TestPostgres;
const TABLES = [
  "site_hops",
  "site_split_arms",
  "site_splits",
  "site_events",
  "site_forms",
  "site_form_defs",
  "site_page_versions",
  "site_pages",
  "hooks",
  "ad_days",
  "ad_launches",
  "call_bookings",
  "client_members",
  "operators",
];
const offer = OFFERS.find((o) => o.status === "live") ?? OFFERS[0];
if (!offer) throw new Error("no offer");

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme Roofing", products: {} });
  await addClient(pg.db, pg.url, { id: "beta", name: "Beta Dental", products: {} });
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, TABLES);
  await addOperator(pg.db, "ada@example.test");
  await pg.db.update(clients).set({ approver: "wren" });
});

const ADA = { email: "ada@example.test", operator: true } as never;
const CAM = { email: "cam@acme.example" } as never;
const BEA = { email: "bea@beta.example" } as never;
const api = () => sitesApi({ db: pg.db, write: null });
const pub = () => sitesPublicApi(pg.db);
const refused = async (p: Promise<unknown>, status: number) => {
  const err = (await p.catch((e: unknown) => e)) as PortalRefusal;
  expect(err?.status).toBe(status);
};
const noDoor = async () => ({ status: 202 });

async function livePage(angle = "speed", owner: string | null = null) {
  const made = await api().create({ viewer: ADA, offer: offer!.id, angle, owner });
  await api().ask({ viewer: ADA, id: made.id });
  await api().approve({ viewer: ADA, ids: [pageApprovalId(made.id, 1)] });
  return made;
}

/** A and a live variant B with its own headline. */
async function pair(owner: string | null = null) {
  const a = await livePage("speed", owner);
  const { made } = await api().duplicate({ viewer: ADA, ids: [a.id], angle: "cost" });
  const b = made[0]!;
  const d = await api().detail({ viewer: ADA, id: b.id });
  await api().save({
    viewer: ADA,
    id: b.id,
    content: { ...d.draft!.content, headline: "The cost angle wins" },
  });
  await api().ask({ viewer: ADA, id: b.id });
  await api().approve({ viewer: ADA, ids: [pageApprovalId(b.id, 2)] });
  return { a, b };
}

const pageIn = (html: string) => /data-page="([^"]+)"/.exec(html)?.[1];
const splitIn = (html: string) => /data-split="([^"]+)"/.exec(html)?.[1] ?? null;

describe("splits", () => {
  it("serves arms by weight, keeps a visitor on theirs, and gives bots A", async () => {
    const { a, b } = await pair();
    const s = await api().splitStart({ viewer: ADA, id: a.id, arms: [b.id], weights: [1, 3] });
    expect(s.arms).toEqual([
      { label: "A", weight: 1 },
      { label: "B", weight: 3 },
    ]);
    // A holds [0, 0.25) of the rolls, B the rest.
    const low = await pub().serve({ slug: a.slug, roll: 0.1 });
    expect(pageIn(low.html)).toBe(a.id);
    expect(splitIn(low.html)).toBe(s.split);
    expect(low.split).toMatchObject({ label: "A", cookie: `${s.split.slice(0, 8)}.A`, days: 30 });
    const high = await pub().serve({ slug: a.slug, roll: 0.6 });
    expect(pageIn(high.html)).toBe(b.id);
    expect(high.html).toContain("The cost angle wins");
    // The cookie wins over the roll; one from another split doesn't.
    const kept = await pub().serve({ slug: a.slug, roll: 0.1, arm: `${s.split.slice(0, 8)}.B` });
    expect(kept.split?.label).toBe("B");
    const stale = await pub().serve({ slug: a.slug, roll: 0.1, arm: "00000000.B" });
    expect(stale.split?.label).toBe("A");
    const bot = await pub().serve({ slug: a.slug, roll: 0.9, bot: true });
    expect(pageIn(bot.html)).toBe(a.id);
    expect(bot.split).toBeNull();
    expect(splitIn(bot.html)).toBeNull();
    // B's own address still serves B alone.
    const direct = await pub().serve({ slug: b.slug });
    expect(direct.split).toBeNull();

    await api().splitWeights({ viewer: ADA, id: a.id, weights: [1, 1] });
    expect((await pub().serve({ slug: a.slug, roll: 0.4 })).split?.label).toBe("A");
    await api().splitStop({ viewer: ADA, id: a.id });
    expect((await pub().serve({ slug: a.slug, roll: 0.9 })).split).toBeNull();
  });

  it("refuses a second split, a draft arm, another owner's page and a viewer", async () => {
    const { a, b } = await pair();
    await api().splitStart({ viewer: ADA, id: a.id, arms: [b.id] });
    await refused(api().splitStart({ viewer: ADA, id: a.id, arms: [b.id] }), 409);
    await api().splitStop({ viewer: ADA, id: a.id });
    const draft = await api().create({ viewer: ADA, offer: offer.id, angle: "draft" });
    await refused(api().splitStart({ viewer: ADA, id: a.id, arms: [draft.id] }), 409);
    const theirs = await livePage("theirs", "acme");
    await refused(api().splitStart({ viewer: ADA, id: a.id, arms: [theirs.id] }), 400);
    await refused(api().splitStart({ viewer: ADA, id: a.id, arms: [b.id], weights: [1, 0] }), 400);
    const VIC = {
      email: "vic@example.test",
      operator: true,
      team: { role: "viewer", clients: null },
    };
    await refused(api().splitStart({ viewer: VIC as never, id: a.id, arms: [b.id] }), 403);
  });

  it("counts each arm in the split alone, and calls the leader", async () => {
    const { a, b } = await pair();
    const { split } = await api().splitStart({
      viewer: ADA,
      id: a.id,
      arms: [b.id],
      goal: "forms",
    });
    const views = async (page: string, n: number, name: "view" | "book" = "view") => {
      for (let i = 0; i < n; i++)
        await pub().track({ page, split, view: `${page.slice(0, 4)}-${i}`, name, touch: null });
    };
    await views(a.id, 150);
    await views(b.id, 150);
    await views(b.id, 6, "book");
    // A view outside the split, and a forged split on another page: neither counts in it.
    await pub().track({ page: a.id, view: "plain", name: "view", touch: null });
    const other = await livePage("other");
    await pub().track({ page: other.id, split, view: "x", name: "view", touch: null });
    const form = (page: string, i: number) =>
      pub().form(
        { page, split, view: `f${i}`, fields: { email: `p${i}@example.test` }, touch: null },
        noDoor,
      );
    for (let i = 0; i < 2; i++) await form(a.id, i);
    for (let i = 10; i < 24; i++) await form(b.id, i);

    const d = await api().detail({ viewer: ADA, id: a.id });
    const arms = d.split!.arms;
    expect(arms.map((x) => [x.label, x.visits, x.forms, x.books])).toEqual([
      ["A", 150, 2, 0],
      ["B", 150, 14, 6],
    ]);
    expect(d.split!.call.leader).toBe("B");
    expect(d.split!.call.kind).toBe("settled");
    expect(d.split!.call.words).toMatch(/^B wins, 99% sure$/);
    const [stray] = await pg.db.execute(
      sql`select split from site_events where page = ${other.id}`,
    );
    expect(stray?.split).toBeNull();
    // The list marks the page split.
    const row = await pg.db.execute(sql`select split from site_page_records where id = ${a.id}`);
    expect(row[0]?.split).toBe("running");
  });

  it("says too early, with how many more visits", async () => {
    const { a, b } = await pair();
    const { split } = await api().splitStart({ viewer: ADA, id: a.id, arms: [b.id] });
    for (let i = 0; i < 30; i++)
      await pub().track({ page: a.id, split, view: `v${i}`, name: "view", touch: null });
    const d = await api().detail({ viewer: ADA, id: a.id });
    expect(d.split!.call.words).toBe("Too early: 170 more visits");
  });

  it("counts won deals: a form's email that booked after it and was marked won", async () => {
    const { a, b } = await pair();
    const { split } = await api().splitStart({ viewer: ADA, id: a.id, arms: [b.id], goal: "won" });
    await pub().form(
      { page: b.id, split, view: "w1", fields: { email: "won@example.test" }, touch: null },
      noDoor,
    );
    await pub().form(
      { page: b.id, split, view: "w2", fields: { email: "lost@example.test" }, touch: null },
      noDoor,
    );
    await pg.db.execute(sql`
      insert into call_bookings (uid, state, email, booked_at, outcome) values
        ('bk1', 'booked', 'WON@example.test', now() + interval '1 hour', 'won'),
        ('bk2', 'booked', 'lost@example.test', now() + interval '1 hour', 'not_fit'),
        ('bk3', 'booked', 'won@example.test', now() - interval '9 days', 'won')`);
    const d = await api().detail({ viewer: ADA, id: a.id });
    expect(d.split!.arms.map((x) => x.won)).toEqual([0, 1]);
    // Won deals are Wren's: a client's page can't be judged on them.
    const c = await pair("acme");
    await refused(api().splitStart({ viewer: ADA, id: c.a.id, arms: [c.b.id], goal: "won" }), 400);
  });

  it("makes B the page through To approve: a yes ships, a no runs again", async () => {
    const { a, b } = await pair();
    await api().splitStart({ viewer: ADA, id: a.id, arms: [b.id] });
    const asked = await api().splitShip({ viewer: ADA, id: a.id, label: "B" });
    expect(asked).toEqual({ id: a.id, waiting: 2 });
    expect((await waitingPages(pg.db)).map((w) => [w.id, w.number])).toEqual([[a.id, 2]]);
    let d = await api().detail({ viewer: ADA, id: a.id });
    expect(d.split!.split).toMatchObject({ state: "shipping", winner: "B", shipVersion: 2 });
    expect(d.versions[0]).toMatchObject({ number: 2, origin: "copy" });
    expect(d.versions[0]?.why).toMatch(/^won the split/);
    // Still split while it waits.
    expect((await pub().serve({ slug: a.slug, roll: 0.9 })).split?.label).toBe("B");

    await api().decline({ viewer: ADA, ids: [pageApprovalId(a.id, 2)] });
    d = await api().detail({ viewer: ADA, id: a.id });
    expect(d.split!.split).toMatchObject({ state: "running", winner: null });

    const again = await api().splitShip({ viewer: ADA, id: a.id, label: "B" });
    await api().approve({ viewer: ADA, ids: [pageApprovalId(a.id, again.waiting)] });
    d = await api().detail({ viewer: ADA, id: a.id });
    expect(d.split!.split).toMatchObject({ state: "shipped", winner: "B" });
    const now = await pub().serve({ slug: a.slug, roll: 0.1 });
    expect(now.split).toBeNull();
    expect(pageIn(now.html)).toBe(a.id);
    expect(now.html).toContain("The cost angle wins");
  });
});

describe("a client's pages", () => {
  it("lists a client's own pages only, to its own logins", async () => {
    await addMember(pg.db, "acme", "cam@acme.example", { role: "member" });
    await addMember(pg.db, "beta", "bea@beta.example", { role: "member" });
    const mine = await livePage("acme page", "acme");
    await livePage("beta page", "beta");
    await livePage("wren page");
    const list = await api().recordsList({
      viewer: CAM,
      client: "acme",
      record: "sites.page",
    } as never);
    expect(list.rows.map((r) => r.id).filter((id) => !String(id).includes(":"))).toEqual([mine.id]);
    const one = (await api().recordsGet({
      viewer: CAM,
      client: "acme",
      record: "sites.page",
      id: mine.id,
    } as never)) as { detail?: unknown } | null;
    expect(one).toBeTruthy();
    await refused(
      api().recordsList({ viewer: BEA, client: "acme", record: "sites.page" } as never),
      403,
    );
    await refused(api().detail({ viewer: BEA, id: mine.id }), 403);
  });

  it("makes, lists and opens a client's own forms and submissions on its host", async () => {
    await addMember(pg.db, "acme", "cam@acme.example", { role: "member" });
    await addMember(pg.db, "beta", "bea@beta.example", { role: "member" });
    const mine = await api().formCreate({
      viewer: CAM,
      client: "acme",
      name: "Acme quote",
    } as never);
    const theirs = await api().formCreate({
      viewer: BEA,
      client: "beta",
      name: "Beta quote",
    } as never);
    await api().formCreate({ viewer: ADA, name: "Wren quote" });
    await api().formPublish({ viewer: CAM, client: "acme", ids: [mine.id] } as never);
    const kept = await pub().form(
      { form: mine.id, fields: { name: "Kim", email: "kim@example.test" } },
      async () => ({ status: 202 }),
    );
    expect(kept.status).toBe(202);
    const ask = { viewer: CAM, client: "acme" };
    const forms = await api().recordsList({ ...ask, record: "sites.form" } as never);
    expect(forms.rows.map((r) => r.id)).toEqual([mine.id]);
    const entries = await api().recordsList({ ...ask, record: "sites.entry" } as never);
    expect(entries.rows.map((r) => r.formName)).toEqual(["Acme quote"]);
    const one = (await api().recordsGet({
      ...ask,
      record: "sites.form",
      id: mine.id,
    } as never)) as {
      detail?: unknown;
    } | null;
    expect(one?.detail).toBeTruthy();
    // Another client's form doesn't open here.
    await expect(
      api().recordsGet({ ...ask, record: "sites.form", id: theirs.id } as never),
    ).rejects.toThrow(/no such form/);
  });

  it("publishes through the client's approver setting", async () => {
    await addMember(pg.db, "acme", "cam@acme.example", { role: "member" });
    const made = await api().create({ viewer: ADA, offer: offer.id, owner: "acme" });
    await api().ask({ viewer: ADA, id: made.id });
    const id = pageApprovalId(made.id, 1);
    // Wren approves by default: the client's login can't.
    await refused(api().approve({ viewer: CAM, ids: [id] }), 403);
    await pg.db.update(clients).set({ approver: "client" }).where(eq(clients.id, "acme"));
    await refused(api().approve({ viewer: ADA, ids: [id] }), 403);
    expect(await api().approve({ viewer: CAM, ids: [id] })).toEqual({ approved: 1 });
    expect((await pub().serve({ client: "acme", slug: made.slug })).status).toBe(200);
    // From the client's list the row is the page: its yes is on the version waiting now.
    const next = await api().create({ viewer: ADA, offer: offer.id, owner: "acme", angle: "two" });
    await api().ask({ viewer: ADA, id: next.id });
    expect(await api().approve({ viewer: CAM, ids: [next.id] })).toEqual({ approved: 1 });
    await refused(api().approve({ viewer: CAM, ids: [next.id] }), 409);
    await pg.db.update(clients).set({ approver: "either" }).where(eq(clients.id, "acme"));
  });
});

describe("a client's /go/ links and each ad's numbers", () => {
  it("counts the hop on the page, and costs each ad per visit, form and booking", async () => {
    const page = await livePage("ads", "acme");
    const hop = hopOf("/go/ads/spring/ad9", new URLSearchParams({ to: `/o/${page.slug}` }))!;
    expect(hop.location).toBe(
      `/o/${page.slug}?utm_source=meta&utm_medium=paid&utm_campaign=spring&utm_content=ad9`,
    );
    expect(await pub().hop({ client: "acme", ...hop })).toEqual({ kept: true });
    const [h] = await pg.db.execute(sql`select page::text, channel, content from site_hops`);
    expect(h).toEqual({ page: page.id, channel: "ads", content: "ad9" });

    await pg.db.execute(sql`
      insert into ad_launches (name, ad_account_id, campaign_id, adset_id, creative_id, ad_id, spec, status, daily_budget_usd)
      values ('Spring ad', 'act_1', 'c1', 's9', 'cr9', 'ad9',
        ${JSON.stringify({ creative: { link: `https://pages.acme.example/go/ads/spring/ad9?to=/o/${page.slug}` } })}::jsonb, 'active', 10),
      ('Quiet ad', 'act_1', 'c1', 's8', 'cr8', 'ad8',
        ${JSON.stringify({ creative: { link: `https://pages.acme.example/o/${page.slug}` } })}::jsonb, 'paused', 5)`);
    await pg.db.execute(sql`
      insert into ad_days (day, adset_id, campaign_id, campaign_name, adset_name, currency, spend, impressions, reach, clicks, leads, results)
      values (current_date, 's9', 'c1', 'C', 'S', 'USD', 30, 1000, 900, 20, 1, 1),
        (current_date - 1, 's9', 'c1', 'C', 'S', 'USD', 20, 800, 700, 15, 0, 0)`);
    const touch = { source: "meta", medium: "paid", campaign: "spring", content: "ad9" };
    for (let i = 0; i < 4; i++)
      await pub().track({ page: page.id, view: `ad-${i}`, name: "view", touch });
    await pub().track({ page: page.id, view: "ad-0", name: "book", touch });
    for (let i = 0; i < 2; i++)
      await pub().form(
        { page: page.id, view: `ad-${i}`, fields: { email: `a${i}@example.test` }, touch },
        noDoor,
      );
    const d = await api().detail({ viewer: ADA, id: page.id });
    expect(d.ads[0]).toMatchObject({
      name: "Spring ad",
      spend: 50,
      impressions: 1800,
      clicks: 35,
      leads: 1,
      views: 4,
      forms: 2,
      books: 1,
      hops: 1,
      costPerVisit: 12.5,
      costPerForm: 25,
      costPerBook: 50,
    });
    expect(d.ads[1]).toMatchObject({
      name: "Quiet ad",
      spend: 0,
      costPerForm: null,
      costPerBook: null,
    });
  });
});
