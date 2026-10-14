/**
 * The `Broadcast` object on Restate (B6): told to run, it starts an approved broadcast, sends its
 * people through a fake mailer and finishes; a newer schedule supersedes an older one. Its
 * handlers are private, so a small test service tells it, as PeopleConsole does. Synthetic rows;
 * no time here depends on today's date.
 */

import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BROADCAST, type BroadcastObject, makeBroadcast } from "../../src/broadcast-run.js";
import {
  type BroadcastMail,
  broadcastById,
  decideBroadcast,
  saveBroadcast,
} from "../../src/broadcasts.js";
import { giveConsent } from "../../src/marketing.js";
import { resolveProfile } from "../../src/profiles.js";
import { topics } from "../../src/schema.js";
import { addMembers, saveSegment } from "../../src/segments.js";
import { startTestRestate } from "../../src/testing.js";

let pg: TestPostgres;
let env: RestateTestEnvironment;
const sent: string[] = [];
const mail: BroadcastMail = {
  domain: "wren.example",
  daily: 1500,
  envelope: () => ({ footer: "\n\n--\nUnsubscribe: https://example.test/u", headers: [] }),
  send: async (m) => {
    sent.push(m.to);
  },
};

/** Tells a broadcast's object when to run, as PeopleConsole's approve does. */
const teller = restate.service({
  name: "TellBroadcast",
  handlers: {
    tell: async (ctx: restate.Context, input: { key: string; at: string }) => {
      ctx.objectSendClient<BroadcastObject>(BROADCAST, input.key).schedule({ at: input.at });
    },
  },
});

beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [
      makeBroadcast({ main: pg.db, clientDb: () => pg.db, mail: async () => mail }),
      teller,
    ],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  sent.length = 0;
  await truncate(pg.db, [
    "broadcast_recipients",
    "broadcasts",
    "segment_member_events",
    "segment_members",
    "segments",
    "marketing_sends",
    "consent_events",
    "consents",
    "topics",
    "profile_events",
    "profile_keys",
    "profiles",
  ]);
  await pg.db.insert(topics).values({
    name: "news",
    publicName: "Monthly news",
    line: "What's new, once a month",
    channel: "email",
    cadence: "monthly",
    public: true,
  });
});

const ingress = () => clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));

/** An approved email broadcast to two people who said yes, one who didn't. */
async function approved(): Promise<number> {
  const now = new Date();
  const ids: number[] = [];
  for (const [name, email, yes] of [
    ["Ann", "ann@firm.example", true],
    ["Bo", "bo@firm.example", true],
    ["Cy", "cy@firm.example", false],
  ] as const) {
    const p = await resolveProfile(pg.db, [{ kind: "email", value: email }], "test", { name });
    ids.push(p?.id as number);
    if (yes)
      await giveConsent(pg.db, {
        channel: "email",
        address: email,
        topic: "news",
        source: "lander_form",
        textVersion: "v1",
        evidence: { form: "https://example.test/signup" },
        by: "subscriber",
        now,
      });
  }
  const { segment } = await saveSegment(pg.db, { name: "Three", kind: "manual" }, "t", now);
  await addMembers(pg.db, segment.id, ids, now);
  const b = await saveBroadcast(
    pg.db,
    {
      name: "Run test",
      channel: "email",
      segmentId: segment.id,
      topic: "news",
      subject: "Hi",
      body: "Hi {first_name|there}.",
      ask: true,
    },
    "t",
    now,
  );
  await decideBroadcast(pg.db, b.id, true, "approver@wren.example", now);
  return b.id;
}

/** Waits for the broadcast to reach a state; the object runs on its own after the tell. */
async function until(id: number, state: string) {
  for (let i = 0; i < 100; i++) {
    if ((await broadcastById(pg.db, id))?.state === state) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`broadcast ${id} never reached ${state}`);
}

describe("Broadcast", () => {
  it("starts on the tell, sends each person once and finishes", async () => {
    const id = await approved();
    await ingress()
      .serviceClient<typeof teller>({ name: "TellBroadcast" })
      .tell({ key: String(id), at: new Date().toISOString() });
    await until(id, "sent");
    expect(sent.sort()).toEqual(["ann@firm.example", "bo@firm.example"]);
    const status = await ingress().objectClient<BroadcastObject>(BROADCAST, String(id)).status();
    expect(status).toMatchObject({ last: { sent: 2, skipped: 1, next: null } });
  });

  it("drops an older schedule for a newer one", async () => {
    const id = await approved();
    const tell = ingress().serviceClient<typeof teller>({ name: "TellBroadcast" });
    const obj = ingress().objectClient<BroadcastObject>(BROADCAST, String(id));
    // Ids restart per test, so the key's object may hold an earlier test's generation.
    const before = ((await obj.status()) as { gen: number }).gen;
    const later = new Date(Date.now() + 3_600_000).toISOString();
    await tell.tell({ key: String(id), at: later });
    await tell.tell({ key: String(id), at: new Date().toISOString() });
    await until(id, "sent");
    expect(sent).toHaveLength(2);
    expect(((await obj.status()) as { gen: number }).gen).toBe(before + 2);
  });
});
