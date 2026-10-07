/**
 * A person's journey shows their Follow-up and Nurture touches (designs/2026-10-07-follow-up-nurture.md):
 * each touch a step sent on, on any of the person's threads, and the wait it is in now.
 * Synthetic person; no step runs.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { personTouches } from "../../src/portal/journey.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() =>
  truncate(pg.db, ["events", "sms_contacts", "reach_contacts", "people", "companies"]),
);

const one = async <T>(q: ReturnType<typeof sql>): Promise<T> =>
  ((await pg.db.execute(q)) as unknown as T[])[0] as T;

describe("a person's journey", () => {
  it("shows each follow-up touch on any of their threads, and the wait they are in", async () => {
    const firm = await one<{ id: number }>(sql`INSERT INTO companies (name, domain, niche)
      VALUES ('Acme Test', 'acme.test', 'agencies') RETURNING id`);
    const p = await one<{ id: number }>(sql`INSERT INTO people
      (company_id, full_name, is_compliance, origin, origin_ref, raw)
      VALUES (${firm.id}, 'Dana Test', false, 'manual', 't', '{}'::jsonb) RETURNING id`);
    const text = await one<{ id: number }>(sql`INSERT INTO sms_contacts
      (e164, source_kind, basis, company_id, person_id, state)
      VALUES ('+15550001111', 'form', 'opt_in', ${firm.id}, ${p.id}, 'finished') RETURNING id`);
    const dm = await one<{ id: number }>(sql`INSERT INTO reach_contacts
      (platform, handle, url, found_in, company_id, person_id, state)
      VALUES ('linkedin', 'dana-test', 'https://linkedin.test/in/dana-test', 'manual',
        ${firm.id}, ${p.id}, 'finished') RETURNING id`);
    const note = (part: string, channel: string, did: string, why: string | null = null) =>
      JSON.stringify([
        { port: "sent", subject: "x", kind: "lead", data: { follow: { part, channel, did, why } } },
      ]);
    const sms = `lead:sms:${text.id}`;
    const reach = `lead:reach:${dm.id}`;
    await pg.db.execute(sql`INSERT INTO events
      (workflow, node, port, subject, kind, data, by, at, sent, sent_at, due, until) VALUES
      ('keep_warm', 'follow.text1', 'lead', ${sms}, 'lead', '{}', 't', '2026-10-01T15:00Z',
        ${note("follow_up", "text", "queued")}::jsonb, '2026-10-01T15:00Z', null, null),
      ('keep_warm', 'follow.dm2', 'lead', ${reach}, 'lead', '{}', 't', '2026-10-03T15:00Z',
        ${note("follow_up", "dm", "would_send", "WREN_REACH_LIVE is off")}::jsonb,
        '2026-10-03T15:00Z', null, null),
      ('keep_warm', 'follow.wait3', 'in', ${reach}, 'lead', '{}', 't', '2026-10-03T15:01Z',
        null, null, '2026-10-07T15:00Z', 'answer'),
      ('keep_warm', 'follow.wait1', 'in', ${sms}, 'lead', '{}', 't', '2026-10-01T15:00Z',
        null, null, null, 'answer'),
      ('other', 'x', 'lead', 'lead:sms:999', 'lead', '{}', 't', '2026-10-01T15:00Z',
        ${note("nurture", "text", "queued")}::jsonb, '2026-10-01T15:00Z', null, null)`);

    const touches = (await personTouches(pg.db, p.id)).filter((t) => t.channel === "Follow-up");
    expect(touches.map(({ kind, label, note }) => ({ kind, label, note }))).toEqual([
      { kind: "sent", label: "Follow-up: Text sent", note: null },
      { kind: "would_send", label: "Follow-up: DM would send", note: "WREN_REACH_LIVE is off" },
      { kind: "waiting", label: "Waiting for an answer", note: "until Oct 07" },
    ]);
  });
});
