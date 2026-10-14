/**
 * Broadcasts (B6) on a real database: save, ask, the approver's yes, the start that reads the
 * segment, each person gated by consent, suppressions and the cap (held until it lifts), an email
 * through a fake mailer, a text handed to the texts sender, cancel and restore, local time, and
 * results on the sent log. Synthetic rows; every time is fixed.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { broadcastDetail } from "../../src/broadcast-records.js";
import {
  askBroadcast,
  type BroadcastMail,
  broadcastById,
  broadcastMonth,
  broadcastResults,
  broadcastUses,
  cancelBroadcast,
  decideBroadcast,
  dueRecipients,
  nextOrFinish,
  previewBroadcast,
  restoreBroadcast,
  saveBroadcast,
  sendRecipient,
  startBroadcast,
  waitingBroadcasts,
} from "../../src/broadcasts.js";
import { askConsent, giveConsent } from "../../src/marketing.js";
import { recordMessageSend, saveMessageSettings } from "../../src/message-settings.js";
import { resolveProfile, setTraits } from "../../src/profiles.js";
import { topics } from "../../src/schema.js";
import { addMembers, saveSegment } from "../../src/segments.js";
import { addSuppression } from "../../src/suppress.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

type Row = Record<string, unknown>;
const run = async (q: ReturnType<typeof sql>) => (await pg.db.execute(q)) as unknown as Row[];
const HOUR = 3_600_000;
/** October 2026, by day, noon UTC. */
const T = (day: number, hour = 12) => new Date(Date.UTC(2026, 9, day, hour));
const NOW = T(14);
const BY = "owner@wren.example";

beforeEach(async () => {
  await truncate(pg.db, [
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
    "sms_messages",
    "sms_contacts",
    "sms_numbers",
    "profile_events",
    "profile_trait_events",
    "profile_traits",
    "profile_keys",
    "profiles",
  ]);
  await pg.db.insert(topics).values([
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
});

/** A fake mailer: what it was asked to send. */
function fakeMail(
  fail?: string,
): BroadcastMail & { sent: { to: string; subject: string; text: string }[] } {
  const sent: { to: string; subject: string; text: string }[] = [];
  return {
    sent,
    domain: "wren.example",
    envelope: (address, topic) => ({
      footer: `\n\n--\nYou get ${topic.publicName}. Unsubscribe: https://example.test/u/${address}`,
      headers: [["List-Unsubscribe", `<https://example.test/u/${address}>`]],
    }),
    send: async (m) => {
      if (fail && m.to === fail) throw new Error("mailbox full");
      sent.push(m);
    },
  };
}

async function person(name: string, keys: { email?: string; phone?: string }): Promise<number> {
  const got = await resolveProfile(
    pg.db,
    [
      ...(keys.email ? [{ kind: "email", value: keys.email }] : []),
      ...(keys.phone ? [{ kind: "phone", value: keys.phone }] : []),
    ],
    "test",
    { name, at: T(1) },
  );
  return got?.id as number;
}

const sign = (channel: "email" | "sms", address: string, topic: string) =>
  giveConsent(pg.db, {
    channel,
    address,
    topic,
    source: "lander_form",
    textVersion: "v1",
    evidence: { form: "https://example.test/signup" },
    by: "subscriber",
    now: T(1),
  });

/** A manual segment of these people. */
async function segmentOf(ids: number[]): Promise<number> {
  const { segment } = await saveSegment(pg.db, { name: "Test people", kind: "manual" }, BY, T(2));
  await addMembers(pg.db, segment.id, ids, T(2));
  return segment.id;
}

/** Every due person sent once, as a run does. */
async function sendDue(id: number, mail: BroadcastMail | null, now = NOW) {
  const out: Record<string, string> = {};
  for (const r of await dueRecipients(pg.db, id, now, 100)) {
    const got = await sendRecipient(pg.db, r, { mail, now });
    out[r] = got.state;
  }
  return out;
}

const recipients = (id: number) =>
  run(sql`select p.name, r.state, r.why, r.due_at, r.address from broadcast_recipients r
    join profiles p on p.id = r.profile_id where r.broadcast_id = ${id} order by p.name`);

describe("an email broadcast", () => {
  it("waits for the yes, then sends to each person past consent, suppressions and the cap", async () => {
    const ann = await person("Ann Lee", { email: "ann@firm.example" });
    const bo = await person("Bo", { email: "bo@firm.example" });
    const cy = await person("Cy", { email: "cy@firm.example" });
    const di = await person("Di", { email: "di@firm.example" });
    const ed = await person("Ed", { phone: "+15555550105" });
    const fay = await person("Fay", { email: "fay@firm.example" });
    await sign("email", "ann@firm.example", "news");
    await askConsent(pg.db, {
      channel: "email",
      address: "bo@firm.example",
      topic: "news",
      source: "lander_form",
      textVersion: "v1",
      evidence: { form: "https://example.test/signup" },
      by: "lander:form",
      now: T(1),
    });
    await sign("email", "cy@firm.example", "news");
    await addSuppression(pg.db, { kind: "email", value: "cy@firm.example", reason: "opt_out" });
    await sign("email", "fay@firm.example", "news");
    // Fay is at the workspace's cap: one a day, and she had a DM an hour ago.
    await saveMessageSettings(pg.db, { capPerDay: 1 }, BY);
    await recordMessageSend(pg.db, {
      personKey: `profile:${fay}`,
      channel: "dm",
      now: new Date(NOW.getTime() - HOUR),
    });
    const segmentId = await segmentOf([ann, bo, cy, di, ed, fay]);

    const preview = await previewBroadcast(pg.db, {
      channel: "email",
      segmentId,
      topic: "news",
      subject: "News for {first_name|you}",
      body: "Hi {first_name|there}, see https://example.test/news",
    });
    expect(preview).toMatchObject({ subject: "News for Sam", people: 6, yes: 3 });

    const b = await saveBroadcast(
      pg.db,
      {
        name: "October news",
        channel: "email",
        segmentId,
        topic: "news",
        subject: "News for {first_name|you}",
        body: "Hi {first_name|there}, see https://example.test/news",
      },
      BY,
      T(10),
    );
    expect(b.state).toBe("draft");
    expect((await broadcastUses(pg.db)).get(segmentId)?.map((u) => u.name)).toEqual([
      "October news",
    ]);
    // Nothing starts without the yes.
    expect(await startBroadcast(pg.db, b.id, NOW)).toBe(0);
    await expect(decideBroadcast(pg.db, b.id, true, BY, NOW)).rejects.toThrow(/isn't waiting/);
    await askBroadcast(pg.db, b.id, BY, T(11));
    expect((await waitingBroadcasts(pg.db)).map((w) => w.name)).toEqual(["October news"]);
    const yes = await decideBroadcast(pg.db, b.id, true, "approver@wren.example", NOW);
    expect(yes.startAt).toEqual(NOW);
    expect(yes.broadcast.state).toBe("scheduled");

    expect(await startBroadcast(pg.db, b.id, NOW)).toBe(6);
    // A second start does nothing.
    expect(await startBroadcast(pg.db, b.id, NOW)).toBe(0);
    const mail = fakeMail();
    await sendDue(b.id, mail);
    const got = await recipients(b.id);
    expect(got.map((r) => [r.name, r.state, r.why])).toEqual([
      ["Ann Lee", "sent", null],
      ["Bo", "skipped", "Asked, never confirmed"],
      ["Cy", "skipped", "On the do-not-contact list"],
      ["Di", "skipped", "Never said yes to this topic"],
      ["Ed", "skipped", "No email address"],
      ["Fay", "held", "Held by the frequency cap. They are at their limit for now."],
    ]);
    // Fay waits until her day rolls: the DM's time plus a day.
    const fayRow = got.find((r) => r.name === "Fay") as Row;
    expect(new Date(fayRow.due_at as string)).toEqual(new Date(NOW.getTime() + 23 * HOUR));
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: "ann@firm.example", subject: "News for Ann" });
    expect(mail.sent[0]?.text).toMatch(/^Hi Ann, see https:\/\/example\.test\/news/);
    expect(mail.sent[0]?.text).toContain("Unsubscribe: https://example.test/u/ann@firm.example");

    // Still sending: Fay is due later.
    expect(await nextOrFinish(pg.db, b.id, NOW)).toEqual(new Date(NOW.getTime() + 23 * HOUR));
    expect((await broadcastById(pg.db, b.id))?.state).toBe("sending");

    // Results come from the sent log, each a link to its rows.
    const res = await broadcastResults(pg.db, b.id);
    expect(res.ladder).toEqual([
      { state: "queued", n: 1, link: `/people/sent?broadcast=${b.id}..${b.id}&state=queued` },
      { state: "sent", n: 1, link: `/people/sent?broadcast=${b.id}..${b.id}&state=sent` },
    ]);
    expect(res.skipped.map((s) => [s.why, s.n])).toHaveLength(4);
    expect(res.skipped[0]?.link).toBe(
      `/people/recipients?broadcastId=${b.id}..${b.id}&state=skipped`,
    );
    expect(res).toMatchObject({ held: 1, failed: 0 });
    expect((await broadcastDetail(pg.db, String(b.id)))?.results).toEqual(res);
    // Its send isn't a newsletter row too.
    expect(await run(sql`select kind, broadcast from sent_records order by kind`)).toEqual([
      { kind: "broadcast", broadcast: b.id },
      { kind: "broadcast", broadcast: b.id },
    ]);

    // A day on, Fay has room: she gets it and the broadcast is done.
    const later = new Date(NOW.getTime() + 24 * HOUR);
    await sendDue(b.id, mail, later);
    expect(mail.sent.map((m) => m.to)).toEqual(["ann@firm.example", "fay@firm.example"]);
    expect(await nextOrFinish(pg.db, b.id, later)).toBeNull();
    expect((await broadcastById(pg.db, b.id))?.state).toBe("sent");
    expect(await broadcastUses(pg.db)).toEqual(new Map());
  });

  it("fails one the mailer refuses, and never sends twice one cut off mid-send", async () => {
    const ann = await person("Ann", { email: "ann@firm.example" });
    const bo = await person("Bo", { email: "bo@firm.example" });
    await sign("email", "ann@firm.example", "news");
    await sign("email", "bo@firm.example", "news");
    const segmentId = await segmentOf([ann, bo]);
    const b = await saveBroadcast(
      pg.db,
      {
        name: "Note",
        channel: "email",
        segmentId,
        topic: "news",
        subject: "Hi",
        body: "Hello.",
        ask: true,
      },
      BY,
      T(10),
    );
    await decideBroadcast(pg.db, b.id, true, BY, NOW);
    await startBroadcast(pg.db, b.id, NOW);
    // Bo's step was cut off after the claim: the row reads `sending`.
    await run(
      sql`update broadcast_recipients set state = 'sending' where address = 'bo@firm.example'`,
    );
    const mail = fakeMail("ann@firm.example");
    await sendDue(b.id, mail);
    expect((await recipients(b.id)).map((r) => [r.name, r.state, r.why])).toEqual([
      ["Ann", "failed", "Didn't send: mailbox full"],
      ["Bo", "failed", "May not have sent: its step was cut off mid-send, so it isn't sent again"],
    ]);
    expect(mail.sent).toEqual([]);
    expect((await broadcastResults(pg.db, b.id)).failed).toBe(2);
  });
});

describe("a text broadcast", () => {
  it("hands each person's text to the texts sender once, under its broadcast", async () => {
    const [num] = await run(sql`insert into sms_numbers (e164, provider, ramp_started_on)
      values ('+15555550000', 'test', '2026-09-01') returning id`);
    const contact = (e164: string, state = "new") =>
      run(sql`insert into sms_contacts (e164, source_kind, basis, number_id, state)
        values (${e164}, 'manual', 'opt_in', ${num?.id as string}::uuid, ${state})`);
    const ann = await person("Ann", { phone: "+15555550101" });
    const bo = await person("Bo", { phone: "+15555550102" });
    const cy = await person("Cy", { phone: "+15555550103" });
    await contact("+15555550101");
    await contact("+15555550102", "opted_out");
    await sign("sms", "+15555550101", "texts");
    await sign("sms", "+15555550102", "texts");
    await sign("sms", "+15555550103", "texts");
    const segmentId = await segmentOf([ann, bo, cy]);
    await expect(
      saveBroadcast(
        pg.db,
        { name: "Alert", channel: "sms", segmentId, topic: "texts", body: "Hi." },
        BY,
        T(10),
      ),
    ).rejects.toThrow(/STOP/);
    await expect(
      saveBroadcast(
        pg.db,
        { name: "Alert", channel: "sms", segmentId, topic: "news", body: "Hi. STOP" },
        BY,
        T(10),
      ),
    ).rejects.toThrow(/email topic/);
    const b = await saveBroadcast(
      pg.db,
      {
        name: "Event alert",
        channel: "sms",
        segmentId,
        topic: "texts",
        body: "Hi {first_name|there}, doors open at 6. Reply STOP to stop.",
        ask: true,
      },
      BY,
      T(10),
    );
    expect(b.state).toBe("waiting");
    await decideBroadcast(pg.db, b.id, true, BY, NOW);
    await startBroadcast(pg.db, b.id, NOW);
    await sendDue(b.id, null);
    expect((await recipients(b.id)).map((r) => [r.name, r.state, r.why])).toEqual([
      ["Ann", "queued", null],
      ["Bo", "skipped", "Their texts ended (STOP or unreachable)"],
      ["Cy", "skipped", "No texts thread with them yet"],
    ]);
    const texts = await run(sql`select kind, ref, to_e164, body, state from sms_messages`);
    expect(texts).toEqual([
      {
        kind: "broadcast",
        ref: `event-alert/${b.id}`,
        to_e164: "+15555550101",
        body: "Hi Ann, doors open at 6. Reply STOP to stop.",
        state: "queued",
      },
    ]);
    // Asked again (a retried step), nothing more is queued.
    const [r] = await run(sql`select id from broadcast_recipients where state = 'queued'`);
    await run(sql`update broadcast_recipients set state = 'due' where id = ${r?.id as number}`);
    await sendDue(b.id, null);
    expect(await run(sql`select count(*)::int n from sms_messages`)).toEqual([{ n: 1 }]);
    // The sent log reads it as its texts row, under the broadcast.
    expect(
      await run(sql`select kind, campaign, broadcast from sent_records where id like 'sms:%'`),
    ).toEqual([{ kind: "broadcast", campaign: "Event alert", broadcast: b.id }]);
    expect(await nextOrFinish(pg.db, b.id, NOW)).toBeNull();
  });
});

describe("times, cancel and restore", () => {
  it("with local time, each person is due at the wall clock where they are", async () => {
    const ann = await person("Ann", { email: "ann@firm.example" });
    const bo = await person("Bo", { email: "bo@firm.example" });
    await setTraits(pg.db, ann, { timezone: "America/Los_Angeles" }, "t", T(2));
    const segmentId = await segmentOf([ann, bo]);
    const b = await saveBroadcast(
      pg.db,
      {
        name: "Morning",
        channel: "email",
        segmentId,
        topic: "news",
        subject: "Morning",
        body: "Good morning.",
        sendAt: "2026-10-20T14:00:00Z",
        local: true,
        zone: "America/New_York",
        ask: true,
      },
      BY,
      NOW,
    );
    const { startAt } = await decideBroadcast(pg.db, b.id, true, BY, NOW);
    expect(startAt).toEqual(new Date("2026-10-19T20:00:00Z"));
    expect(await broadcastMonth(pg.db, T(1), T(31))).toEqual([
      {
        id: b.id,
        name: "Morning",
        channel: "email",
        state: "scheduled",
        at: "2026-10-20T14:00:00.000Z",
      },
    ]);
    await startBroadcast(pg.db, b.id, new Date("2026-10-19T20:00:00Z"));
    expect(
      (await recipients(b.id)).map((r) => [r.name, new Date(r.due_at as string).toISOString()]),
    ).toEqual([
      ["Ann", "2026-10-20T17:00:00.000Z"],
      ["Bo", "2026-10-20T14:00:00.000Z"],
    ]);
    // Nobody is due before their time.
    expect(await dueRecipients(pg.db, b.id, new Date("2026-10-20T13:00:00Z"), 10)).toEqual([]);
    expect(await dueRecipients(pg.db, b.id, new Date("2026-10-20T15:00:00Z"), 10)).toHaveLength(1);
  });

  it("cancel skips who's left; restore puts them back, or sends a draft back to be asked", async () => {
    const ann = await person("Ann", { email: "ann@firm.example" });
    await sign("email", "ann@firm.example", "news");
    const segmentId = await segmentOf([ann]);
    const input = {
      channel: "email" as const,
      segmentId,
      topic: "news",
      subject: "Hi",
      body: "Hello.",
      ask: true,
    };
    // Never started: back to a draft, to be asked again.
    const a = await saveBroadcast(pg.db, { ...input, name: "First" }, BY, T(10));
    await cancelBroadcast(pg.db, a.id, BY, NOW);
    await expect(saveBroadcast(pg.db, { id: a.id, body: "Changed." }, BY, NOW)).rejects.toThrow(
      /restore/,
    );
    expect(await restoreBroadcast(pg.db, a.id, NOW)).toMatchObject({
      broadcast: { state: "draft" },
      startAt: null,
    });

    // Started: its people are skipped, then due again.
    const b = await saveBroadcast(pg.db, { ...input, name: "Second" }, BY, T(10));
    await decideBroadcast(pg.db, b.id, true, BY, NOW);
    await startBroadcast(pg.db, b.id, NOW);
    await cancelBroadcast(pg.db, b.id, BY, NOW);
    expect((await recipients(b.id)).map((r) => [r.state, r.why])).toEqual([
      ["skipped", "Canceled before it went"],
    ]);
    // A run after the cancel sends nothing.
    expect(
      await sendRecipient(
        pg.db,
        (await run(sql`select id from broadcast_recipients`))[0]?.id as number,
        {
          mail: fakeMail(),
          now: NOW,
        },
      ),
    ).toEqual({ state: "gone" });
    const back = await restoreBroadcast(pg.db, b.id, NOW);
    expect(back).toMatchObject({ broadcast: { state: "sending" }, startAt: NOW });
    expect((await recipients(b.id)).map((r) => r.state)).toEqual(["due"]);

    // A declined one says why, and can be asked again.
    const c = await saveBroadcast(pg.db, { ...input, name: "Third" }, BY, T(10));
    const no = await decideBroadcast(pg.db, c.id, false, BY, NOW, " Not this week ");
    expect(no.broadcast).toMatchObject({ state: "declined", note: "Not this week" });
    expect((await askBroadcast(pg.db, c.id, BY, NOW)).state).toBe("waiting");
  });
});
