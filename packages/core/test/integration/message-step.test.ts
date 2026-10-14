/**
 * Send message on the spine: one person's broadcast. A yes to the topic sends once, however often
 * the step runs; no yes or a client's workflow leaves by skipped with why. Synthetic.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BroadcastMail } from "../../src/broadcasts.js";
import { giveConsent } from "../../src/marketing.js";
import { messageStep } from "../../src/message-step.js";
import { topics } from "../../src/schema.js";
import type { SpineEvent, StepAt } from "../../src/spine.js";

let pg: TestPostgres;
const sent: { to: string; subject: string; text: string }[] = [];
let down = false;
const mail: BroadcastMail = {
  domain: "wren.example",
  envelope: () => ({ footer: "\n\n--\nUnsubscribe: https://example.test/u", headers: [] }),
  send: async (m) => {
    if (down) throw new Error("smtp down");
    sent.push(m);
  },
};

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  sent.length = 0;
  down = false;
  await truncate(pg.db, ["marketing_sends", "consent_events", "consents", "topics"]);
  await pg.db.insert(topics).values({
    name: "news",
    publicName: "Monthly news",
    line: "What's new, once a month",
    channel: "email",
    cadence: "monthly",
    public: true,
  });
});

const lead = (email: string): SpineEvent => ({
  subject: `lead:door:${email}`,
  kind: "lead",
  data: { lead: { name: "Sam Test", email } },
});
const at = (w: Partial<StepAt["with"]> = {}, client: string | null = null): StepAt => ({
  client,
  workflow: "made.welcome",
  node: "send",
  with: {
    channel: "email",
    topic: "news",
    subject: "Hi {first_name|there}",
    body: "Welcome.",
    ...w,
  },
});
const yes = (email: string) =>
  giveConsent(pg.db, {
    channel: "email",
    address: email,
    topic: "news",
    source: "lander_form",
    textVersion: "v1",
    evidence: { form: "https://example.test/signup" },
    by: "subscriber",
  });

describe("Send message", () => {
  it("sends once to a yes, with the footer, however often it runs", async () => {
    await yes("sam@example.com");
    const step = messageStep(pg.db, { mail });
    const out = await step("in", lead("sam@example.com"), at());
    expect(out[0]?.port).toBe("sent");
    expect(out[0]?.event.data.message).toEqual({ channel: "email", to: "sam@example.com" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe("Hi Sam");
    expect(sent[0]?.text).toContain("Unsubscribe");
    const again = await step("in", lead("sam@example.com"), at());
    expect(again[0]?.port).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("skips without a yes, and on a client's workflow", async () => {
    const step = messageStep(pg.db, { mail });
    const none = await step("in", lead("pat@example.com"), at());
    expect(none[0]).toMatchObject({ port: "skipped" });
    expect(none[0]?.event.data.skipped).toBe("Never said yes to this topic");
    const theirs = await step("in", lead("pat@example.com"), at({}, "acme"));
    expect(theirs[0]?.event.data.skipped).toMatch(/Wren's own/);
    expect(sent).toHaveLength(0);
  });

  it("refuses a topic that doesn't exist", async () => {
    const step = messageStep(pg.db, { mail });
    await expect(step("in", lead("sam@example.com"), at({ topic: "nope" }))).rejects.toThrow(
      /no email topic called nope/,
    );
  });

  it("a failed send takes its claim back, so the retry sends", async () => {
    await yes("sam@example.com");
    const step = messageStep(pg.db, { mail });
    down = true;
    await expect(step("in", lead("sam@example.com"), at())).rejects.toThrow(/smtp down/);
    const kept = (await pg.db.execute(
      sql`select count(*)::int as n from consent_events where kind = 'sent'`,
    )) as unknown as { n: number }[];
    expect(kept[0]?.n).toBe(0);
    down = false;
    expect((await step("in", lead("sam@example.com"), at()))[0]?.port).toBe("sent");
    expect(sent).toHaveLength(1);
  });
});
