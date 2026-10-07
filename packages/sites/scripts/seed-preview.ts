/**
 * Synthetic pages for a local preview: a live lander with a new version waiting, a live variant, a
 * live listicle, a code page, 30 days of visits from ads, organic and outreach, and one ad that
 * links to the lander. Never run it on prod: it refuses any database not on this machine.
 *
 *   WREN_DATABASE_URL=postgresql://...@127.0.0.1:5499/wren tsx packages/sites/scripts/seed-preview.ts
 */
import { addOperator } from "@wren/core/clients";
import { createDb } from "@wren/db";
import { OFFERS } from "@wren/offers";
import { sql } from "drizzle-orm";
import { pageApprovalId, sitesApi } from "../src/console.js";

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

  console.log(`seeded: lander /o/${lander.slug}, listicle /o/${listicle.slug}`);
} finally {
  await close();
}
