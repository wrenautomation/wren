/**
 * Speed to lead's call on Postgres, synthetic leads and a fake Call Control: "Call now" for the
 * rep while voice isn't set up, a lead who booked is skipped and ends the run, and a configured
 * dialer still goes through `placeCall`'s rules. Nothing reaches a phone network.
 */
import { FakeBookings, speedRuns } from "@wren/channel-sms";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentOf } from "../../src/agent.js";
import { type CallNowDeps, callNow, callNowStep, type Dialer } from "../../src/call-now.js";
import { phoneConsents } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, ["speed_runs", "sms_contacts", "phone_consents", "suppressions"]);
});

const TO = "+15555550142";
// Tue 11:00 in Toronto: inside calling hours.
const OPEN = new Date("2026-10-06T15:00:00Z");

async function aRun(over: Partial<typeof speedRuns.$inferInsert> = {}) {
  const [run] = await pg.db
    .insert(speedRuns)
    .values({
      workflow: "speed_to_lead.steps",
      subject: `form:${over.email ?? "lee@example.test"}`,
      leadAt: OPEN,
      name: "Lee Test",
      phone: "555 555 0142",
      e164: TO,
      email: "lee@example.test",
      consent: true,
      zone: "America/Toronto",
      firstTouch: "queued",
      ...over,
    })
    .returning();
  return run as typeof speedRuns.$inferSelect;
}

const deps = (o: Partial<CallNowDeps> = {}): CallNowDeps => ({
  db: pg.db,
  bookings: new FakeBookings(),
  dialer: null,
  ...o,
});

function fakeDialer(dialed: string[]): Dialer {
  return {
    control: {
      transfer: async () => {},
      hangup: async () => {},
      dial: async (o) => {
        dialed.push(o.to);
        return "cc-1";
      },
    },
    agent: agentOf({ outbound: true }),
    whose: "wren",
    from: "+15555550100",
    streamUrl: "wss://voice.example.test/stream",
    connectionId: "conn-1",
  };
}

describe("call now", () => {
  it("without voice set up, the rep gets Call now, once", async () => {
    const run = await aRun();
    const got = await callNow(deps(), run.id, OPEN);
    expect(got).toMatchObject({
      booked: false,
      run: { call: "alerted", callDetail: "voice not set up", callAt: OPEN },
    });
    const again = await callNow(deps(), run.id, new Date(OPEN.getTime() + 60_000));
    expect(again.run.callAt).toEqual(OPEN);
  });

  it("a lead who booked isn't called, and the run ends booked", async () => {
    const run = await aRun();
    const bookings = new FakeBookings(["lee@example.test"]);
    const step = callNowStep(() => deps({ bookings }));
    const out = await step(
      "leads",
      { subject: run.subject, kind: "lead", data: { run: run.id } },
      {
        client: null,
        workflow: "speed_to_lead.steps",
        node: "call",
        with: {},
      },
    );
    expect(out).toEqual([
      {
        port: "booked",
        event: {
          subject: run.subject,
          kind: "call",
          data: { run: run.id, booked: "booked on fake" },
        },
      },
    ]);
    const [after] = await pg.db.select().from(speedRuns);
    expect(after).toMatchObject({ call: "skipped" });
    expect(after?.bookedAt).not.toBeNull();
  });

  it("a configured dialer still needs written AI-call consent", async () => {
    const dialed: string[] = [];
    const refused = await callNow(deps({ dialer: fakeDialer(dialed) }), (await aRun()).id, OPEN);
    expect(refused.run).toMatchObject({ call: "alerted" });
    expect(refused.run.callDetail).toMatch(/^voice can't dial: No written consent/);
    expect(dialed).toEqual([]);

    await pg.db.insert(phoneConsents).values({
      e164: TO,
      source: "form",
      text: "Test Co may call or text me, including with an AI voice.",
      textVersion: "test-1",
      aiVoice: true,
      givenAt: new Date("2026-10-01T12:00:00Z"),
    });
    const run = await aRun({ email: "max@example.test" });
    const got = await callNow(deps({ dialer: fakeDialer(dialed) }), run.id, OPEN);
    expect(got.run).toMatchObject({ call: "dialed", callDetail: "cc-1" });
    expect(dialed).toEqual([TO]);
  });

  it("no phone: the rep is alerted with what there is", async () => {
    const run = await aRun({ phone: null, e164: null, firstTouch: "no_phone" });
    const got = await callNow(deps({ dialer: fakeDialer([]) }), run.id, OPEN);
    expect(got.run).toMatchObject({ call: "alerted", callDetail: "no number to dial" });
  });
});
