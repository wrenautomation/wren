/** The queue-keeper's top-up: capacity × days ahead, minus what is queued, through the plan. */
import { loadSettings } from "@wren/config";
import { companies } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sequence, sequenceStep } from "../../src/outreach/sequences.js";
import { field, template, text } from "@wren/core/slots";
import { DEFAULT_RECONTACT } from "../../src/recontact.js";
import {
  type Campaign,
  queuedOpeners,
  refreshCampaign,
  topUp,
} from "../../src/restate/compose-scheduler.js";
import { enrollments, messages } from "../../src/schema.js";
import { SendPolicy } from "../../src/send/policy.js";
import {
  allEnrollments,
  FOLLOWUP,
  makeCompany,
  makePerson,
  makePick,
  makeRoleLead,
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
  mailsRoleInboxes: true,
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
  offerFacts: new Map(),
  templates: new Map([
    ["marketing/opener", MARKETING],
    ["build/opener", BUILD],
    ["followup", FOLLOWUP],
  ]),
  factsView: "agency_facts",
  senders: [SENDER],
  signatures: { [SENDER]: "William" },
  companyLocation: (c) => ((c.raw ?? {}) as Record<string, unknown>).Location as string | null,
  recontact: DEFAULT_RECONTACT,
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
    // First contact through the plan, then the same plan for returning firms (none yet).
    expect(stats.passes.map((p) => [p.audience, p.sequence, p.stats.enrolled])).toEqual([
      ["first_contact", "marketing-days-0-5", 1],
      ["first_contact", "build-days-0-5", 1],
      ["first_contact", "marketing-days-0-5", 1],
      ["returning", "marketing-days-0-5", 0],
      ["returning", "build-days-0-5", 0],
      ["returning", "marketing-days-0-5", 0],
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

  it("a niche that mails people only leaves the inbox a pick chose alone", async () => {
    await seedAgencies();
    const desk = await makeCompany(db(), { domain: "desk.example", niche: "agencies" });
    await makeRoleLead(db(), desk, "info@desk.example");
    await makePick(db(), desk, "info@desk.example");
    // An inbox has no first name: openers that greet nobody, so only the switch decides.
    const greetless = new Map(
      [...CAMPAIGN.templates].map(([name, t]) => [
        name,
        name.endsWith("/opener") ? template(name, [text("month end")], [text("Hi there")]) : t,
      ]),
    );
    const campaign = { ...CAMPAIGN, templates: greetless };
    const people = await topUp(db(), { ...campaign, mailsRoleInboxes: false }, opts(3));
    expect(people.enrolled).toBe(3);
    const all = await topUp(db(), campaign, opts(3));
    expect(all.enrolled).toBe(1);
    const atDesk = (await allEnrollments(db())).filter((e) => e.companyId === desk.id);
    expect(atDesk.map((e) => e.personId)).toEqual([null]);
  });

  it("stops at the target and does nothing once the queue is full", async () => {
    await seedAgencies();
    const first = await topUp(db(), CAMPAIGN, opts(1));
    expect(first).toMatchObject({ target: 2, enrolled: 2, exhausted: false });
    const second = await topUp(db(), CAMPAIGN, opts(1));
    expect(second).toMatchObject({ queued: 2, shortfall: 0, enrolled: 0, exhausted: false });
    expect(second.passes).toEqual([]);
  });

  it("re-renders the queue from today's templates and drops pixel tokens when tracking is off", async () => {
    await seedAgencies();
    await topUp(db(), CAMPAIGN, { ...opts(1), trackOpens: true });
    const queued = await db().select().from(messages);
    expect(queued.every((m) => m.openToken !== null)).toBe(true);
    const edited = queued.find((m) => m.template === "followup");
    await db()
      .update(messages)
      .set({ body: "hand edit", editedAt: new Date(), approvedBy: "operator" })
      .where(eq(messages.id, (edited as { id: number }).id));
    const MARKETING_V2 = template(
      "marketing/opener",
      [text("month end")],
      [text("Hello "), field("first_name")],
    );
    const v2: Campaign = {
      ...CAMPAIGN,
      templates: new Map([...CAMPAIGN.templates, ["marketing/opener", MARKETING_V2]]),
    };
    const stats = await topUp(db(), v2, opts(1));
    expect(stats.refresh).toMatchObject({ tokens_changed: queued.length, raced: 0 });
    const after = await db().select().from(messages);
    expect(after.every((m) => m.openToken === null)).toBe(true);
    const openers = after.filter((m) => m.template === "marketing/opener" && m.id !== edited?.id);
    expect(openers.length).toBeGreaterThan(0);
    expect(openers.every((m) => m.body.startsWith("Hello "))).toBe(true);
    expect(openers.every((m) => m.templateVersion === MARKETING_V2.version)).toBe(true);
    // What a person approved or edited ships as they left it.
    expect(after.find((m) => m.id === edited?.id)?.body).toBe("hand edit");
  });

  it("a deploy's refresh takes the new words and composes nothing", async () => {
    await seedAgencies();
    await topUp(db(), CAMPAIGN, opts(1));
    const before = await db().select().from(messages);
    const v2: Campaign = {
      ...CAMPAIGN,
      templates: new Map([
        ...CAMPAIGN.templates,
        [
          "marketing/opener",
          template("marketing/opener", [text("month end")], [text("Yo "), field("first_name")]),
        ],
      ]),
    };
    const unchanged = await refreshCampaign(db(), CAMPAIGN, false, true);
    expect(unchanged.rerendered).toBe(0);
    expect(unchanged.kept_current).toBe(before.length);
    const stats = await refreshCampaign(db(), v2, false, true);
    expect(stats.rerendered).toBeGreaterThan(0);
    const after = await db().select().from(messages);
    expect(after.length).toBe(before.length);
    expect(
      after.filter((m) => m.template === "marketing/opener").every((m) => m.body.startsWith("Yo ")),
    ).toBe(true);
  });

  it("keeps the text of a sequence already started and of a sender no longer active", async () => {
    await seedAgencies();
    await topUp(db(), CAMPAIGN, opts(1));
    const before = await db().select().from(messages);
    const byEnrollment = new Map<number, typeof before>();
    for (const m of before)
      byEnrollment.set(m.enrollmentId, [...(byEnrollment.get(m.enrollmentId) ?? []), m]);
    expect(byEnrollment.size).toBeGreaterThanOrEqual(2);
    const [startedId, inactiveId] = [...byEnrollment.keys()] as [number, number];
    const opener = byEnrollment.get(startedId)?.find((m) => m.step === 0) as { id: number };
    await db()
      .update(messages)
      .set({ state: "sent", sentAt: NOW, messageId: "<sent@example.test>" })
      .where(eq(messages.id, opener.id));
    await db()
      .update(enrollments)
      .set({ sender: "gone@example.test" })
      .where(eq(enrollments.id, inactiveId));
    const v2: Campaign = {
      ...CAMPAIGN,
      templates: new Map(
        [...CAMPAIGN.templates].map(([k, t]) => [
          k,
          template(t.name, [text("new subject")], [text("new body")]),
        ]),
      ),
    };
    const stats = await topUp(db(), v2, opts(1));
    expect(stats.refresh.kept_started_or_inactive).toBe(
      (byEnrollment.get(startedId)?.length ?? 0) - 1 + (byEnrollment.get(inactiveId)?.length ?? 0),
    );
    const after = new Map((await db().select().from(messages)).map((m) => [m.id, m]));
    for (const m of [
      ...(byEnrollment.get(startedId) ?? []),
      ...(byEnrollment.get(inactiveId) ?? []),
    ]) {
      expect(after.get(m.id)?.body).toBe(m.body);
    }
    const others = before.filter(
      (m) => m.enrollmentId !== startedId && m.enrollmentId !== inactiveId,
    );
    for (const m of others) expect(after.get(m.id)?.body.startsWith("new body")).toBe(true);
  });
});
