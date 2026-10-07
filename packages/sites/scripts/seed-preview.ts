/**
 * Synthetic pages for a local preview: a live lander with a new version waiting, a live variant, a
 * live listicle, a code page, 30 days of visits from ads, organic and outreach, and one ad that
 * links to the lander. Then an A/B split on the listicle with numbers on each arm, and a client
 * (Acme Roofing, synthetic) with its own host, its pages, one waiting on a yes, and two ads with
 * spend through its `/go/` link. An ended split on the lander (C asked to retire) and tracked links
 * for Wren and Acme. Never run it on prod: it refuses any database not on this machine.
 *
 *   WREN_DATABASE_URL=postgresql://...@127.0.0.1:5499/wren tsx packages/sites/scripts/seed-preview.ts
 */
import { addClient, addOperator, clientDomains } from "@wren/core/clients";
import { createDb } from "@wren/db";
import { OFFERS } from "@wren/offers";
import { sql } from "drizzle-orm";
import { pageApprovalId, sitesApi } from "../src/console.js";
import { sitesPublicApi } from "../src/service.js";

const url = process.env.WREN_DATABASE_URL ?? "";
const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
})();
if (!["127.0.0.1", "localhost"].includes(host)) throw new Error("local databases only");

const { db, close } = createDb(url, { max: 1 });
const offer = OFFERS.find((o) => o.status === "live") ?? OFFERS[0];
if (!offer) throw new Error("no offer");
const SEED = { email: "seed@example.test", operator: true } as never;
const api = sitesApi({ db, write: null });

try {
  await addOperator(db, "seed@example.test");
  const lander = await api.create({
    viewer: SEED,
    offer: offer.id,
    template: "lander",
    angle: "Speed",
    title: "Lander: speed",
  });
  await api.ask({ viewer: SEED, id: lander.id });
  await api.approve({ viewer: SEED, ids: [pageApprovalId(lander.id, 1)] });
  const d = await api.detail({ viewer: SEED, id: lander.id });
  await api.save({
    viewer: SEED,
    id: lander.id,
    content: { ...d.draft?.content, headline: "Booked calls in two weeks, not two quarters" },
    why: "Lead with the timeline",
    expect: 1,
  });
  await api.ask({ viewer: SEED, id: lander.id });
  await api.notes({
    viewer: SEED,
    id: lander.id,
    notes: "Testing a timeline headline against the speed one.",
    stage: "convert",
  });

  const { made } = await api.duplicate({
    viewer: SEED,
    ids: [lander.id],
    angle: "Trust",
    title: "Lander: trust",
  });
  const variant = made[0]?.id ?? lander.id;
  await api.ask({ viewer: SEED, id: variant });
  await api.approve({ viewer: SEED, ids: [pageApprovalId(variant, 1)] });

  const listicle = await api.create({
    viewer: SEED,
    offer: offer.id,
    template: "listicle",
    angle: "Cost",
    title: "Listicle: 5 reasons",
  });
  await api.ask({ viewer: SEED, id: listicle.id });
  await api.approve({ viewer: SEED, ids: [pageApprovalId(listicle.id, 1)] });
  await api.notes({ viewer: SEED, id: listicle.id, stage: "trust" });

  await api.add({
    viewer: SEED,
    url: "https://example.test/compare/",
    repoPath: "lander/src/pages/compare.astro",
    title: "Compare",
    offer: offer.id,
    kind: "pitch",
  });

  // 30 days of visits: each a view, some a click, a few a form, fewer a booking.
  const mix = [
    {
      page: lander.id,
      channel: "ads",
      medium: "paid",
      source: "facebook",
      content: "ad-101",
      n: 9,
    },
    {
      page: lander.id,
      channel: "outreach",
      medium: "outreach",
      source: "email",
      content: null,
      n: 3,
    },
    {
      page: listicle.id,
      channel: "organic",
      medium: "organic",
      source: "linkedin",
      content: null,
      n: 5,
    },
    {
      page: listicle.id,
      channel: "ads",
      medium: "paid",
      source: "facebook",
      content: "ad-102",
      n: 2,
    },
    { page: variant, channel: "ads", medium: "paid", source: "facebook", content: "ad-101", n: 4 },
  ];
  for (const m of mix)
    await db.execute(sql`
      insert into site_events (page, at, view, name, channel, source, medium, campaign, content)
      select ${m.page}::uuid, now() - (d || ' days')::interval - (v || ' minutes')::interval,
        md5(${m.page} || d || '-' || v), e.name, ${m.channel}, ${m.source}, ${m.medium},
        'fall', ${m.content}
      from generate_series(0, 29) d,
        generate_series(1, ${m.n} + (d % 4)) v,
        lateral (values ('view'), ('cta'), ('form'), ('book')) e(name)
      where e.name = 'view'
        or (e.name = 'cta' and v % 3 = 0)
        or (e.name = 'form' and v % 7 = 0)
        or (e.name = 'book' and v % 7 = 0 and d % 3 = 0)`);

  // One ad that links to the lander, with two weeks of spend.
  await db.execute(sql`
    insert into ad_launches (name, ad_account_id, campaign_id, adset_id, creative_id, ad_id, spec, status, daily_budget_usd)
    values ('Speed, video', 'act_1', 'c1', 's1', 'cr1', 'ad-101',
      ${JSON.stringify({ creative: { link: `https://example.test/o/${lander.slug}?utm_medium=paid&utm_content=ad-101` } })}::jsonb,
      'active', 20)`);
  await db.execute(sql`
    insert into ad_days (day, adset_id, campaign_id, campaign_name, adset_name, currency, spend, impressions, reach, clicks, leads, results)
    select current_date - d, 's1', 'c1', 'Fall', 'Speed', 'USD', 18 + (d % 5), 900 + d * 20, 800, 14 + (d % 6), 0, 0
    from generate_series(0, 13) d`);

  // An A/B split on the listicle: B (a punchier headline) against it, judged on forms.
  const pub = sitesPublicApi(db);
  const noDoor = async () => ({ status: 202 });
  const { made: bs } = await api.duplicate({
    viewer: SEED,
    ids: [listicle.id],
    angle: "Time",
    title: "Listicle: 5 hours back",
  });
  const b = bs[0]?.id ?? listicle.id;
  const bd = await api.detail({ viewer: SEED, id: b });
  await api.save({
    viewer: SEED,
    id: b,
    content: { ...bd.draft?.content, headline: "5 hours a week your team gets back" },
  });
  await api.ask({ viewer: SEED, id: b });
  await api.approve({ viewer: SEED, ids: [pageApprovalId(b, 2)] });
  const { split } = await api.splitStart({ viewer: SEED, id: listicle.id, arms: [b] });
  const arm = async (page: string, visits: number, forms: number, books: number) => {
    for (let i = 0; i < visits; i++)
      await pub.track({ page, split, view: `${page.slice(0, 6)}-${i}`, name: "view", touch: null });
    for (let i = 0; i < books; i++)
      await pub.track({ page, split, view: `${page.slice(0, 6)}-${i}`, name: "book", touch: null });
    for (let i = 0; i < forms; i++)
      await pub.form(
        {
          page,
          split,
          view: `${page.slice(0, 6)}-${i}`,
          fields: { email: `ab${i}.${page.slice(0, 4)}@example.test` },
          touch: null,
        },
        noDoor,
      );
  };
  await arm(listicle.id, 412, 11, 4);
  await arm(b, 398, 23, 7);

  // A client with its own host and pages: one live with ads behind it, one waiting on a yes.
  await addClient(db, url, {
    id: "acme",
    name: "Acme Roofing",
    products: { "sites.pages": {} },
  });
  await db
    .insert(clientDomains)
    .values({
      hostname: "pages.acme.example",
      clientId: "acme",
      cfId: "cf-preview",
      status: "active",
      sslStatus: "active",
      records: {} as never,
      addedBy: "seed@example.test",
    })
    .onConflictDoNothing();
  const roof = await api.create({
    viewer: SEED,
    offer: offer.id,
    template: "lander",
    angle: "Storm damage",
    title: "Free roof check",
    owner: "acme",
  });
  await api.ask({ viewer: SEED, id: roof.id });
  await api.approve({ viewer: SEED, ids: [pageApprovalId(roof.id, 1)] });
  const gutter = await api.create({
    viewer: SEED,
    offer: offer.id,
    template: "listicle",
    angle: "Gutters",
    title: "Gutter guards, 4 reasons",
    owner: "acme",
  });
  await api.ask({ viewer: SEED, id: gutter.id });
  const ads = [
    { ad: "120210000000101", set: "a1", name: "Storm check, video", n: 7, spend: 31 },
    { ad: "120210000000102", set: "a2", name: "Storm check, photo", n: 3, spend: 17 },
  ];
  for (const a of ads) {
    await db.execute(sql`
      insert into ad_launches (name, ad_account_id, campaign_id, adset_id, creative_id, ad_id, spec, status, daily_budget_usd)
      values (${a.name}, 'act_2', 'c2', ${a.set}, ${`cr-${a.set}`}, ${a.ad},
        ${JSON.stringify({ creative: { link: `https://pages.acme.example/go/ads/storm/${a.ad}?to=/o/${roof.slug}` } })}::jsonb,
        'active', 25)`);
    await db.execute(sql`
      insert into ad_days (day, adset_id, campaign_id, campaign_name, adset_name, currency, spend, impressions, reach, clicks, leads, results)
      select current_date - d, ${a.set}, 'c2', 'Storm', ${a.name}, 'USD', ${a.spend} + (d % 4), 1400 + d * 30, 1200, 22 + (d % 5), 0, 0
      from generate_series(0, 13) d`);
    await db.execute(sql`
      insert into site_events (page, at, view, name, channel, source, medium, campaign, content)
      select ${roof.id}::uuid, now() - (d || ' days')::interval - (v || ' minutes')::interval,
        md5(${a.ad} || d || '-' || v), e.name, 'ads', 'meta', 'paid', 'storm', ${a.ad}
      from generate_series(0, 13) d,
        generate_series(1, ${a.n} + (d % 3)) v,
        lateral (values ('view'), ('cta'), ('form'), ('book')) e(name)
      where e.name = 'view'
        or (e.name = 'cta' and v % 2 = 0)
        or (e.name = 'form' and v % 4 = 0)
        or (e.name = 'book' and v % 6 = 0 and d % 2 = 0)`);
    await db.execute(sql`
      insert into site_hops (client, link, channel, source, medium, campaign, content, "to", page)
      select 'acme', 'ads', 'ads', 'meta', 'paid', 'storm', ${a.ad}, ${`/o/${roof.slug}`}, ${roof.id}::uuid
      from generate_series(1, ${a.n * 16})`);
  }

  // A split that ended on the lander: B and C lost; C is asked to come down, B can be.
  const lost: string[] = [];
  for (const angle of ["Price", "Proof"]) {
    const { made: m } = await api.duplicate({ viewer: SEED, ids: [lander.id], angle });
    if (m[0]) lost.push(m[0].id);
  }
  const [eb, ec] = lost;
  for (const id of lost) {
    await api.ask({ viewer: SEED, id });
    await api.approve({ viewer: SEED, ids: [pageApprovalId(id, 1)] });
  }
  if (eb && ec) {
    const old = await api.splitStart({ viewer: SEED, id: lander.id, arms: [eb, ec] });
    await arm(lander.id, 260, 14, 3);
    for (const id of [eb, ec]) {
      const s = { page: id, split: old.split };
      for (let i = 0; i < 240; i++)
        await pub.track({ ...s, view: `${id.slice(0, 6)}-${i}`, name: "view", touch: null });
    }
    await api.splitStop({ viewer: SEED, id: lander.id });
    await api.retireAsk({ viewer: SEED, id: ec });
  }

  // Tracked links: Wren's to the lander, Acme's to its roof page (its ads' and a text's).
  await api.linkCreate({
    viewer: SEED,
    page: lander.id,
    link: "li",
    campaign: "launch-post",
    content: "7311200000000000001",
  });
  await api.linkCreate({ viewer: SEED, page: lander.id, link: "yt", campaign: "demo-video" });
  for (const a of ads)
    await api.linkCreate({
      viewer: SEED,
      owner: "acme",
      page: roof.id,
      link: "ads",
      campaign: "storm",
      content: a.ad,
      name: a.name,
    });
  await api.linkCreate({
    viewer: SEED,
    owner: "acme",
    page: roof.id,
    link: "sms",
    campaign: "spring-reminder",
    name: "Spring text to past customers",
  });

  console.log(
    `seeded: lander /o/${lander.slug}, split listicle /o/${listicle.slug}, acme /o/${roof.slug}`,
  );
} finally {
  await close();
}
