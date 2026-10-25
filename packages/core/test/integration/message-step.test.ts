/**
 * Send message on the executor: one person's broadcast. A yes to the topic sends once, however often
 * the step runs; no yes leaves by skipped with why. A client's workflow runs in the client's own
 * database and sends through its own mailer, under the same rules. Synthetic.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BroadcastMail, MailUnset } from "../../src/broadcasts.js";
import type { ExecutorEvent, StepAt } from "../../src/executor.js";
import { giveConsent, withdrawConsent } from "../../src/marketing.js";
import { messageStep } from "../../src/message-step.js";
import { topics } from "../../src/schema.js";
import { addSuppression } from "../../src/suppress.js";

type Mail = BroadcastMail & { sent: { to: string; subject: string; text: string }[] };

let pg: TestPostgres;
/** The client "acme"'s own database. */
let cpg: TestPostgres;
let down = false;

/** A fake mailer: what it was asked to send. */
function fakeMail(domain: string, daily: number): Mail {
  const sent: Mail["sent"] = [];
  return {
    sent,
    domain,
    daily,
    envelope: () => ({ footer: "\n\n--\nUnsubscribe: https://example.test/u", headers: [] }),
    send: async (m) => {
      if (down) throw new Error("smtp down");
      sent.push(m);
    },
  };
}
const mail = fakeMail("wren.example", 1500);
const theirMail = fakeMail("acme.example", 400);

/** Where each workflow's mailer was asked for, and the database it was given. */
const asked: { client: string | null; db: unknown }[] = [];
/** What the client's mailer is now: set up, or why not. */
let theirs: BroadcastMail | MailUnset = theirMail;

/** The step as the worker wires it: Wren's mailer for Wren, `theirs` for the client "acme". */
const stepOf = () =>
  messageStep(pg.db, {
    mail: async (client, db) => {
      asked.push({ client, db });
      return client ? theirs : mail;
    },
    open: (client) => {
      if (client !== "acme") throw new Error(`no database for ${client}`);
      return cpg.db;
    },
  });

beforeAll(async () => {
  [pg, cpg] = await Promise.all([startTestPostgres(), startTestPostgres()]);
});
afterAll(async () => {
  await Promise.all([pg?.stop(), cpg?.stop()]);
});
beforeEach(async () => {
  mail.sent.length = 0;
  theirMail.sent.length = 0;
  asked.length = 0;
  down = false;
  theirs = theirMail;
  for (const db of [pg.db, cpg.db]) {
    await truncate(db, [
      "sms_messages",
      "sms_contacts",
      "sms_numbers",
      "marketing_sends",
      "suppression_events",
      "suppressions",
      "consent_events",
      "consents",
      "topics",
    ]);
    await db.insert(topics).values([
      {
        name: "news",
        publicName: "Monthly news",
        line: "What's new, once a month",
        channel: "email",
        cadence: "monthly",
        public: true,
      },
      {
        name: "texts",
        publicName: "Text alerts",
        line: "A heads-up before each event",
        channel: "sms",
        cadence: "monthly",
        public: true,
      },
    ]);
  }
});

const lead = (email: string): ExecutorEvent => ({
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
const yes = (email: string, db: TestPostgres["db"] = pg.db) =>
  giveConsent(db, {
    channel: "email",
    address: email,
    topic: "news",
    source: "lander_form",
    textVersion: "v1",
    evidence: { form: "https://example.test/signup" },
    by: "subscriber",
  });
type Row = Record<string, unknown>;
const rows = async (db: TestPostgres["db"], q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as Row[];
const sentEvents = (db: TestPostgres["db"]) =>
  rows(db, sql`select message_id from consent_events where kind = 'sent'`);

describe("Send message", () => {
  it("sends once to a yes, with the footer, however often it runs", async () => {
    await yes("sam@example.com");
    const step = stepOf();
    const out = await step("in", lead("sam@example.com"), at());
    expect(out[0]?.port).toBe("sent");
    expect(out[0]?.event.data.message).toEqual({ channel: "email", to: "sam@example.com" });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.subject).toBe("Hi Sam");
    expect(mail.sent[0]?.text).toContain("Unsubscribe");
    const again = await step("in", lead("sam@example.com"), at());
    expect(again[0]?.port).toBe("sent");
    expect(mail.sent).toHaveLength(1);
  });

  it("skips without a yes", async () => {
    const step = stepOf();
    const none = await step("in", lead("pat@example.com"), at());
    expect(none[0]).toMatchObject({ port: "skipped" });
    expect(none[0]?.event.data.skipped).toBe("Never said yes to this topic");
    expect(mail.sent).toHaveLength(0);
  });

  it("refuses a topic that doesn't exist", async () => {
    const step = stepOf();
    await expect(step("in", lead("sam@example.com"), at({ topic: "nope" }))).rejects.toThrow(
      /no email topic called nope/,
    );
  });

  it("a failed send takes its claim back, so the retry sends", async () => {
    await yes("sam@example.com");
    const step = stepOf();
    down = true;
    await expect(step("in", lead("sam@example.com"), at())).rejects.toThrow(/smtp down/);
    const kept = (await pg.db.execute(
      sql`select count(*)::int as n from consent_events where kind = 'sent'`,
    )) as unknown as { n: number }[];
    expect(kept[0]?.n).toBe(0);
    down = false;
    expect((await step("in", lead("sam@example.com"), at()))[0]?.port).toBe("sent");
    expect(mail.sent).toHaveLength(1);
  });
});

describe("Send message in a client's workspace", () => {
  const acme = (w: Partial<StepAt["with"]> = {}) => at(w, "acme");

  it("sends from the client's own mailer, on the client's list, once", async () => {
    await yes("sam@example.com", cpg.db);
    const step = stepOf();
    const out = await step("in", lead("sam@example.com"), acme());
    expect(out[0]?.port).toBe("sent");
    expect(theirMail.sent).toHaveLength(1);
    expect(theirMail.sent[0]?.subject).toBe("Hi Sam");
    expect(theirMail.sent[0]?.text).toContain("Unsubscribe");
    expect(mail.sent).toHaveLength(0);
    // The mailer was asked for the client's, with the client's database.
    expect(asked).toEqual([{ client: "acme", db: cpg.db }]);
    // The send is kept in the client's database with its Message-ID, for a bounce to find.
    const kept = await sentEvents(cpg.db);
    expect(kept).toHaveLength(1);
    expect(String(kept[0]?.message_id)).toMatch(/^<[0-9a-f-]+@acme\.example>$/);
    expect(await sentEvents(pg.db)).toHaveLength(0);
    const again = await step("in", lead("sam@example.com"), acme());
    expect(again[0]?.port).toBe("sent");
    expect(theirMail.sent).toHaveLength(1);
  });

  it("a yes on Wren's list is no yes on the client's", async () => {
    await yes("sam@example.com");
    const out = await stepOf()("in", lead("sam@example.com"), acme());
    expect(out[0]).toMatchObject({ port: "skipped" });
    expect(out[0]?.event.data.skipped).toBe("Never said yes to this topic");
    expect(theirMail.sent).toHaveLength(0);
    expect(mail.sent).toHaveLength(0);
  });

  it("keeps the broadcast rules: a taken-back yes and a bounce are skipped", async () => {
    await yes("sam@example.com", cpg.db);
    await withdrawConsent(cpg.db, {
      channel: "email",
      address: "sam@example.com",
      topic: "news",
      by: "subscriber",
    });
    await yes("pat@example.com", cpg.db);
    await addSuppression(cpg.db, {
      kind: "email",
      value: "pat@example.com",
      reason: "bounce",
      evidence: { status: "5.1.1" },
    });
    const step = stepOf();
    const sam = await step("in", lead("sam@example.com"), acme());
    expect(sam[0]?.event.data.skipped).toBe("Took back their yes");
    const pat = await step("in", lead("pat@example.com"), acme());
    expect(pat[0]?.event.data.skipped).toBe("On the do-not-contact list");
    expect(theirMail.sent).toHaveLength(0);
    expect(await sentEvents(cpg.db)).toHaveLength(0);
  });

  it("a client with no mailer yet fails the step with why, and the retry sends", async () => {
    theirs = { unset: "Needs setup: pick the mailbox it sends from in Account → Messaging" };
    await yes("sam@example.com", cpg.db);
    const step = stepOf();
    await expect(step("in", lead("sam@example.com"), acme())).rejects.toThrow(
      /Send message: Needs setup: pick the mailbox/,
    );
    // Someone with no yes is skipped as ever, not failed on the mailer.
    const none = await step("in", lead("pat@example.com"), acme());
    expect(none[0]?.event.data.skipped).toBe("Never said yes to this topic");
    expect(await sentEvents(cpg.db)).toHaveLength(0);
    theirs = theirMail;
    expect((await step("in", lead("sam@example.com"), acme()))[0]?.port).toBe("sent");
    expect(theirMail.sent).toHaveLength(1);
  });

  it("a failed send takes its claim back from the client's database", async () => {
    await yes("sam@example.com", cpg.db);
    const step = stepOf();
    down = true;
    await expect(step("in", lead("sam@example.com"), acme())).rejects.toThrow(/smtp down/);
    expect(await sentEvents(cpg.db)).toHaveLength(0);
    down = false;
    expect((await step("in", lead("sam@example.com"), acme()))[0]?.port).toBe("sent");
    expect(theirMail.sent).toHaveLength(1);
  });

  it("queues a text on the client's own thread", async () => {
    const [num] = await rows(
      cpg.db,
      sql`insert into sms_numbers (e164, provider, ramp_started_on)
        values ('+15555550000', 'test', '2026-09-01') returning id`,
    );
    await cpg.db.execute(sql`insert into sms_contacts (e164, source_kind, basis, number_id, state)
      values ('+15555550101', 'manual', 'opt_in', ${num?.id as string}::uuid, 'new')`);
    await giveConsent(cpg.db, {
      channel: "sms",
      address: "+15555550101",
      topic: "texts",
      source: "lander_form",
      textVersion: "v1",
      evidence: { form: "https://example.test/signup" },
      by: "subscriber",
    });
    const e: ExecutorEvent = {
      subject: "lead:door:+15555550101",
      kind: "lead",
      data: { lead: { name: "Sam Test", phone: "+15555550101" } },
    };
    const out = await stepOf()(
      "in",
      e,
      acme({ channel: "sms", topic: "texts", subject: "", body: "Doors open at 6. Reply STOP." }),
    );
    expect(out[0]?.port).toBe("sent");
    const queued = await rows(
      cpg.db,
      sql`select kind, state, to_e164 from sms_messages where direction = 'out'`,
    );
    expect(queued).toEqual([{ kind: "broadcast", state: "queued", to_e164: "+15555550101" }]);
    expect(await rows(pg.db, sql`select 1 from sms_messages`)).toHaveLength(0);
    expect(asked).toEqual([]);
  });
});
