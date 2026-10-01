/**
 * Reactivation into the work portal (delivery step 6) on a fixed clock: the
 * counts become results only when they change, meetings carry the bill, and
 * one timeline line a day says what moved.
 */
import { clients } from "@wren/core/clients";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { results, startEngagement, updates } from "@wren/delivery";
import { asc, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CRM_FORMATS } from "../../src/crm/formats.js";
import { runCrmImport } from "../../src/crm/import.js";
import { CrmCsvSource } from "../../src/crm/source.js";
import { FEED_BY, feedDelivery } from "../../src/delivery.js";
import { markMeetingBooked } from "../../src/handoff.js";

const OFFER = { offer: { upfront: 1000, perMeeting: 500, cap: 15000 } };
let pg: TestPostgres;
const feed = (at: string, settings = OFFER) =>
  feedDelivery(pg.db, pg.db, "acme", settings, new Date(at));

/** A sent opener to this contact at `at`; returns the enrollment id. */
async function sent(email: string, at: string): Promise<number> {
  const [c] = await pg.db.execute<{ person_id: number; company_id: number }>(
    sql`select person_id, company_id from crm_contacts where email = ${email} limit 1`,
  );
  const [enr] = await pg.db.execute<{ id: number }>(sql`
    insert into enrollments (person_id, company_id, niche, sequence_name, sequence_snapshot, offer,
      state, kind, to_email, sender)
    values (${c?.person_id}, ${c?.company_id}, 'reactivation', 'reactivation', '{}'::jsonb,
      'reactivation', 'finished', 'person', ${email}, 'sam@acme-talent.example')
    returning id`);
  await pg.db.execute(sql`
    insert into messages (enrollment_id, step, template, template_version, to_email, subject, body,
      provenance, state, sent_at, message_id)
    values (${enr?.id}, 0, 'reactivation_opener', 'v1', ${email}, 'hi', 'Hi', '{}'::jsonb,
      'sent', ${at}::timestamptz, ${`<${email}>`})`);
  return Number(enr?.id);
}

async function replied(enrollmentId: number, at: string): Promise<number> {
  const [t] = await pg.db.execute<{ id: number }>(sql`
    insert into thread_events (enrollment_id, kind, disposition, disposition_source, from_address,
      subject, body_text, received_at)
    values (${enrollmentId}, 'reply', 'interested', 'llm', 'x@umbrella.example', 'Re: hi',
      'Tuesday works.', ${at}::timestamptz)
    returning id`);
  return Number(t?.id);
}

const shown = async () =>
  Object.fromEntries(
    (await pg.db.select().from(results).orderBy(asc(results.key))).map((r) => [
      r.key,
      [r.value, r.note],
    ]),
  );
const lines = async () =>
  (await pg.db.select().from(updates).orderBy(asc(updates.id))).map((u) => [u.author, u.body]);

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db
    .insert(clients)
    .values({ id: "acme", name: "Acme Staffing", database: "wren_client_acme" });
  const f = CRM_FORMATS.get("crm-generic");
  if (!f) throw new Error("crm-generic");
  const csv = [
    "ID,Name,Email,Company,Website",
    "1,Jane Doe,jane@umbrella.example,Umbrella,https://umbrella.example",
    "2,Bob Roe,bob@umbrella.example,Umbrella,https://umbrella.example",
    "3,Kim Lo,kim@umbrella.example,Umbrella,https://umbrella.example",
  ].join("\n");
  await runCrmImport(pg.db, new CrmCsvSource(f, "export.csv", new TextEncoder().encode(csv)));
});
afterAll(() => pg?.stop());

describe("feedDelivery", () => {
  it("feeds nothing without an active reactivation engagement", async () => {
    expect(await feed("2026-10-05T09:00:00Z")).toEqual({
      engagements: 0,
      changed: [],
      posted: false,
    });
  });

  it("writes the counts once, with the bill on meetings", async () => {
    await startEngagement(pg.db, {
      clientId: "acme",
      offerId: "reactivation",
      startsOn: "2026-10-05",
      by: "seed",
    });
    const jane = await sent("jane@umbrella.example", "2026-10-05T10:00:00Z");
    await sent("bob@umbrella.example", "2026-10-05T10:05:00Z");
    expect(await feed("2026-10-05T12:00:00Z")).toEqual({
      engagements: 1,
      changed: ["contacts_reached", "replies", "meetings"],
      posted: false,
    });
    expect(await shown()).toEqual({
      contacts_reached: [2, null],
      meetings: [0, "$1,000 owed so far: $1,000 setup + $0 in meetings"],
      replies: [0, null],
    });
    // Nothing moved: nothing written.
    expect((await feed("2026-10-05T12:10:00Z")).changed).toEqual([]);

    const reply = await replied(jane, "2026-10-05T15:00:00Z");
    await markMeetingBooked(
      pg.db,
      { threadEventId: reply, booked: true, by: "pat@acme.example" },
      null,
      new Date("2026-10-05T16:00:00Z"),
    );
    expect((await feed("2026-10-05T17:00:00Z")).changed).toEqual(["replies", "meetings"]);
    expect((await shown()).meetings).toEqual([
      1,
      "$1,500 owed so far: $1,000 setup + $500 in meetings",
    ]);
    expect(
      (await feed("2026-10-05T17:10:00Z", { offer: { upfront: 0, perMeeting: 500, cap: 300 } }))
        .changed,
    ).toEqual(["meetings"]);
    expect((await shown()).meetings).toEqual([
      1,
      "$300 owed so far: $0 setup + $300 in meetings (capped)",
    ]);
  });

  it("posts one line a day about what moved since the last", async () => {
    expect((await feed("2026-10-06T09:00:00Z")).posted).toBe(true);
    expect((await feed("2026-10-06T10:00:00Z")).posted).toBe(false);
    // A quiet day: no line.
    expect((await feed("2026-10-07T09:00:00Z")).posted).toBe(false);
    await sent("kim@umbrella.example", "2026-10-07T11:00:00Z");
    expect((await feed("2026-10-08T09:00:00Z")).posted).toBe(true);
    expect(await lines()).toEqual([
      [FEED_BY, "So far: 2 contacts reached, 1 reply, 1 meeting booked."],
      [FEED_BY, "Since 2026-10-06: 1 contact reached."],
    ]);
  });
});
