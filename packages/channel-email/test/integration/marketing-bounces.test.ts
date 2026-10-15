/**
 * Marketing email bounces (designs/2026-10-14-customerio-audit.md) on Postgres, through fake Gmail
 * and Graph: a broadcast's hard bounce is matched by the Message-ID embedded in the report, a
 * workflow send's by References, one with neither by its Final-Recipient. A hard bounce puts the
 * address on do-not-contact and the sent log says Bounced; a soft one is kept only; a send with
 * no bounce counts as delivered once the mailbox is read 48 hours on. A client's bounce lands in
 * its own database, and a client mailbox connected to send only is skipped. Synthetic data only;
 * no network.
 */
import { readFileSync } from "node:fs";
import { BOUNCE_LATE_MS } from "@wren/core/bounces";
import {
  type BroadcastMail,
  decideBroadcast,
  dueRecipients,
  saveBroadcast,
  sendRecipient,
  startBroadcast,
} from "@wren/core/broadcasts";
import { addClient } from "@wren/core/clients";
import type { Mailbox } from "@wren/core/mailbox";
import { giveConsent, mayMarket, recordMarketingSend } from "@wren/core/marketing";
import { saveMessageSettings } from "@wren/core/message-settings";
import { resolveProfile } from "@wren/core/profiles";
import { topics } from "@wren/core/schema";
import { addMembers, saveSegment } from "@wren/core/segments";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { gmailMailbox, graphMailbox } from "../../src/access/mailbox.js";
import { BOUNCE_QUERY } from "../../src/inbox/marketing-bounces.js";
import { GONE, readAllBounces, SEND_ONLY } from "../../src/restate/bounce-scheduler.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
}, 240_000);
afterAll(() => pg?.stop());

const TABLES = [
  "mail_bounces",
  "mail_bounce_reads",
  "broadcast_recipients",
  "broadcasts",
  "segment_member_events",
  "segment_members",
  "segments",
  "marketing_sends",
  "message_settings",
  "suppression_events",
  "suppressions",
  "consent_events",
  "consents",
  "topics",
  "profile_events",
  "profile_trait_events",
  "profile_traits",
  "profile_keys",
  "profiles",
];
beforeEach(() => truncate(pg.db, TABLES));

type Row = Record<string, unknown>;
const run = async (db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Row[];
const HOUR = 3_600_000;
const NOW = new Date();
/** Three days ago: past the 48-hour mark once a read runs now. */
const SENT = new Date(NOW.getTime() - 72 * HOUR);
const BY = "owner@wren.example";

const FIXTURES = new URL("../fixtures/inbound/", import.meta.url);
/**
 * A fixture report, retold for one of our sends: its original Message-ID and failed address
 * swapped for ours.
 */
const report = (name: string, messageId: string, address: string, failed: string) =>
  readFileSync(new URL(`${name}.eml`, FIXTURES), "utf-8")
    .replaceAll("<abc@wren-automation.com>", messageId)
    .replaceAll(failed, address);
const everyday = `From: Lee <lee@example.com>
To: portal@wren.example
Subject: Quick question
Date: Mon, 12 Oct 2026 09:00:00 +0000
Message-ID: <q1@example.com>

Are you open Saturday?
`;

interface Held {
  raw: string;
  at: Date;
}
const header = (raw: string, name: string) =>
  new RegExp(`^${name}:\\s*(.*)$`, "im").exec(raw)?.[1]?.trim() ?? "";
const fromOf = (raw: string) => {
  const from = header(raw, "From");
  const m = /^(.*?)\s*<([^>]+)>$/.exec(from);
  return m ? { name: m[1] ?? "", address: m[2] ?? "" } : { name: "", address: from };
};

/** Gmail and Graph, holding these messages; every URL asked is kept. */
function fakeMail(box: Record<string, Held>) {
  const asked: string[] = [];
  const fetch = async (url: string): Promise<Response> => {
    asked.push(url);
    const u = new URL(url);
    if (u.host === "gmail.googleapis.com") {
      const id = /\/messages\/([^/?]+)/.exec(u.pathname)?.[1];
      if (!id) return Response.json({ messages: Object.keys(box).map((k) => ({ id: k })) });
      const m = box[decodeURIComponent(id)];
      if (!m) return Response.json({ error: { message: "Not Found" } }, { status: 404 });
      if (u.searchParams.get("format") === "raw")
        return Response.json({ raw: Buffer.from(m.raw).toString("base64url") });
      return Response.json({
        id,
        threadId: id,
        internalDate: String(m.at.getTime()),
        payload: {
          headers: [
            { name: "From", value: header(m.raw, "From") },
            { name: "Subject", value: header(m.raw, "Subject") },
          ],
        },
      });
    }
    const id = /\/me\/messages\/([^/?]+)/.exec(u.pathname)?.[1];
    if (!id) return Response.json({ value: Object.keys(box).map((k) => ({ id: k })) });
    const m = box[decodeURIComponent(id)];
    if (!m) return Response.json({ error: { message: "Not Found" } }, { status: 404 });
    if (u.pathname.endsWith("/$value")) return new Response(m.raw);
    const from = fromOf(m.raw);
    return Response.json({
      id,
      conversationId: id,
      subject: header(m.raw, "Subject"),
      receivedDateTime: m.at.toISOString(),
      from: { emailAddress: from },
    });
  };
  const token = async () => "token";
  return {
    asked,
    gmail: (address: string): Mailbox => gmailMailbox(fetch, address, token),
    graph: (address: string): Mailbox => graphMailbox(fetch, address, token),
  };
}

/** One email broadcast to these addresses, sent at `SENT`: each address's Message-ID as mailed. */
async function broadcastTo(db: Db, addresses: string[]): Promise<Map<string, string>> {
  const before = new Date(SENT.getTime() - 24 * HOUR);
  await db
    .insert(topics)
    .values({
      name: "news",
      publicName: "Monthly news",
      line: "What's new, once a month",
      channel: "email",
      cadence: "monthly",
      public: true,
    })
    .onConflictDoNothing();
  const people: number[] = [];
  for (const address of addresses) {
    const p = await resolveProfile(db, [{ kind: "email", value: address }], "test", {
      name: address,
      at: before,
    });
    people.push(p?.id as number);
    await giveConsent(db, {
      channel: "email",
      address,
      topic: "news",
      source: "lander_form",
      textVersion: "v1",
      evidence: { form: "https://example.test/signup" },
      by: "subscriber",
      now: before,
    });
  }
  const { segment } = await saveSegment(db, { name: "Test people", kind: "manual" }, BY, before);
  await addMembers(db, segment.id, people, before);
  const b = await saveBroadcast(
    db,
    {
      name: "October news",
      channel: "email",
      segmentId: segment.id,
      topic: "news",
      subject: "News",
      body: "Hello.",
      ask: true,
    },
    BY,
    before,
  );
  await decideBroadcast(db, b.id, true, BY, SENT);
  await startBroadcast(db, b.id, SENT);
  const mailed = new Map<string, string>();
  const mail: BroadcastMail = {
    domain: "wren.example",
    daily: 1500,
    envelope: () => ({ footer: "", headers: [] }),
    send: async (m) => {
      mailed.set(m.to, m.messageId);
    },
  };
  for (const r of await dueRecipients(db, b.id, SENT, 100))
    await sendRecipient(db, r, { mail, now: SENT });
  return mailed;
}

const stateOf = async (db: Db, address: string) =>
  (await run(db, sql`select state from sent_records where to_address = ${address}`))[0]?.state;
const historyOf = async (db: Db, address: string) =>
  (
    await run(
      db,
      sql`select a.kind, a.what from sent_activity a
        join sent_records r on r.id = a.message where r.to_address = ${address}
        order by a.at, a.seq`,
    )
  ).map((a) => [a.kind, a.what]);
const suppressed = (db: Db) =>
  run(
    db,
    sql`select s.value, s.reason, e.evidence from suppressions s
      join suppression_events e on e.suppression_id = s.id order by s.value, e.id`,
  );

const wrenOnly = (wren: Mailbox) => ({
  db: pg.db,
  wren,
  clientDb: () => {
    throw new Error("no clients here");
  },
  clients: async () => [],
  boxesOf: async () => [],
});

describe("a broadcast's bounce, read from Gmail", () => {
  it("matches by the embedded Message-ID: do-not-contact, Bounced; the rest delivered", async () => {
    const mailed = await broadcastTo(pg.db, ["dead@firm.example", "ok@firm.example"]);
    const id = mailed.get("dead@firm.example") as string;
    expect(id).toMatch(/^<[0-9a-f-]{36}@wren\.example>$/);
    // The Message-ID is kept with the send before it goes.
    expect(
      await run(pg.db, sql`select address, message_id from broadcast_recipients order by address`),
    ).toEqual([
      { address: "dead@firm.example", message_id: id },
      { address: "ok@firm.example", message_id: mailed.get("ok@firm.example") },
    ]);
    // Three days on but never read: neither claims delivered.
    expect(await stateOf(pg.db, "ok@firm.example")).toBe("sent");

    const fake = fakeMail({
      g1: {
        raw: report("gmail_dsn_hard", id, "dead@firm.example", "nobody@example.com"),
        at: new Date(SENT.getTime() + 60_000),
      },
      g2: { raw: everyday, at: new Date(SENT.getTime() + HOUR) },
    });
    const pass = await readAllBounces(wrenOnly(fake.gmail("portal@wren.example")), NOW);
    expect(pass.read.wren).toMatchObject({ listed: 2, suppressed: 1, other: 1, errors: 0 });
    const q = new URL(fake.asked[0] as string).searchParams.get("q") ?? "";
    expect(q).toBe(`after:${Math.floor((NOW.getTime() - 7 * 24 * HOUR) / 1000)} ${BOUNCE_QUERY}`);
    // The everyday message is passed over on its sender and subject: never fetched whole.
    expect(fake.asked.some((u) => u.includes("/messages/g2?format=raw"))).toBe(false);

    const [s] = await suppressed(pg.db);
    expect(s).toMatchObject({ value: "dead@firm.example", reason: "bounce" });
    expect(s?.evidence).toMatchObject({
      status: "5.1.1",
      mailbox: "portal@wren.example",
      message_id: id,
    });
    expect(String((s?.evidence as Row | undefined)?.diagnostic)).toContain("550-5.1.1");
    expect(
      await mayMarket(pg.db, { channel: "email", address: "dead@firm.example", topic: "news" }),
    ).toMatchObject({ send: false, why: "suppressed" });
    expect(
      await run(pg.db, sql`select class, matched_by, status, message_id from mail_bounces`),
    ).toEqual([{ class: "hard", matched_by: "message_id", status: "5.1.1", message_id: id }]);

    expect(await stateOf(pg.db, "dead@firm.example")).toBe("bounced");
    expect(await stateOf(pg.db, "ok@firm.example")).toBe("delivered");
    const dead = await historyOf(pg.db, "dead@firm.example");
    expect(dead.find(([k]) => k === "bounce")?.[1]).toMatch(
      /^Bounced \(5\.1\.1\): .*550-5\.1\.1.*\. On the do-not-contact list now$/,
    );
    expect(dead.some(([k]) => k === "delivered")).toBe(false);
    expect(await historyOf(pg.db, "ok@firm.example")).toContainEqual([
      "delivered",
      "Counted as delivered: no bounce in 48 hours",
    ]);

    // A second read keeps nothing twice and fetches nothing again.
    fake.asked.length = 0;
    const again = await readAllBounces(wrenOnly(fake.gmail("portal@wren.example")), NOW);
    expect(again.read.wren).toMatchObject({ listed: 2, kept: 1, suppressed: 0 });
    expect(fake.asked.some((u) => u.includes("/messages/g1"))).toBe(false);
    expect(await suppressed(pg.db)).toHaveLength(1);
  });

  it("with no Message-ID it knows, matches by the report's address", async () => {
    await broadcastTo(pg.db, ["gone@firm.example"]);
    const fake = fakeMail({
      g1: {
        raw: report(
          "gmail_dsn_hard",
          "<other@elsewhere.example>",
          "gone@firm.example",
          "nobody@example.com",
        ),
        at: new Date(SENT.getTime() + 60_000),
      },
    });
    const pass = await readAllBounces(wrenOnly(fake.gmail("portal@wren.example")), NOW);
    expect(pass.read.wren).toMatchObject({ suppressed: 1 });
    expect(await run(pg.db, sql`select matched_by from mail_bounces`)).toEqual([
      { matched_by: "address" },
    ]);
    expect(await stateOf(pg.db, "gone@firm.example")).toBe("bounced");
  });

  it("a soft bounce is recorded only: the address stays", async () => {
    const mailed = await broadcastTo(pg.db, ["slow@firm.example"]);
    const fake = fakeMail({
      g1: {
        raw: report(
          "gmail_dsn_delayed",
          mailed.get("slow@firm.example") as string,
          "slow@firm.example",
          "slow@example.net",
        ),
        at: new Date(SENT.getTime() + HOUR),
      },
    });
    const pass = await readAllBounces(wrenOnly(fake.gmail("portal@wren.example")), NOW);
    expect(pass.read.wren).toMatchObject({ soft: 1, suppressed: 0 });
    expect(await suppressed(pg.db)).toEqual([]);
    expect(await run(pg.db, sql`select class, suppression_id from mail_bounces`)).toEqual([
      { class: "soft", suppression_id: null },
    ]);
    expect(await stateOf(pg.db, "slow@firm.example")).not.toBe("bounced");
    expect((await historyOf(pg.db, "slow@firm.example")).find(([k]) => k === "note")?.[1]).toMatch(
      /^Soft bounce \(4\.4\.1\): .*\. Recorded only: the address stays$/,
    );
  });
});

describe("a workflow send's bounce, read from Graph", () => {
  it("matches by References: do-not-contact, Bounced", async () => {
    await pg.db.insert(topics).values({
      name: "news",
      publicName: "Monthly news",
      line: "What's new",
      channel: "email",
      cadence: "monthly",
      public: true,
    });
    const consent = await giveConsent(pg.db, {
      channel: "email",
      address: "nope@firm.example",
      topic: "news",
      source: "lander_form",
      textVersion: "v1",
      evidence: { form: "https://example.test/signup" },
      by: "subscriber",
      now: new Date(SENT.getTime() - 24 * HOUR),
    });
    const id = "<0f6c1a52-3b1e-4d0e-9a8a-1b2c3d4e5f60@wren.example>";
    await recordMarketingSend(pg.db, {
      consentId: consent.id,
      by: "workflow:7",
      evidence: { workflow: 7, step: "s1" },
      campaign: "7",
      now: SENT,
      messageId: id,
    });
    const fake = fakeMail({
      m1: {
        raw: report("microsoft_ndr", id, "nope@firm.example", "nobody@example.com"),
        at: new Date(SENT.getTime() + 60_000),
      },
    });
    const pass = await readAllBounces(wrenOnly(fake.graph("portal@wren.example")), NOW);
    expect(pass.read.wren).toMatchObject({ listed: 1, suppressed: 1 });
    expect(fake.asked[0]).toContain(
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages",
    );
    expect(
      await run(
        pg.db,
        sql`select class, matched_by, status, consent_event_id is not null ev from mail_bounces`,
      ),
    ).toEqual([{ class: "hard", matched_by: "message_id", status: "5.1.10", ev: true }]);
    expect(await suppressed(pg.db)).toMatchObject([
      { value: "nope@firm.example", reason: "bounce" },
    ]);
    expect(await stateOf(pg.db, "nope@firm.example")).toBe("bounced");
  });
});

describe("clients' mailboxes", () => {
  it("a client's bounce lands in its own database; a send-only mailbox is skipped", async () => {
    await addClient(pg.db, pg.url, { id: "acme", name: "Acme", products: {} });
    await addClient(pg.db, pg.url, { id: "beta", name: "Beta", products: {} });
    const open = (client: string) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${client}`));
    const acme = open("acme");
    await saveMessageSettings(acme, { sender: "ann@acme.example" }, BY);
    await saveMessageSettings(open("beta"), { sender: "bo@beta.example" }, BY);
    const mailed = await broadcastTo(acme, ["lost@patient.example"]);
    const fake = fakeMail({
      g1: {
        raw: report(
          "gmail_dsn_hard",
          mailed.get("lost@patient.example") as string,
          "lost@patient.example",
          "nobody@example.com",
        ),
        at: new Date(SENT.getTime() + 60_000),
      },
    });
    const pass = await readAllBounces(
      {
        db: pg.db,
        wren: null,
        clientDb: open,
        clients: async () => ["acme", "beta"],
        // Beta's mailbox is connected to send only: it has none to read.
        boxesOf: async (client) => (client === "acme" ? [fake.gmail("ann@acme.example")] : []),
      },
      NOW,
    );
    expect(pass.read.acme).toMatchObject({ mailbox: "ann@acme.example", suppressed: 1 });
    expect(pass.skipped).toEqual([{ client: "beta", mailbox: "bo@beta.example", why: SEND_ONLY }]);
    expect(pass.failed).toEqual([]);
    expect(await suppressed(acme)).toMatchObject([
      { value: "lost@patient.example", reason: "bounce" },
    ]);
    expect(await stateOf(acme, "lost@patient.example")).toBe("bounced");
    // Nothing of it in main, nor in the other client.
    expect(await suppressed(pg.db)).toEqual([]);
    expect(await run(pg.db, sql`select id from mail_bounces`)).toEqual([]);
    expect(await run(open("beta"), sql`select id from mail_bounces`)).toEqual([]);
    expect(await run(open("beta"), sql`select mailbox from mail_bounce_reads`)).toEqual([]);
  });

  /** A fresh client with this sender picked, and a pass over just it with these mailboxes connected. */
  async function clientWith(id: string, sender: string) {
    await addClient(pg.db, pg.url, { id, name: id, products: {} });
    const cdb = cachedDb(clientDatabaseUrl(pg.url, `wren_client_${id}`));
    await saveMessageSettings(cdb, { sender }, BY);
    const pass = (boxes: Mailbox[], at: Date) =>
      readAllBounces(
        {
          db: pg.db,
          wren: null,
          clientDb: () => cdb,
          clients: async () => [id],
          boxesOf: async () => boxes,
        },
        at,
      );
    return { cdb, pass };
  }

  it("after a client changes sender, a late bounce to the old mailbox is still read", async () => {
    const { cdb, pass } = await clientWith("cove", "ann@cove.example");
    const mailed = await broadcastTo(cdb, ["lost@patient.example"]);
    const quiet = fakeMail({});
    // Ann is the sender and nothing has come back yet.
    expect((await pass([quiet.gmail("ann@cove.example")], NOW)).read.cove).toMatchObject({
      mailbox: "ann@cove.example",
      listed: 0,
    });
    // The client picks Cy. Ann's mailbox, still connected, gets the late report.
    await saveMessageSettings(cdb, { sender: "cy@cove.example" }, BY);
    const late = fakeMail({
      g1: {
        raw: report(
          "gmail_dsn_hard",
          mailed.get("lost@patient.example") as string,
          "lost@patient.example",
          "nobody@example.com",
        ),
        at: new Date(NOW.getTime() + HOUR),
      },
    });
    const done = await pass(
      [quiet.gmail("cy@cove.example"), late.gmail("ann@cove.example")],
      new Date(NOW.getTime() + 2 * HOUR),
    );
    expect(done.read.cove).toMatchObject({ mailbox: "cy@cove.example", listed: 0 });
    expect(done.earlier).toMatchObject([
      { client: "cove", mailbox: "ann@cove.example", suppressed: 1 },
    ]);
    expect(done.failed).toEqual([]);
    expect(await suppressed(cdb)).toMatchObject([
      { value: "lost@patient.example", reason: "bounce" },
    ]);
    expect(await stateOf(cdb, "lost@patient.example")).toBe("bounced");
    // Each mailbox keeps its own check, in the workspace's own database.
    expect(
      await run(
        cdb,
        sql`select mailbox, read_at is not null as read from mail_bounce_reads order by mailbox`,
      ),
    ).toEqual([
      { mailbox: "ann@cove.example", read: true },
      { mailbox: "cy@cove.example", read: true },
    ]);
  });

  it("an earlier sender is read for the late window, then dropped", async () => {
    const { cdb, pass } = await clientWith("dune", "ann@dune.example");
    // The change itself notes Ann as an earlier sender: no pass saw her first.
    await saveMessageSettings(cdb, { sender: "cy@dune.example" }, BY);
    const quiet = fakeMail({});
    const boxes = [quiet.gmail("cy@dune.example"), quiet.gmail("ann@dune.example")];
    const inside = await pass(boxes, new Date(Date.now() + BOUNCE_LATE_MS - HOUR));
    expect(inside.earlier.map((e) => e.mailbox)).toEqual(["ann@dune.example"]);
    const past = await pass(boxes, new Date(Date.now() + BOUNCE_LATE_MS + HOUR));
    expect(past.earlier).toEqual([]);
    expect(past.read.dune).toMatchObject({ mailbox: "cy@dune.example" });
  });

  it("an earlier sender that is no longer connected is skipped, not failed", async () => {
    const { cdb, pass } = await clientWith("edge", "ann@edge.example");
    await saveMessageSettings(cdb, { sender: "cy@edge.example" }, BY);
    const done = await pass([fakeMail({}).gmail("cy@edge.example")], new Date());
    expect(done.skipped).toEqual([{ client: "edge", mailbox: "ann@edge.example", why: GONE }]);
    expect(done.failed).toEqual([]);
    expect(done.read.edge).toMatchObject({ mailbox: "cy@edge.example" });
  });
});
