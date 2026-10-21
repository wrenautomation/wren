/**
 * An ad click opens its journey on the ads source (designs/2026-10-19-business-map.md, sources),
 * on a real Postgres: a form from the lander carries the visitor's touches, and a paid touch
 * names its campaign. The journey keeps the campaign in `entry_ref`, the ads source matches it,
 * and the source's cost joins `ad_days`. The walks use the real store and steps, no Restate.
 * Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { resolveProfile } from "@wren/core/profiles";
import { hookEvent, pgSpineStore, type Walk, walk } from "@wren/core/spine";
import type { Workflow } from "@wren/core/workflows";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shapeWorkflowsOf } from "../../src/journeys.js";
import type { ShapeBody } from "../../src/model.js";
import { sourceNumbersOf } from "../../src/numbers.js";
import { journeys } from "../../src/schema.js";
import { journeySteps } from "../../src/steps.js";
import { saveShape } from "../../src/store.js";
import { asMetro, flow, TRIGGERS } from "../fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  // Meta's insights for one campaign: an id, a name, and two ad sets that spent on one day.
  await pg.db.execute(sql`insert into ad_days
    (day, adset_id, campaign_id, campaign_name, adset_name, currency, spend, impressions, reach, clicks, leads, results)
    values (current_date, 'as1', '120001', 'Spring Offer', 'a', 'USD', 12.5, 1, 1, 1, 1, 1),
           (current_date, 'as2', '120001', 'Spring Offer', 'b', 'USD', 7.5, 1, 1, 1, 1, 1),
           (current_date, 'as3', '120002', 'Other', 'c', 'USD', 3, 1, 1, 1, 1, 1)`);
  await saveShape(pg.db, {
    body: asMetro(body()),
    note: "first",
    by: "t",
    triggers: new Set([...TRIGGERS, "trigger.form"]),
  });
});
afterAll(() => pg.stop());

/** An ads source on the campaign's id and a post source, into a step a form advances. */
const body = (): ShapeBody => ({
  name: "Ads shape",
  nodes: [
    { id: "ads1", kind: "source", name: "Spring ads", via: "ads", campaign: "120001" },
    { id: "ads2", kind: "source", name: "Meta ads", via: "ads", channel: "meta" },
    { id: "yt", kind: "source", name: "YouTube", via: "organic", channel: "youtube" },
    {
      id: "engaged",
      kind: "step",
      name: "Engaged",
      action: "reply",
      advance: [{ trigger: "trigger.form", with: { form: "any" } }],
    },
    {
      id: "booked",
      kind: "step",
      name: "Booked",
      action: "book",
      advance: [{ trigger: "trigger.booking" }],
    },
  ],
  edges: [
    flow("ads1", "engaged"),
    flow("ads2", "engaged"),
    flow("yt", "engaged"),
    flow("engaged", "booked"),
  ],
});

const person = async (email: string) => {
  const r = await resolveProfile(pg.db, [{ kind: "email", value: email }], "test", { name: "Ada" });
  if (!r) throw new Error("no profile");
  return r.id;
};

/** The lander's door payload (lander `doorPayload`): the page's utm and the visitor's touches. */
const payload = (email: string, over: Record<string, unknown> = {}) => ({
  id: `site:leads:${randomUUID()}`,
  source: "site",
  form: "lead",
  email,
  name: "Ada",
  visitor: "v-1",
  first_touch: null,
  last_touch: null,
  utm_source: "",
  utm_medium: "",
  utm_campaign: "",
  utm_content: "",
  ref: "",
  r: "",
  ...over,
});
const PAID = { utm_source: "meta", utm_medium: "paid", utm_content: "ad-77" };

/** What the door does with a form: its event, heard by the shape's trigger node. */
async function submit(data: Record<string, unknown>) {
  const flows: Workflow[] = await shapeWorkflowsOf(pg.db, "wren");
  const map = new Map(flows.map((f) => [f.id, f]));
  const heard = hookEvent(
    { workflow: "shape.v1", input: "t_engaged_0", subject: "email" },
    map,
    data,
  );
  if ("error" in heard) throw new Error(heard.error);
  const w: Walk = {
    flows: map,
    parts: new Map(),
    steps: journeySteps({ db: () => pg.db }),
    store: pgSpineStore(pg.db),
    client: null,
    by: randomUUID(),
    run: (_name, fn) => fn(),
    later: () => {},
    rule: async () => true,
    fire: () => {},
  };
  await walk(w, "shape.v1", heard.from, [heard.event]);
}

const journeyOf = async (profile: number) =>
  (
    await pg.db
      .select()
      .from(journeys)
      .where(eq(journeys.profileId, profile))
      .orderBy(asc(journeys.openedAt))
  ).at(-1);

describe("an ad-attributed person", () => {
  it("opens on the ads source, with the campaign and its id in entry_ref, and the cost joins", async () => {
    const profile = await person("ad1@example.test");
    await submit(payload("ad1@example.test", { ...PAID, utm_campaign: "spring-offer" }));
    const j = await journeyOf(profile);
    expect(j).toMatchObject({ node: "engaged", entry: "ads1" });
    expect(j?.trail).toMatchObject([{ edge: "ads1_to_engaged", from: "ads1", to: "engaged" }]);
    expect(j?.entryRef).toMatchObject({
      cause: { kind: "form" },
      channel: "ads",
      platform: "meta",
      campaign: "spring-offer",
      adCampaign: "120001",
    });

    const mine = await sourceNumbersOf(pg.db, { source: "ads1" });
    expect(mine.reduce((n, r) => n + (r.opened ?? 0), 0)).toBe(1);
    expect(mine.reduce((n, r) => n + (r.cost ?? 0), 0)).toBe(20);
  });

  it("reads the campaign from the first touch when the page it came from names none", async () => {
    const profile = await person("ad2@example.test");
    await submit(
      payload("ad2@example.test", {
        first_touch: { ...PAID, utm_campaign: "Spring Offer", ts: 1, page: "/" },
        last_touch: { ts: 2, page: "/pricing" },
      }),
    );
    const j = await journeyOf(profile);
    expect(j?.entry).toBe("ads1");
    expect(j?.entryRef).toMatchObject({ first: { channel: "ads", adCampaign: "120001" } });
  });

  it("falls to the source for the platform when the campaign is not one of ours", async () => {
    const profile = await person("ad3@example.test");
    await submit(payload("ad3@example.test", { ...PAID, utm_campaign: "winter" }));
    const j = await journeyOf(profile);
    // No campaign called winter in ad_days: the word is kept, no id; the Meta source takes it.
    expect(j?.entry).toBe("ads2");
    expect(j?.entryRef).toMatchObject({ channel: "ads", platform: "meta", campaign: "winter" });
    expect(j?.entryRef).not.toHaveProperty("adCampaign");
  });

  it("matches a campaign sent by its id, and one that is not paid opens no ads source", async () => {
    const byId = await person("ad4@example.test");
    await submit(payload("ad4@example.test", { ...PAID, utm_campaign: "120001" }));
    expect((await journeyOf(byId))?.entry).toBe("ads1");

    const organic = await person("ad5@example.test");
    await submit(payload("ad5@example.test", { utm_source: "youtube", utm_medium: "organic" }));
    // A post's touch is content on youtube: the YouTube source takes it by platform.
    expect((await journeyOf(organic))?.entry).toBe("yt");
  });

  it("opens by hand when the form names no touch", async () => {
    const profile = await person("ad6@example.test");
    await submit(payload("ad6@example.test"));
    const j = await journeyOf(profile);
    expect(j?.entry).toBe("manual");
    expect(j?.entryRef).toMatchObject({ cause: { kind: "form" } });
    expect(j?.entryRef).not.toHaveProperty("campaign");
  });
});
