/**
 * Sites on a real Postgres (designs/2026-10-07-sites.md): a page from an offer, copy saved as
 * versions, publish through To approve, serving and previews, the tracker and the form into the
 * door, retire, variants, code pages, and the inventory with ad spend. Synthetic data only.
 */

import { randomBytes } from "node:crypto";
import { addOperator } from "@wren/core/clients";
import { HOOK_PRESETS } from "@wren/core/door";
import type { PortalRefusal } from "@wren/core/portal";
import { serveRecords } from "@wren/core/records/serve";
import { hooks } from "@wren/core/schema";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { OFFERS } from "@wren/offers";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pageApprovalId, sitesApi } from "../../src/console.js";
import { pageRecord } from "../../src/records.js";
import { sitesPublicApi } from "../../src/service.js";

let pg: TestPostgres;
const TABLES = [
  "site_events",
  "site_forms",
  "site_page_versions",
  "site_pages",
  "hooks",
  "ad_days",
  "ad_launches",
  "operators",
];
const offer = OFFERS.find((o) => o.status === "live") ?? OFFERS[0];
if (!offer) throw new Error("no offer");

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, TABLES);
  await addOperator(pg.db, "ada@example.test");
});

const ADA = { email: "ada@example.test", operator: true } as never;
const VIC = {
  email: "vic@example.test",
  operator: true,
  team: { role: "viewer", clients: null },
} as never;
const api = () => sitesApi({ db: pg.db, write: null });
const pub = () => sitesPublicApi(pg.db);
const refused = async (p: Promise<unknown>, status: number) => {
  const err = (await p.catch((e: unknown) => e)) as PortalRefusal;
  expect(err?.status).toBe(status);
};

async function livePage(angle = "speed") {
  const made = await api().create({ viewer: ADA, offer: offer!.id, angle });
  await api().ask({ viewer: ADA, id: made.id });
  await api().approve({ viewer: ADA, ids: [pageApprovalId(made.id, 1)] });
  return made;
}

describe("data pages", () => {
  it("makes a draft from an offer that serves nothing until a yes", async () => {
    const made = await api().create({ viewer: ADA, offer: offer.id, angle: "speed" });
    expect(made.origin).toBe("offer");
    expect((await pub().serve({ slug: made.slug })).status).toBe(404);

    const d = await api().detail({ viewer: ADA, id: made.id });
    expect(d.draft?.number).toBe(1);
    expect(d.preview).toMatch(/^\/o\/__preview\//);
    const token = new URL(`https://x${d.preview}`).searchParams.get("t") ?? "";
    const pv = await pub().serve({ preview: { id: made.id, token } });
    expect(pv.status).toBe(200);
    expect(pv.html).toContain("Not live");
    expect(pv.html).not.toContain("__kit.js");
    expect((await pub().serve({ preview: { id: made.id, token: "x".repeat(43) } })).status).toBe(
      404,
    );

    await api().ask({ viewer: ADA, id: made.id });
    await api().approve({ viewer: ADA, ids: [pageApprovalId(made.id, 1)] });
    const live = await pub().serve({ slug: made.slug });
    expect(live.status).toBe(200);
    expect(live.html).toContain("__kit.js");
  });

  it("saves copy as versions and refuses a stale save", async () => {
    const made = await livePage();
    const d = await api().detail({ viewer: ADA, id: made.id });
    const content = { ...d.draft!.content, headline: "A new headline" };
    const saved = await api().save({ viewer: ADA, id: made.id, content, expect: 1 });
    expect(saved.draft).toBe(2);
    await refused(api().save({ viewer: ADA, id: made.id, content, expect: 1 }), 409);
    // The live page keeps version 1 until version 2 gets its yes.
    expect((await pub().serve({ slug: made.slug })).html).not.toContain("A new headline");
    await api().ask({ viewer: ADA, id: made.id });
    await api().approve({ viewer: ADA, ids: [pageApprovalId(made.id, 2)] });
    expect((await pub().serve({ slug: made.slug })).html).toContain("A new headline");
  });

  it("refuses a viewer's writes and the demo's", async () => {
    await refused(api().create({ viewer: VIC, offer: offer.id }), 403);
    await refused(api().create({ viewer: { demo: true } as never, offer: offer.id }), 403);
  });

  it("retires in bulk: 410 at the URL, numbers kept", async () => {
    const a = await livePage("speed");
    const b = await livePage("cost");
    const out = await api().retire({ viewer: ADA, ids: [a.id, b.id] });
    expect(out.retired).toBe(2);
    expect((await pub().serve({ slug: a.slug })).status).toBe(410);
  });

  it("duplicates as a variant of the root page", async () => {
    const a = await livePage();
    const { made } = await api().duplicate({ viewer: ADA, ids: [a.id], angle: "trust" });
    const v = made[0]!;
    const again = await api().duplicate({ viewer: ADA, ids: [v.id] });
    const d = await api().detail({ viewer: ADA, id: a.id });
    expect(d.variants.map((x) => x.id).sort()).toEqual([a.id, v.id, again.made[0]!.id].sort());
  });
});

describe("tracking and forms", () => {
  it("counts views and forms, and enters the owner's door with the touch", async () => {
    const site = HOOK_PRESETS.site!;
    const [h] = await pg.db
      .insert(hooks)
      .values({
        name: "Site",
        client: null,
        workflow: site.workflow,
        input: site.input,
        subject: site.subject,
        fields: site.fields,
        tokenHash: randomBytes(32).toString("hex"),
      })
      .returning({ id: hooks.id });
    const page = await livePage();
    const touch = { source: "facebook", medium: "paid", campaign: "c1", content: "ad1" };
    expect((await pub().track({ page: page.id, view: "v1", name: "view", touch })).kept).toBe(true);
    expect((await pub().track({ page: page.id, view: "v1", name: "nope" })).kept).toBe(false);

    const entered: { hook: string; payload: Record<string, unknown> }[] = [];
    const enter = async (hook: string, payload: Record<string, unknown>) => {
      entered.push({ hook, payload });
      return { status: 202 };
    };
    const res = await pub().form(
      { page: page.id, view: "v1", fields: { name: "Sam Lee", email: "sam@example.test" }, touch },
      enter,
    );
    expect(res.status).toBe(202);
    expect(entered).toHaveLength(1);
    expect(entered[0]?.hook).toBe(h!.id);
    expect(entered[0]?.payload).toMatchObject({
      email: "sam@example.test",
      source: "site",
      utm_medium: "paid",
      offer: offer.id,
    });

    // A bot fills the trap: answered as sent, kept nowhere.
    await pub().form({ page: page.id, fields: { email: "b@example.test", website: "x" } }, enter);
    expect(entered).toHaveLength(1);
    expect((await pub().form({ page: page.id, fields: {} }, enter)).status).toBe(400);

    const d = await api().detail({ viewer: ADA, id: page.id });
    expect(d.sources[0]).toMatchObject({ channel: "ads", views: 1, forms: 1 });
    const [f] = await pg.db.execute<{ entered: boolean }>(sql`select entered from site_forms`);
    expect(f?.entered).toBe(true);
  });
});

describe("code pages and the inventory", () => {
  it("registers a code page by URL, once", async () => {
    const a = await api().add({
      viewer: ADA,
      url: "https://example.test/compare/",
      repoPath: "lander/src/pages/compare.astro",
      offer: offer.id,
    });
    expect(a.added).toBe(true);
    const b = await api().add({
      viewer: ADA,
      url: "https://example.test/compare?utm_source=x",
      title: "Compare",
    });
    expect(b).toEqual({ id: a.id, added: false });
    await refused(api().add({ viewer: ADA, url: "http://example.test/x" }), 400);
    await refused(api().save({ viewer: ADA, id: a.id, content: {} }), 409);
  });

  it("lists every page with visits, forms and the spend of ads that link to it", async () => {
    const page = await livePage();
    await pg.db.execute(sql`
      insert into ad_launches (name, ad_account_id, campaign_id, adset_id, creative_id, ad_id, spec, status, daily_budget_usd)
      values ('Ad 1', 'act_1', 'c1', 's1', 'cr1', 'ad1',
        ${JSON.stringify({ creative: { link: `https://wrenautomation.com/o/${page.slug}?utm_medium=paid` } })}::jsonb, 'active', 10)`);
    await pg.db.execute(sql`
      insert into ad_days (day, adset_id, campaign_id, campaign_name, adset_name, currency, spend, impressions, reach, clicks, leads, results)
      values (current_date, 's1', 'c1', 'C', 'S', 'USD', 12.5, 100, 90, 7, 0, 0)`);
    await pub().track({
      page: page.id,
      view: "v",
      name: "view",
      touch: { medium: "paid", content: "ad1" },
    });

    const got = await serveRecords([pageRecord], pg.db).list({
      record: pageRecord.id,
      view: "pages",
    });
    const row = got.rows.find((r) => r.id === page.id) as Record<string, unknown>;
    expect(row).toMatchObject({ status: "live", views: 1, ads: 1 });
    const d = await api().detail({ viewer: ADA, id: page.id });
    expect(d.ads[0]).toMatchObject({ adId: "ad1", spend: 12.5, clicks: 7, views: 1 });
  });
});
