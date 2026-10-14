/** The cross-channel frequency cap: email, texts and DMs add up per person (B4). */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askConsent,
  confirmConsent,
  giveConsent,
  mayMarket,
  recordMarketingSend,
} from "../../src/marketing.js";
import {
  campaignOfRef,
  capCheck,
  capRoomAt,
  countMarketingSend,
  MESSAGE_DEFAULTS,
  personKeyOf,
  readMessageSettings,
  recordMessageSend,
  saveMessageSettings,
  setPersonResolver,
} from "../../src/message-settings.js";
import { profileOf, resolveProfile } from "../../src/profiles.js";
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
    "profiles",
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
    setPersonResolver(async (_db, _kind, value) =>
      value === "ana@firm.example" || value === "+15555550100" ? "person:1" : null,
    );
    expect(await personKeyOf(pg.db, "email", "Ana@Firm.example")).toBe("person:1");
    expect(await personKeyOf(pg.db, "sms", "+15555550100")).toBe("person:1");
    expect(await personKeyOf(pg.db, "dm", " @Ana_Firm ", "x")).toBe("handle:x:@ana_firm");
    setPersonResolver(null);
    expect(await personKeyOf(pg.db, "email", "Ana@Firm.example")).toBe("email:ana@firm.example");
  });

  it("uses People's profiles with no resolver installed: one person, one key, on every channel", async () => {
    // Unknown address: the address is the key.
    expect(await personKeyOf(pg.db, "email", "Ana@Firm.example")).toBe("email:ana@firm.example");
    expect(await personKeyOf(pg.db, "dm", " @Ana_Firm ", "linkedin")).toBe(
      "handle:linkedin:@ana_firm",
    );
    const p = await resolveProfile(
      pg.db,
      [
        { kind: "email", value: "ana@firm.example" },
        { kind: "phone", value: "+15555550100" },
        { kind: "handle:linkedin", value: "ana-firm" },
      ],
      "test",
    );
    const key = `profile:${p?.id}`;
    expect(await personKeyOf(pg.db, "email", "Ana@Firm.example")).toBe(key);
    expect(await personKeyOf(pg.db, "sms", "+1 (555) 555-0100")).toBe(key);
    expect(await personKeyOf(pg.db, "dm", "ana-firm", "linkedin")).toBe(key);
    // Read only: asking about a stranger makes no profile.
    await personKeyOf(pg.db, "email", "nobody@firm.example");
    expect(await profileOf(pg.db, { kind: "email", value: "nobody@firm.example" })).toBeNull();
    // A text and a DM fill the day, so the email waits.
    await recordMessageSend(pg.db, { personKey: key, channel: "dm", now: at(1) });
    await recordMessageSend(pg.db, { personKey: key, channel: "sms", now: at(2) });
    const { e } = await subscribe();
    expect(await mayMarket(pg.db, { ...email, now: at(3) })).toMatchObject({
      send: false,
      why: "capped",
    });
    expect(e.state).toBe("confirmed");
  });

  it("a recorded send keys the person from its consent when none is given", async () => {
    const { s } = await subscribe();
    await recordMarketingSend(pg.db, { consentId: s.id, by: "t", campaign: "autumn", now: t0 });
    const key = await personKeyOf(pg.db, "sms", sms.address);
    await recordMessageSend(pg.db, { personKey: key, channel: "dm", now: at(1) });
    expect(await mayMarket(pg.db, { ...sms, now: at(2) })).toMatchObject({ why: "capped" });
  });

  it("says when a person has room again: the day's oldest holding send, or the week's", async () => {
    const key = "phone:+15555550100";
    expect(await capRoomAt(pg.db, key, at(0))).toBeNull();
    await recordMessageSend(pg.db, { personKey: key, channel: "email", now: at(-5) });
    expect(await capRoomAt(pg.db, key, at(0))).toBeNull();
    await recordMessageSend(pg.db, { personKey: key, channel: "dm", now: at(-1) });
    // Two a day: at the cap until the 5-hour-old send is a day old, 19 hours from now.
    expect(await capRoomAt(pg.db, key, at(0))).toEqual(at(19));
    // A third inside the window does not move it: one leaving still leaves one under two.
    await recordMessageSend(pg.db, { personKey: key, channel: "sms", now: at(-0.5) });
    expect(await capRoomAt(pg.db, key, at(0))).toEqual(at(23));
    // The week: five a week, the fifth-newest leaving, once the day's room has passed.
    await saveMessageSettings(pg.db, { capPerDay: null }, "owner@client.example");
    expect(await capRoomAt(pg.db, key, at(0))).toBeNull();
    for (const h of [-30, -54]) {
      await recordMessageSend(pg.db, { personKey: key, channel: "email", now: at(h) });
    }
    expect(await capRoomAt(pg.db, key, at(0))).toEqual(new Date(at(-54).getTime() + 7 * 24 * HOUR));
    await saveMessageSettings(pg.db, { capPerWeek: null }, "owner@client.example");
    expect(await capRoomAt(pg.db, key, at(0))).toBeNull();
  });

  it("checks a text or DM address and counts it after, never throwing", async () => {
    const first = await capCheck(pg.db, "sms", "+1 555 555 0100", at(0));
    expect(first).toEqual({ person: "phone:+15555550100", until: null });
    await countMarketingSend(pg.db, { personKey: first.person, channel: "sms", now: at(0) });
    await countMarketingSend(pg.db, { personKey: first.person, channel: "sms", now: at(1) });
    const second = await capCheck(pg.db, "sms", "+15555550100", at(2));
    expect(second.until).toEqual(at(24));
    // A DM address has its own key until People links it.
    expect(await capCheck(pg.db, "dm", "@Ana_Firm", at(2), "reddit")).toEqual({
      person: "handle:reddit:@ana_firm",
      until: null,
    });
    // A bad row is logged, not thrown: the message already went.
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      countMarketingSend(pg.db, { personKey: "x", channel: "bogus" as "sms", now: at(2) }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("marketing send not counted"));
    log.mockRestore();
    expect(campaignOfRef("keep_warm/follow.text1")).toBe("keep_warm");
    expect(campaignOfRef(null)).toBeNull();
    expect(campaignOfRef("/x")).toBeNull();
  });

  it("refuses a weekly cap under the daily one", async () => {
    await expect(
      saveMessageSettings(pg.db, { capPerDay: 4, capPerWeek: 3 }, "owner@client.example"),
    ).rejects.toThrow(/weekly cap/);
  });
});
