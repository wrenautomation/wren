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
import { consentWords } from "../../src/forms.js";
import { entryRecord, formRecord, pageRecord } from "../../src/records.js";
import { sitesPublicApi } from "../../src/service.js";

let pg: TestPostgres;
const TABLES = [
  "site_events",
  "site_forms",
  "site_form_defs",
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

describe("hosted forms", () => {
  async function siteDoor() {
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
    return h!.id;
  }
  const spec = {
    title: "Get a quote",
    button: "Send",
    fields: [
      { kind: "text", label: "Name", required: true },
      { kind: "email", label: "Email", required: true },
      { kind: "phone", label: "Phone" },
      { kind: "select", label: "Service", options: ["Repair", "Install"], required: true },
      { kind: "consent", label: consentWords("Wren Automation") },
      { key: "utm_source", kind: "hidden" },
    ],
    after: { kind: "thanks", text: "Thanks." },
  };

  it("builds, publishes, serves, counts and enters the door as form.submitted", async () => {
    const hook = await siteDoor();
    const made = await api().formCreate({ viewer: ADA, name: "Quote request" });
    expect(made.slug).toBe("quote-request");
    const again = await api().formCreate({ viewer: ADA, name: "Quote request" });
    expect(again.slug).toBe("quote-request-2");
    await refused(api().formCreate({ viewer: VIC, name: "Nope" }), 403);
    await refused(
      api().formSave({ viewer: ADA, id: made.id, spec: { title: "x", fields: [] } }),
      400,
    );
    await api().formSave({ viewer: ADA, id: made.id, spec });

    // A draft serves nothing; live serves; retired is gone.
    expect((await pub().serveForm({ slug: made.slug })).status).toBe(404);
    await api().formPublish({ viewer: ADA, ids: [made.id] });
    const page = await pub().serveForm({ slug: made.slug, embed: true });
    expect(page.status).toBe(200);
    expect(page.html).toContain("data-framed");
    expect((await pub().serveForm({ client: "acme", slug: made.slug })).status).toBe(404);

    const touch = { source: "google", medium: "cpc", campaign: "spring" };
    expect((await pub().track({ form: made.id, view: "v1", name: "view", touch })).kept).toBe(true);
    expect((await pub().track({ form: made.id, view: "v1", name: "start", touch })).kept).toBe(
      true,
    );
    expect((await pub().track({ form: again.id, view: "v2", name: "view" })).kept).toBe(false);

    const entered: { hook: string; payload: Record<string, unknown> }[] = [];
    const enter = async (h: string, payload: Record<string, unknown>) => {
      entered.push({ hook: h, payload });
      return { status: 202 };
    };
    const bad = await pub().form(
      { form: made.id, view: "v1", fields: { name: "Sam", email: "sam@", service: "Paint" } },
      enter,
    );
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.errors ?? {}).sort()).toEqual(["email", "service"]);
    expect(entered).toHaveLength(0);

    const ok = await pub().form(
      {
        form: made.id,
        view: "v1",
        fields: {
          name: "Sam Lee",
          email: "sam@example.test",
          phone: "555 010 0000",
          service: "Repair",
          sms_consent: "yes",
          utm_source: "google",
          extra: "dropped",
        },
        touch,
        visitor: "v_test1",
        human: "yes",
      },
      enter,
    );
    expect(ok.status).toBe(202);
    expect(entered[0]?.hook).toBe(hook);
    expect(entered[0]?.payload).toMatchObject({
      event: "form.submitted",
      form: "quote-request",
      form_id: made.id,
      email: "sam@example.test",
      service: "Repair",
      sms_consent: "yes",
      consent_text: consentWords("Wren Automation"),
      visitor: "v_test1",
      utm_source: "google",
      utm_campaign: "spring",
      page: "https://wrenautomation.com/o/f/quote-request",
    });
    expect(String(entered[0]?.payload.consent_version)).toMatch(/^[0-9a-f]{12}$/);
    expect(entered[0]?.payload).not.toHaveProperty("extra");

    const d = await api().formDetail({ viewer: ADA, id: made.id });
    expect(d.embed.script).toContain('data-embed="quote-request"');
    expect(d.sources[0]).toMatchObject({ channel: "ads", views: 1, starts: 1, submits: 1 });
    expect(d.recent).toHaveLength(1);

    const forms = await serveRecords([formRecord], pg.db).list({
      record: formRecord.id,
      view: "forms",
    });
    expect(forms.rows.find((r) => r.id === made.id)).toMatchObject({
      views: 1,
      starts: 1,
      submits: 1,
      conversion: 1,
      status: "live",
    });
    const entries = await serveRecords([entryRecord], pg.db).list({
      record: entryRecord.id,
      view: "all",
    });
    expect(entries.rows[0]).toMatchObject({
      who: "Sam Lee",
      formName: "Quote request",
      consented: "yes",
      entered: "in",
      human: "yes",
      visitor: "v_test1",
    });
    expect(String(entries.rows[0]?.answers)).toContain("service: Repair");

    await api().formRetire({ viewer: ADA, ids: [made.id] });
    expect((await pub().serveForm({ slug: made.slug })).status).toBe(410);
    expect((await pub().form({ form: made.id, fields: { email: "a@example.test" } }, enter)).status).toBe(404);
  });

  it("renders a live form in a page's form section and counts it for both", async () => {
    await siteDoor();
    const f = await api().formCreate({ viewer: ADA, name: "Section form", spec });
    await api().formPublish({ viewer: ADA, ids: [f.id] });
    const made = await api().create({ viewer: ADA, offer: offer.id, angle: "speed" });
    const d = await api().detail({ viewer: ADA, id: made.id });
    await api().save({
      viewer: ADA,
      id: made.id,
      content: { ...(d.draft?.content ?? {}), form: f.slug },
      expect: d.draft?.number ?? null,
    });
    const v = await api().detail({ viewer: ADA, id: made.id });
    await api().ask({ viewer: ADA, id: made.id });
    await api().approve({ viewer: ADA, ids: [pageApprovalId(made.id, v.draft?.number ?? 2)] });
    const html = (await pub().serve({ slug: made.slug })).html;
    expect(html).toContain('name="service"');
    expect(html).toContain(`data-form="${f.id}"`);

    const entered: Record<string, unknown>[] = [];
    await pub().form(
      {
        form: f.id,
        page: made.id,
        fields: { name: "Ann", email: "ann@example.test", service: "Install" },
      },
      async (_h, p) => {
        entered.push(p);
        return { status: 202 };
      },
    );
    expect(entered[0]).toMatchObject({ page_id: made.id, offer: offer.id, form_id: f.id });
    expect(entered[0]).not.toHaveProperty("consent_version");
    const [row] = await pg.db.execute<{ page: string; form: string }>(
      sql`select page::text, form::text from site_events where name = 'form'`,
    );
    expect(row).toEqual({ page: made.id, form: f.id });
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
