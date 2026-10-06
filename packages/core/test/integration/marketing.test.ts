/** Opt-in marketing: consent with proof, one send rule, and how it meets suppressions. */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  askConsent,
  confirmConsent,
  giveConsent,
  mayMarket,
  pauseMarketing,
  preferencesOf,
  recordMarketingSend,
  setFrequency,
  undoUnsubscribeEverything,
  unsubscribeEverything,
  withdrawConsent,
} from "../../src/marketing.js";
import { consentEvents, suppressionEvents, topics } from "../../src/schema.js";
import { activeSuppressionOf, addSuppression } from "../../src/suppress.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, [
    "consent_events",
    "consents",
    "topics",
    "suppression_events",
    "suppressions",
  ]);
  await pg.db.insert(topics).values([
    {
      name: "weekly-breakdown",
      publicName: "Weekly breakdown",
      line: "A short breakdown of one automation, weekly",
      channel: "email",
      cadence: "weekly",
      public: true,
    },
    {
      name: "launch-notes",
      publicName: "Launch notes",
      line: "When something new ships",
      channel: "email",
      cadence: "a few times a year",
      public: false,
    },
    {
      name: "texts",
      publicName: "Texts",
      line: "A heads-up before each live session",
      channel: "sms",
      cadence: "monthly",
      public: true,
    },
  ]);
});

const DAY = 86_400_000;
const t0 = new Date("2026-10-05T12:00:00Z");
const at = (days: number) => new Date(t0.getTime() + days * DAY);
const proof = {
  form: "https://example.test/signup",
  ip: "192.0.2.1",
  text: "Send me the breakdown",
};
const email = { channel: "email" as const, address: "Ana@Firm.example", topic: "weekly-breakdown" };
const signUp = (now = t0) =>
  askConsent(pg.db, {
    ...email,
    source: "lander_form",
    textVersion: "v1",
    evidence: proof,
    by: "lander:form",
    now,
  });
const confirm = (now: Date) =>
  confirmConsent(pg.db, { ...email, evidence: { click: true }, by: "subscriber", now });
const may = (now: Date, over = {}) => mayMarket(pg.db, { ...email, now, ...over });

describe("double opt-in", () => {
  it("a signup can't be sent to until its confirm click", async () => {
    const { consent, confirm: needed } = await signUp();
    expect(needed).toBe(true);
    expect(consent.address).toBe("ana@firm.example");
    expect(await may(at(0))).toMatchObject({ send: false, why: "pending" });
    expect(await confirm(at(1))).toMatchObject({ state: "confirmed" });
    expect(await may(at(1))).toMatchObject({ send: true });
    // A second signup changes nothing and sends no second confirm email.
    expect((await signUp(at(2))).confirm).toBe(false);
    const kinds = (await pg.db.select().from(consentEvents)).map((e) => e.kind);
    expect(kinds).toEqual(["pending", "confirmed"]);
  });

  it("a confirm after 7 days does nothing; signing up again starts over", async () => {
    await signUp();
    // The form posted again the same day mails no second confirm and keeps the first's clock.
    expect((await signUp(at(0.5))).confirm).toBe(false);
    expect(await confirm(at(8))).toBeNull();
    expect(await may(at(8))).toMatchObject({ send: false, why: "pending" });
    await signUp(at(8));
    expect(await confirm(at(9))).toMatchObject({ state: "confirmed" });
  });

  it("an address with no consent, or another topic's, gets nothing", async () => {
    expect(await may(t0)).toMatchObject({ send: false, why: "no consent" });
    await signUp();
    await confirm(t0);
    expect(await may(t0, { topic: "launch-notes" })).toMatchObject({ why: "no consent" });
    await expect(may(t0, { topic: "nope" })).rejects.toThrow(/no topic/);
    await expect(may(t0, { topic: "texts" })).rejects.toThrow(/sms/);
  });
});

describe("suppressions", () => {
  it("beat every consent, the domain's included", async () => {
    await signUp();
    await confirm(t0);
    await addSuppression(pg.db, { kind: "domain", value: "firm.example", reason: "manual" });
    expect(await may(t0)).toMatchObject({ send: false, why: "suppressed" });
  });

  it("a double opt-in that starts after an opt-out lifts it, with the consent as evidence", async () => {
    await addSuppression(pg.db, { kind: "email", value: "ana@firm.example", reason: "opt_out" });
    await signUp(new Date(Date.now() + 1000));
    const ok = await confirm(new Date(Date.now() + 2000));
    expect(await activeSuppressionOf(pg.db, "email", "ana@firm.example")).toBeNull();
    const lifted = await pg.db
      .select()
      .from(suppressionEvents)
      .where(eq(suppressionEvents.reason, "lifted"));
    expect(lifted[0]?.evidence).toMatchObject({ consent: ok?.id, doubleOptIn: true });
  });

  it("an opt-out after the signup, a bounce, or a one-step consent lifts nothing", async () => {
    await signUp(new Date(Date.now() - 60_000));
    await addSuppression(pg.db, { kind: "email", value: "ana@firm.example", reason: "opt_out" });
    await confirm(new Date());
    expect(await activeSuppressionOf(pg.db, "email", "ana@firm.example")).not.toBeNull();

    const bob = {
      channel: "email" as const,
      address: "bob@firm.example",
      topic: "weekly-breakdown",
    };
    await addSuppression(pg.db, { kind: "email", value: bob.address, reason: "bounce" });
    const later = new Date(Date.now() + 1000);
    await askConsent(pg.db, {
      ...bob,
      source: "lander_form",
      textVersion: "v1",
      evidence: proof,
      by: "lander:form",
      now: later,
    });
    await confirmConsent(pg.db, { ...bob, evidence: null, by: "subscriber", now: later });
    expect(await activeSuppressionOf(pg.db, "email", bob.address)).not.toBeNull();

    const cy = { ...bob, address: "cy@firm.example" };
    await addSuppression(pg.db, { kind: "email", value: cy.address, reason: "opt_out" });
    await giveConsent(pg.db, {
      ...cy,
      source: "meta_lead_form",
      textVersion: "form-1",
      evidence: { form: "1" },
      by: "meta:lead-form",
      now: later,
    });
    expect(await mayMarket(pg.db, { ...cy, now: later })).toMatchObject({ why: "suppressed" });
  });

  it("unsubscribe from everything is an opt-out, undone only by its own Undo within a day", async () => {
    await signUp();
    await confirm(t0);
    const event = await unsubscribeEverything(pg.db, { ...email, evidence: { page: "prefs" } });
    expect(await may(t0)).toMatchObject({ why: "suppressed" });
    expect(await undoUnsubscribeEverything(pg.db, { ...email, event: event + 1 })).toBe(false);
    // The event is stamped by the database's clock, so "too late" is two days past real now.
    const late = new Date(Date.now() + 2 * DAY);
    expect(await undoUnsubscribeEverything(pg.db, { ...email, event, now: late })).toBe(false);
    expect(await undoUnsubscribeEverything(pg.db, { ...email, event })).toBe(true);
    expect(await may(t0)).toMatchObject({ send: true });
    expect(await undoUnsubscribeEverything(pg.db, { ...email, event })).toBe(false);
  });
});

describe("the person's own settings", () => {
  it("withdraw, pause, and frequency each stop a send, and each is logged", async () => {
    await signUp();
    await confirm(t0);
    expect(await pauseMarketing(pg.db, { ...email, days: 30, by: "subscriber", now: t0 })).toBe(1);
    expect(await may(at(29))).toMatchObject({ why: "paused" });
    expect(await may(at(31))).toMatchObject({ send: true });
    await pauseMarketing(pg.db, { ...email, days: null, by: "subscriber" });

    await setFrequency(pg.db, { ...email, frequency: "weekly", by: "subscriber" });
    const ok = await may(t0);
    if (!ok.send) throw new Error("expected a send");
    await recordMarketingSend(pg.db, { consentId: ok.consent.id, by: "test", now: t0 });
    expect(await may(at(6))).toMatchObject({ why: "capped" });
    expect(await may(at(7))).toMatchObject({ send: true });

    expect(await withdrawConsent(pg.db, { ...email, by: "subscriber" })).toMatchObject({
      state: "withdrawn",
    });
    expect(await may(at(8))).toMatchObject({ why: "withdrawn" });
    expect(await withdrawConsent(pg.db, { ...email, by: "subscriber" })).toBeNull();
    const kinds = (await pg.db.select().from(consentEvents)).map((e) => e.kind);
    expect(kinds).toEqual([
      "pending",
      "confirmed",
      "paused",
      "paused",
      "frequency",
      "sent",
      "withdrawn",
    ]);
  });

  it("SMS stops at 4 texts in 31 days, and never follows from email consent", async () => {
    await signUp();
    await confirm(t0);
    const sms = { channel: "sms" as const, address: "+15555550100", topic: "texts" };
    expect(await mayMarket(pg.db, { ...sms, now: t0 })).toMatchObject({ why: "no consent" });
    const c = await giveConsent(pg.db, {
      ...sms,
      source: "sms_keyword",
      textVersion: "join-1",
      evidence: { keyword: "JOIN" },
      by: "subscriber",
      now: t0,
    });
    for (const d of [0, 1, 2, 3]) {
      expect(await mayMarket(pg.db, { ...sms, now: at(d) })).toMatchObject({ send: true });
      await recordMarketingSend(pg.db, { consentId: c.id, by: "test", now: at(d) });
    }
    expect(await mayMarket(pg.db, { ...sms, now: at(30) })).toMatchObject({ why: "capped" });
    expect(await mayMarket(pg.db, { ...sms, now: at(31.5) })).toMatchObject({ send: true });
  });

  it("the preference center sees public topics only", async () => {
    await signUp();
    await confirm(t0);
    const p = await preferencesOf(pg.db, "email", "ana@firm.example");
    expect(p.topics.map((t) => [t.publicName, t.on])).toEqual([["Weekly breakdown", true]]);
    expect(p.everything).toBe(false);
  });
});

describe("the console's views", () => {
  it("a subscriber says whether we can send, and its activity carries the proof", async () => {
    await signUp(new Date());
    await confirm(new Date());
    const rows = await pg.db.execute<{ state: string; can_send: string; actor: string }>(
      sql`select state, can_send, actor from marketing_subscriber_records`,
    );
    expect(rows[0]).toMatchObject({ state: "confirmed", actor: "subscriber" });
    expect(rows[0]?.can_send).toMatch(
      /^Can send: confirmed for Weekly breakdown on \w+ \d+ by lander form$/,
    );
    await unsubscribeEverything(pg.db, { ...email, evidence: { page: "prefs" } });
    const [off] = await pg.db.execute<{ state: string; can_send: string }>(
      sql`select state, can_send from marketing_subscriber_records`,
    );
    expect(off).toMatchObject({ state: "off" });
    expect(off?.can_send).toMatch(/^Can't send: unsubscribed from everything on/);
    const what = (
      await pg.db.execute<{ what: string }>(
        sql`select what from marketing_subscriber_activity
            where subscriber = 'email:ana@firm.example' order by at, kind`,
      )
    ).map((r) => r.what);
    expect(what[0]).toMatch(
      /^Signed up for Weekly breakdown, by lander:form · .*form https:\/\/example\.test\/signup/,
    );
    expect(what).toContain("Unsubscribed from everything · via preference center, page prefs");
  });

  it("a topic counts confirms over signups and leaves over sends", async () => {
    await signUp(new Date());
    const c = await confirm(new Date());
    await recordMarketingSend(pg.db, { consentId: c?.id ?? 0, by: "test" });
    await withdrawConsent(pg.db, { ...email, by: "subscriber" });
    const [t] = await pg.db.execute<Record<string, unknown>>(
      sql`select confirmed::int, signups::int, confirms::int, leaves::int, sends::int,
            net_week::int, shown from marketing_topic_records where id = 'weekly-breakdown'`,
    );
    expect(t).toMatchObject({
      confirmed: 0,
      signups: 1,
      confirms: 1,
      leaves: 1,
      sends: 1,
      net_week: 0,
      shown: "shown",
    });
  });
});
