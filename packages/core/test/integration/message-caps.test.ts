/** The cross-channel frequency cap: email, texts and DMs add up per person (B4). */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  askConsent,
  confirmConsent,
  giveConsent,
  mayMarket,
  recordMarketingSend,
} from "../../src/marketing.js";
import {
  MESSAGE_DEFAULTS,
  personKeyOf,
  readMessageSettings,
  recordMessageSend,
  saveMessageSettings,
  setPersonResolver,
} from "../../src/message-settings.js";
import { topics } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
afterEach(() => setPersonResolver(null));
beforeEach(async () => {
  await truncate(pg.db, [
    "marketing_sends",
    "message_settings",
    "consent_events",
    "consents",
    "topics",
  ]);
  await pg.db.insert(topics).values([
    {
      name: "weekly-breakdown",
      publicName: "Weekly breakdown",
      line: "One automation, weekly",
      channel: "email",
      cadence: "weekly",
      public: true,
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

const HOUR = 3_600_000;
const t0 = new Date("2026-10-05T12:00:00Z");
const at = (hours: number) => new Date(t0.getTime() + hours * HOUR);
const email = { channel: "email" as const, address: "ana@firm.example", topic: "weekly-breakdown" };
const sms = { channel: "sms" as const, address: "+15555550100", topic: "texts" };

async function subscribe() {
  await askConsent(pg.db, {
    ...email,
    source: "lander_form",
    textVersion: "v1",
    evidence: { form: "https://example.test/signup" },
    by: "lander:form",
    now: t0,
  });
  const e = await confirmConsent(pg.db, {
    ...email,
    evidence: { click: true },
    by: "subscriber",
    now: t0,
  });
  const s = await giveConsent(pg.db, {
    ...sms,
    source: "sms_keyword",
    textVersion: "join-1",
    evidence: { keyword: "JOIN" },
    by: "subscriber",
    now: t0,
  });
  if (!e) throw new Error("the signup didn't confirm");
  return { e, s };
}

describe("the cross-channel cap", () => {
  it("has defaults until a row is saved", async () => {
    expect(await readMessageSettings(pg.db)).toEqual(MESSAGE_DEFAULTS);
    const saved = await saveMessageSettings(pg.db, { capPerDay: 1 }, "owner@client.example");
    expect(saved).toEqual({ ...MESSAGE_DEFAULTS, capPerDay: 1 });
    expect(await readMessageSettings(pg.db)).toEqual(saved);
  });

  it("counts email, texts and DMs together for one person", async () => {
    const { e, s } = await subscribe();
    const person = "person:7";
    // Two a day by default: a text and a DM fill it, so the email waits.
    await recordMarketingSend(pg.db, { consentId: s.id, by: "t", person, now: at(1) });
    await recordMessageSend(pg.db, { personKey: person, channel: "dm", now: at(2) });
    expect(await mayMarket(pg.db, { ...email, person, now: at(3) })).toMatchObject({
      send: false,
      why: "capped",
    });
    // Another person is not affected.
    expect(await mayMarket(pg.db, { ...email, person: "person:8", now: at(3) })).toMatchObject({
      send: true,
    });
    // The window rolls: a day on, the email may go.
    expect(await mayMarket(pg.db, { ...email, person, now: at(26) })).toMatchObject({ send: true });
    await recordMarketingSend(pg.db, { consentId: e.id, by: "t", person, now: at(26) });
  });

  it("holds the week as well as the day", async () => {
    const { e } = await subscribe();
    await saveMessageSettings(pg.db, { capPerDay: 3, capPerWeek: 3 }, "owner@client.example");
    const person = "person:7";
    for (const h of [0, 24, 48]) {
      expect(await mayMarket(pg.db, { ...email, person, now: at(h) })).toMatchObject({
        send: true,
      });
      await recordMarketingSend(pg.db, { consentId: e.id, by: "t", person, now: at(h) });
    }
    expect(await mayMarket(pg.db, { ...email, person, now: at(72) })).toMatchObject({
      why: "capped",
    });
    // Seven days after the first, one falls out of the week.
    expect(await mayMarket(pg.db, { ...email, person, now: at(24 * 7 + 1) })).toMatchObject({
      send: true,
    });
  });

  it("is off when both caps are null", async () => {
    const { e } = await subscribe();
    await saveMessageSettings(pg.db, { capPerDay: null, capPerWeek: null }, "owner@client.example");
    const person = "person:7";
    for (let i = 0; i < 12; i++) {
      await recordMessageSend(pg.db, { personKey: person, channel: "dm", now: at(i) });
    }
    expect(await mayMarket(pg.db, { ...email, person, now: at(13) })).toMatchObject({ send: true });
    expect(e.state).toBe("confirmed");
  });

  it("finds one key for a person when a resolver knows them", async () => {
    await subscribe();
    setPersonResolver(async (_db, _kind, value) =>
      value === "ana@firm.example" || value === "+15555550100" ? "person:1" : null,
    );
    expect(await personKeyOf(pg.db, "email", "Ana@Firm.example")).toBe("person:1");
    expect(await personKeyOf(pg.db, "sms", "+15555550100")).toBe("person:1");
    expect(await personKeyOf(pg.db, "dm", " @Ana_Firm ")).toBe("handle:@ana_firm");
    setPersonResolver(null);
    expect(await personKeyOf(pg.db, "email", "Ana@Firm.example")).toBe("email:ana@firm.example");
  });

  it("a recorded send keys the person from its consent when none is given", async () => {
    const { s } = await subscribe();
    await recordMarketingSend(pg.db, { consentId: s.id, by: "t", campaign: "autumn", now: t0 });
    const key = await personKeyOf(pg.db, "sms", sms.address);
    await recordMessageSend(pg.db, { personKey: key, channel: "dm", now: at(1) });
    expect(await mayMarket(pg.db, { ...sms, now: at(2) })).toMatchObject({ why: "capped" });
  });

  it("refuses a weekly cap under the daily one", async () => {
    await expect(
      saveMessageSettings(pg.db, { capPerDay: 4, capPerWeek: 3 }, "owner@client.example"),
    ).rejects.toThrow(/weekly cap/);
  });
});
