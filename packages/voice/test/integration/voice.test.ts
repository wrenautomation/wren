/**
 * The voice agent on Postgres, synthetic numbers only: the rules before any dial, a finished call
 * saved with its turns and matched to its texting contact, and the Calls and Latency views.
 */
import { smsContacts } from "@wren/channel-sms/schema";
import { addSuppression } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentOf } from "../../src/agent.js";
import { type CallResult, runCall } from "../../src/call.js";
import { DialRefused, mayDial, placeCall } from "../../src/consent.js";
import { fakePorts, ScriptedBrain } from "../../src/fakes.js";
import { phoneConsents, voiceCalls, voiceTurns } from "../../src/schema.js";
import { saveCall } from "../../src/store.js";
import type { TelnyxControl } from "../../src/transports/telnyx.js";
import { TextTransport } from "../../src/transports/text.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, [
    "voice_turns",
    "voice_calls",
    "phone_consents",
    "sms_contacts",
    "suppressions",
  ]);
});

const TO = "+15555550142";
const ZONE = "America/Toronto";
const OPEN = new Date("2026-10-06T15:00:00Z"); // Tue 11:00 in Toronto
const LATE = new Date("2026-10-07T03:00:00Z"); // Tue 23:00 in Toronto
const dialer = agentOf({ outbound: true });

const consent = (over: Partial<typeof phoneConsents.$inferInsert> = {}) =>
  pg.db.insert(phoneConsents).values({
    e164: TO,
    source: "form",
    text: "Wren may call or text me, including with an AI voice.",
    textVersion: "test-1",
    aiVoice: true,
    givenAt: new Date("2026-10-01T12:00:00Z"),
    ...over,
  });

const why = async (o: Partial<Parameters<typeof mayDial>[1]> = {}) => {
  const v = await mayDial(pg.db, {
    to: TO,
    agent: dialer,
    whose: "wren",
    zone: ZONE,
    now: OPEN,
    ...o,
  });
  return v.ok ? "ok" : v.why;
};

describe("before any dial", () => {
  it("refuses without the agent's yes, a real number, or written consent", async () => {
    expect(await why({ agent: agentOf({}) })).toBe("agent_off");
    expect(await why({ to: "5550142" })).toBe("bad_number");
    expect(await why()).toBe("no_consent");
  });

  it("refuses consent that doesn't cover an AI voice, or was revoked, or is another client's", async () => {
    await consent({ aiVoice: false });
    expect(await why()).toBe("no_ai_consent");
    await truncate(pg.db, ["phone_consents"]);
    await consent({ revokedAt: new Date("2026-10-02T12:00:00Z") });
    expect(await why()).toBe("no_consent");
    await consent({ whose: "someone-else" });
    expect(await why()).toBe("no_consent");
  });

  it("refuses a suppressed number and quiet hours, then allows", async () => {
    await consent();
    expect(await why({ now: LATE })).toBe("quiet_hours");
    expect(await why()).toBe("ok");
    await addSuppression(pg.db, { kind: "phone", value: TO, reason: "opt_out" });
    expect(await why()).toBe("suppressed");
  });

  it("placeCall never reaches the phone network when refused", async () => {
    const dialed: string[] = [];
    const control: TelnyxControl = {
      transfer: async () => {},
      hangup: async () => {},
      dial: async (o) => {
        dialed.push(o.to);
        return "cc-1";
      },
    };
    const o = {
      agent: dialer,
      whose: "wren",
      from: "+15555550100",
      to: TO,
      zone: ZONE,
      streamUrl: "wss://voice.example/media",
      connectionId: "conn-1",
      now: OPEN,
    };
    await expect(placeCall(pg.db, control, o)).rejects.toBeInstanceOf(DialRefused);
    expect(dialed).toEqual([]);
    await consent();
    expect(await placeCall(pg.db, control, o)).toBe("cc-1");
    expect(dialed).toEqual([TO]);
  });
});

/** A typed call on the fakes, start to end. */
async function aCall(from: string, lines: string[]): Promise<CallResult> {
  let next = 0;
  const t = new TextTransport(
    { id: `t-${from}`, from, to: "", direction: "inbound" },
    {
      said: () => {},
      ended: () => {},
    },
  );
  return runCall({
    pipeline: { transport: t, brain: new ScriptedBrain() },
    agent: agentOf({}),
    ports: fakePorts(),
    date: () => OPEN,
    onTurn: () => {
      const line = lines[next++];
      setTimeout(() => (line === undefined ? t.leave() : t.type(line)), 0);
    },
  });
}

describe("a saved call", () => {
  it("keeps the transcript and turns, finds the texting contact, and shows in the views", async () => {
    const [contact] = await pg.db
      .insert(smsContacts)
      .values({
        e164: "+15555550123",
        sourceKind: "manual",
        basis: "published",
        state: "new",
        name: "Synthetic Caller",
      })
      .returning();
    const result = await aCall("+15555550123", [
      "I'd like to book a call",
      "The first one works",
      "Bye",
    ]);
    expect(result.outcome).toBe("booked");
    const id = await saveCall(pg.db, result, { whose: "wren", by: null });

    const [row] = await pg.db.select().from(voiceCalls).where(sql`id = ${id}`);
    expect(row?.smsContactId).toBe(contact?.id);
    expect(row?.leadName).toBe("Sam Example");
    expect(row?.transcript.length).toBe(result.transcript.length);
    const turns = await pg.db.select().from(voiceTurns).where(sql`call_id = ${id}`);
    expect(turns.map((t) => t.n).sort()).toEqual(result.turns.map((t) => t.n).sort());

    const [rec] = await pg.db.execute<{
      who: string;
      outcome: string;
      turns: number;
      heard: number | null;
    }>(sql`select who, outcome, turns, heard from voice_call_records where id = ${id}`);
    expect(rec).toMatchObject({ who: "Sam Example", outcome: "booked", turns: 3 });
    expect(typeof rec?.heard).toBe("number");

    const stages = await pg.db.execute<{ stage: string; p50: number; turns: number }>(
      sql`select stage, p50, turns from voice_latency order by rank`,
    );
    expect(stages.map((s) => s.stage)).toEqual(["final", "end", "token", "audio", "heard"]);
    for (const s of stages) {
      expect(typeof s.p50).toBe("number");
      expect(s.turns).toBe(3);
    }
  });

  it("an unknown caller with no lead reads as their number", async () => {
    const id = await saveCall(pg.db, await aCall("+15555550177", []), { whose: "wren", by: null });
    const [rec] = await pg.db.execute<{ who: string; outcome: string; turns: number }>(
      sql`select who, outcome, turns from voice_call_records where id = ${id}`,
    );
    expect(rec).toEqual({ who: "+15555550177", outcome: "hung_up", turns: 0 });
  });
});
