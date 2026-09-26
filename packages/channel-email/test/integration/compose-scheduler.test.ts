/** The queue-keeper's top-up: capacity × days ahead, minus what is queued, through the plan. */
import { loadSettings } from "@wren/config";
import { companies } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sequence, sequenceStep } from "../../src/outreach/sequences.js";
import { field, template, text } from "../../src/outreach/templates.js";
import { type Campaign, queuedOpeners, topUp } from "../../src/restate/compose-scheduler.js";
import { SendPolicy } from "../../src/send/policy.js";
import {
  allEnrollments,
  FOLLOWUP,
  makeCompany,
  makePerson,
  SENDER,
  TABLES,
  VERIFICATION_HORIZON_DAYS,
} from "./compose-fixtures.js";

const MARKETING = template(
  "marketing/opener",
  [text("month end")],
  [text("Hi "), field("first_name")],
);
const BUILD = template("build/opener", [text("invoices")], [text("Hi "), field("first_name")]);
const CAMPAIGN: Campaign = {
  niche: "agencies",
  plan: [
    { sequence: "marketing-days-0-5", where: { "company.segment": "marketing" } },
    { sequence: "build-days-0-5", where: { "company.segment": "build" } },
    { sequence: "marketing-days-0-5" },
  ],
  sequences: new Map([
    [
      "marketing-days-0-5",
      sequence("marketing-days-0-5", [
        sequenceStep("marketing/opener", 0),
        sequenceStep("followup", 5),
      ]),
    ],
    [
      "build-days-0-5",
      sequence("build-days-0-5", [sequenceStep("build/opener", 0), sequenceStep("followup", 5)]),
    ],
  ]),
  offers: new Map([
    ["marketing-days-0-5", "marketing-offer"],
    ["build-days-0-5", "build-offer"],
  ]),
  templates: new Map([
    ["marketing/opener", MARKETING],
    ["build/opener", BUILD],
    ["followup", FOLLOWUP],
  ]),
  factsView: "agency_facts",
  senders: [SENDER],
  signatures: { [SENDER]: "William" },
  companyLocation: (c) => ((c.raw ?? {}) as Record<string, unknown>).Location as string | null,
};
// Flat cap of 2 per inbox, one inbox: capacity 2/day.
const POLICY = SendPolicy.fromSettings(
  loadSettings({
    WREN_DATABASE_URL: "postgresql://x",
    WREN_SEND_TIMEZONE: "UTC",
    WREN_COLD_SENDS_PER_INBOX_PER_DAY: "2",
  }),
);
const NOW = new Date("2026-09-21T10:00:00Z");
const opts = (daysAhead: number) => ({
  policy: POLICY,
  now: NOW,
  daysAhead,
  verificationHorizonDays: VERIFICATION_HORIZON_DAYS,
  trackOpens: false,
  roleInboxNeedsVerdict: false,
  runId: null,
});

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, TABLES));
const db = () => pg.db;

async function seedAgencies() {
  const marketing = await makeCompany(db(), {
    domain: "ads.example",
    name: "Ads Co",
    niche: "agencies",
    raw: {
      "agency.services": "60% Pay Per Click, 40% Search Engine Optimization",
      Location: "Austin, TX",
    },
  });
  const build = await makeCompany(db(), {
    domain: "dev.example",
    name: "Dev Co",
    niche: "agencies",
    raw: { "agency.services": "70% Web Development, 30% Web Design" },
  });
  const tied = await makeCompany(db(), {
    domain: "tie.example",
    name: "Tie Co",
    niche: "agencies",
    raw: { "agency.services": "50% Pay Per Click, 50% Web Development" },
  });
  await makePerson(db(), marketing, { email: "a@ads.example" });
  await makePerson(db(), build, { email: "b@dev.example" });
  await makePerson(db(), tied, { email: "c@tie.example" });
  return { marketing, build, tied };
}

describe("topUp", () => {
  it("routes each firm through the plan and approves every draft", async () => {
    const { marketing, build, tied } = await seedAgencies();
    const stats = await topUp(db(), CAMPAIGN, opts(3));
    expect(stats).toMatchObject({
      capacity_per_day: 2,
      queued: 0,
      target: 6,
      shortfall: 6,
      enrolled: 3,
    });
    expect(stats.timezones).toEqual({ candidates: 3, resolved: 1, unresolved: 2 });
    const [austin] = await db().select().from(companies).where(eq(companies.id, marketing.id));
    expect(austin?.timezone).toBe("America/Chicago");
    expect(stats.exhausted).toBe(true);
    expect(stats.passes.map((p) => [p.sequence, p.stats.enrolled])).toEqual([
      ["marketing-days-0-5", 1],
      ["build-days-0-5", 1],
      ["marketing-days-0-5", 1],
    ]);
    const bySeq = new Map((await allEnrollments(db())).map((e) => [e.companyId, e.sequenceName]));
    expect(bySeq.get(marketing.id)).toBe("marketing-days-0-5");
    expect(bySeq.get(build.id)).toBe("build-days-0-5");
    expect(bySeq.get(tied.id)).toBe("marketing-days-0-5");
    // Each enrollment carries the offer its sequence pitches.
    const byOffer = new Map((await allEnrollments(db())).map((e) => [e.companyId, e.offer]));
    expect(byOffer.get(marketing.id)).toBe("marketing-offer");
    expect(byOffer.get(build.id)).toBe("build-offer");
    expect(await queuedOpeners(db(), "agencies")).toBe(3);
  });

  it("stops at the target and does nothing once the queue is full", async () => {
    await seedAgencies();
    const first = await topUp(db(), CAMPAIGN, opts(1));
    expect(first).toMatchObject({ target: 2, enrolled: 2, exhausted: false });
    const second = await topUp(db(), CAMPAIGN, opts(1));
    expect(second).toMatchObject({ queued: 2, shortfall: 0, enrolled: 0, exhausted: false });
    expect(second.passes).toEqual([]);
  });
});
