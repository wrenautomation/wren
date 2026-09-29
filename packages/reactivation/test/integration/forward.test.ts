/**
 * Forwarding replies to recruiters (R13): which replies go, to whom, from
 * where, and that a crash between the send and the mark never sends twice.
 */
import { ConsoleTransport } from "@wren/channel-email";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CRM_FORMATS } from "../../src/crm/formats.js";
import { runCrmImport } from "../../src/crm/import.js";
import { CrmCsvSource } from "../../src/crm/source.js";
import { forwardHandoffs } from "../../src/forward.js";
import { markMeetingBooked } from "../../src/handoff.js";

const SAM = "sam@acme-talent.example";
const PAT = "pat@acme.example";
const LEE = "lee@acme.example";
const PROFILE = {
  recruiters: [
    { name: "Pat", email: PAT, owners: [] },
    { name: "Lee", email: LEE, owners: [] },
  ],
  defaultRecruiter: LEE,
};
const SETTINGS = { senders: [{ address: SAM, name: "Sam Park" }] };

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, [
    "handoffs",
    "thread_events",
    "messages",
    "enrollments",
    "crm_contacts",
    "import_errors",
    "people",
    "companies",
    "imports",
  ]);
  const f = CRM_FORMATS.get("crm-generic");
  if (!f) throw new Error("crm-generic");
  const csv = [
    "ID,Name,Email,Company,Website",
    "1,Jane Doe,jane@umbrella.example,Umbrella,https://umbrella.example",
    "2,Bob Roe,bob@umbrella.example,Umbrella,https://umbrella.example",
  ].join("\n");
  await runCrmImport(pg.db, new CrmCsvSource(f, "export.csv", new TextEncoder().encode(csv)));
});

/** An email to this person written as `wroteAs`, and their reply with this disposition. */
async function reply(
  email: string,
  disposition: string,
  wroteAs: string | null,
  niche = "reactivation",
) {
  const [person] = await pg.db.execute<{ id: number; company_id: number }>(
    sql`select person_id as id, company_id from crm_contacts where email = ${email} limit 1`,
  );
  const [enr] = await pg.db.execute<{ id: number }>(sql`
    insert into enrollments (person_id, company_id, niche, sequence_name, sequence_snapshot, offer,
      state, kind, to_email, sender)
    values (${person?.id}, ${person?.company_id}, ${niche}, 'reactivation', '{}'::jsonb, 'reactivation',
      'finished', 'person', ${email}, ${SAM})
    returning id`);
  await pg.db.execute(sql`
    insert into messages (enrollment_id, step, template, template_version, to_email, subject, body,
      provenance, state)
    values (${enr?.id}, 0, 'reactivation_opener', 'v1', ${email}, 'umbrella', 'Hi',
      ${JSON.stringify(wroteAs ? { recruiter: wroteAs } : {})}::jsonb, 'draft')`);
  const [t] = await pg.db.execute<{ id: number }>(sql`
    insert into thread_events (enrollment_id, kind, disposition, disposition_source, from_address,
      subject, body_text, received_at)
    values (${enr?.id}, 'reply', ${disposition}, 'llm', ${email}, 'Re: umbrella',
      'Sounds good, Tuesday works.', now())
    returning id`);
  return Number(t?.id);
}

const handoffRows = () =>
  pg.db.execute<{ thread_event_id: number; recruiter_email: string; forwarded: boolean }>(sql`
    select thread_event_id, recruiter_email, forwarded_at is not null as forwarded
    from handoffs order by id`);

describe("forwardHandoffs", () => {
  it("forwards interested and booked replies, from their mailbox, to the recruiter", async () => {
    const jane = await reply("jane@umbrella.example", "interested", PAT);
    const bob = await reply("bob@umbrella.example", "meeting_booked", null);
    await reply("bob@umbrella.example", "not_interested", PAT);
    const transport = new ConsoleTransport({ write: () => {} });
    const out = await forwardHandoffs(pg.db, transport, { profile: PROFILE, settings: SETTINGS });
    expect(out).toMatchObject({ opened: 2, forwarded: 2, found: 0, failed: 0, noRecruiter: 0 });
    expect(await handoffRows()).toEqual([
      { thread_event_id: jane, recruiter_email: PAT, forwarded: true },
      // No recruiter on the email: the firm's default.
      { thread_event_id: bob, recruiter_email: LEE, forwarded: true },
    ]);
    const sent = transport.mailbox.get(SAM) ?? [];
    expect(sent.map((s) => s.email.to)).toEqual([PAT, LEE]);
    const first = sent[0]?.email;
    expect(first?.fromName).toBe("Sam Park");
    expect(first?.subject).toBe("Fwd: Re: umbrella");
    expect(first?.body).toContain("Sounds good, Tuesday works.");
    expect(first?.body).toContain("jane@umbrella.example");
    // The operator's lines never name the contact.
    expect(out.sent.join(" ")).not.toMatch(/jane|bob|doe|roe/i);

    // Nothing left: a second pass sends nothing.
    const again = await forwardHandoffs(pg.db, transport, { profile: PROFILE, settings: SETTINGS });
    expect(again).toMatchObject({ opened: 0, forwarded: 0, found: 0 });
    expect(transport.mailbox.get(SAM)).toHaveLength(2);
  });

  it("a crash after the send never forwards twice", async () => {
    await reply("jane@umbrella.example", "interested", PAT);
    const lost = new ConsoleTransport({ write: () => {}, ambiguousAfter: () => true });
    const out = await forwardHandoffs(pg.db, lost, { profile: PROFILE, settings: SETTINGS });
    expect(out.failed).toBe(1);
    expect((await handoffRows())[0]?.forwarded).toBe(false);

    // The retry asks the mailbox first: it is there, so only the mark is written.
    const retry = new ConsoleTransport({ write: () => {} });
    retry.mailbox.set(SAM, lost.mailbox.get(SAM) ?? []);
    const again = await forwardHandoffs(pg.db, retry, { profile: PROFILE, settings: SETTINGS });
    expect(again).toMatchObject({ forwarded: 0, found: 1, failed: 0 });
    expect(retry.mailbox.get(SAM)).toHaveLength(1);
    expect((await handoffRows())[0]?.forwarded).toBe(true);
  });

  it("with no recruiter it waits, then goes once the firm names one", async () => {
    await reply("jane@umbrella.example", "interested", null);
    const transport = new ConsoleTransport({ write: () => {} });
    const none = await forwardHandoffs(pg.db, transport, { profile: null, settings: SETTINGS });
    expect(none).toMatchObject({ opened: 1, forwarded: 0, noRecruiter: 1 });
    expect(transport.mailbox.get(SAM)).toBeUndefined();

    const out = await forwardHandoffs(pg.db, transport, { profile: PROFILE, settings: SETTINGS });
    expect(out).toMatchObject({ forwarded: 1, noRecruiter: 0 });
    expect((await handoffRows())[0]?.recruiter_email).toBe(LEE);
  });

  it("a meeting marked by hand is forwarded too, whatever the classifier said", async () => {
    const jane = await reply("jane@umbrella.example", "not_interested", PAT);
    await markMeetingBooked(pg.db, { threadEventId: jane, booked: true, by: "operator" }, PROFILE);
    const transport = new ConsoleTransport({ write: () => {} });
    const out = await forwardHandoffs(pg.db, transport, { profile: PROFILE, settings: SETTINGS });
    expect(out).toMatchObject({ opened: 0, forwarded: 1 });
  });

  it("replies to Wren's own campaign are never forwarded", async () => {
    await reply("jane@umbrella.example", "interested", PAT, "agencies");
    const transport = new ConsoleTransport({ write: () => {} });
    const out = await forwardHandoffs(pg.db, transport, { profile: PROFILE, settings: SETTINGS });
    expect(out).toMatchObject({ opened: 0, forwarded: 0 });
  });

  it("a mailbox that refuses fails that forward and leaves it for the next pass", async () => {
    await reply("jane@umbrella.example", "interested", PAT);
    const refusing = new ConsoleTransport({
      write: () => {},
      refuse: () => new Error("token refused"),
    });
    const out = await forwardHandoffs(pg.db, refusing, { profile: PROFILE, settings: SETTINGS });
    expect(out.failed).toBe(1);
    expect(out.errors[0]).toMatch(/token refused/);
    expect((await handoffRows())[0]?.forwarded).toBe(false);
  });
});
