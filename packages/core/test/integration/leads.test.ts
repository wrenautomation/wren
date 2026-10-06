/** One lead across channels: the person, else the firm; one sequence at a time, one first touch a day. */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activeElsewhere, firstTouchElsewhere, leadRefusal, linkPeople } from "../../src/leads.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const now = new Date("2026-03-02T15:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

let n = 0;
async function firm(): Promise<number> {
  n += 1;
  const [row] = (await pg.db.execute(
    sql`INSERT INTO companies (domain) VALUES (${`firm${n}.example`}) RETURNING id`,
  )) as unknown as { id: number }[];
  return (row as { id: number }).id;
}
async function person(companyId: number): Promise<number> {
  const [row] = (await pg.db.execute(sql`
    INSERT INTO people (company_id, full_name, is_compliance, origin, origin_ref, raw)
    VALUES (${companyId}, 'Ann Example', false, 'manual', 'test', '{}') RETURNING id`)) as unknown as {
    id: number;
  }[];
  return (row as { id: number }).id;
}
async function email(companyId: number, personId: number | null, sentAt: Date | null = null) {
  const [e] = (await pg.db.execute(sql`
    INSERT INTO enrollments (niche, sequence_name, sequence_snapshot, offer, state, company_id,
      person_id, kind, to_email, sender)
    VALUES ('test', 's', '{}', 'o', 'active', ${companyId}, ${personId},
      ${personId === null ? "role_inbox" : "person"}, ${`a${companyId}.${personId}@firm.example`}, 'me@wren.example')
    RETURNING id`)) as unknown as { id: number }[];
  const id = (e as { id: number }).id;
  if (sentAt)
    await pg.db.execute(sql`
      INSERT INTO messages (enrollment_id, step, template, template_version, to_email, body,
        provenance, state, sent_at, message_id)
      VALUES (${id}, 0, 't', 'v1', 'a@firm.example', 'hi', '{}', 'sent', ${sentAt.toISOString()},
        ${`<m${id}@wren.example>`})`);
  return id;
}
async function text(companyId: number, state: string, enrolledAt: Date | null) {
  n += 1;
  await pg.db.execute(sql`
    INSERT INTO sms_contacts (e164, source_kind, basis, company_id, state, enrolled_at, sequence)
    VALUES (${`+1555000${String(n).padStart(4, "0")}`}, 'page', 'published', ${companyId},
      ${state}, ${enrolledAt?.toISOString() ?? null}, ${enrolledAt ? "cold" : null})`);
}

describe("activeElsewhere", () => {
  it("holds a firm's line while its role inbox runs, and a person only on their own lead", async () => {
    const f = await firm();
    const p = await person(f);
    const inbox = await email(f, null);
    expect(await activeElsewhere(pg.db, { personId: null, companyId: f }, "text")).toMatch(
      `lead firm:${f} is in an active email sequence`,
    );
    // Email guards itself; a person at the firm is another lead.
    expect(await activeElsewhere(pg.db, { personId: null, companyId: f }, "email")).toBeNull();
    expect(await activeElsewhere(pg.db, { personId: p, companyId: f }, "text")).toBeNull();
    // One active enrollment a firm (email's own index): the inbox ends before the person starts.
    await pg.db.execute(
      sql`UPDATE enrollments SET state = 'stopped', stop_reason = 'manual' WHERE id = ${inbox}`,
    );
    await email(f, p);
    expect(await activeElsewhere(pg.db, { personId: p, companyId: f }, "dm")).toMatch(
      `lead person:${p} is in an active email sequence`,
    );
  });

  it("sees a running text thread from email, an ended one not", async () => {
    const f = await firm();
    await text(f, "finished", hoursAgo(100));
    expect(await activeElsewhere(pg.db, { personId: null, companyId: f }, "email")).toBeNull();
    await text(f, "replied", hoursAgo(100));
    expect(await activeElsewhere(pg.db, { personId: null, companyId: f }, "email")).toMatch(
      "active text sequence",
    );
  });
});

describe("firstTouchElsewhere", () => {
  it("is a sent email opener or a text enroll inside a day, on another channel", async () => {
    const f = await firm();
    await email(f, null, hoursAgo(30));
    expect(await firstTouchElsewhere(pg.db, f, "text", now)).toBeNull();
    const g = await firm();
    await email(g, null, hoursAgo(5));
    expect(await firstTouchElsewhere(pg.db, g, "text", now)).toBe(
      `firm ${g} got a first touch by email 5h ago`,
    );
    expect(await firstTouchElsewhere(pg.db, g, "email", now)).toBeNull();
    const h = await firm();
    await text(h, "finished", hoursAgo(2));
    expect(await firstTouchElsewhere(pg.db, h, "email", now)).toMatch("first touch by text 2h ago");
    expect(await firstTouchElsewhere(pg.db, h, "dm", now)).toMatch("first touch by text");
  });
});

describe("leadRefusal", () => {
  it("passes a lead no other channel holds and no other channel touched today", async () => {
    const f = await firm();
    expect(await leadRefusal(pg.db, { personId: null, companyId: f }, "text", now)).toBeNull();
    expect(await leadRefusal(pg.db, { personId: null, companyId: null }, "dm", now)).toBeNull();
  });
});

describe("linkPeople", () => {
  const one = async <T>(q: ReturnType<typeof sql>) =>
    ((await pg.db.execute(q)) as unknown as T[])[0] as T;
  const named = (companyId: number, name: string, linkedin: string | null = null) =>
    one<{ id: number }>(sql`
      INSERT INTO people (company_id, full_name, is_compliance, origin, origin_ref, raw, linkedin_url)
      VALUES (${companyId}, ${name}, false, 'manual', 'test', '{}', ${linkedin}) RETURNING id`);
  const sms = (v: { company?: number | null; name?: string; email?: string }) => {
    n += 1;
    return one<{ id: number }>(sql`
      INSERT INTO sms_contacts (e164, source_kind, basis, company_id, name, email)
      VALUES (${`+1555100${String(n).padStart(4, "0")}`}, 'form', 'opt_in', ${v.company ?? null},
        ${v.name ?? null}, ${v.email ?? null}) RETURNING id`);
  };
  const linked = (table: string, id: number) =>
    one<{ person_id: number | null; company_id: number | null }>(
      sql`SELECT person_id, company_id FROM ${sql.identifier(table)} WHERE id = ${id}`,
    );

  it("links by email, by one name at the firm, and by LinkedIn handle; never a guess", async () => {
    const f = await firm();
    const ann = await named(f, "Ann Example", "https://www.linkedin.com/in/Ann-Example/");
    await one(sql`INSERT INTO contact_candidates (person_id, email, domain, evidence, rank, state, source_ref)
      VALUES (${ann.id}, 'ann@firm.example', 'firm.example', 'scraped', 1, 'verified', 'test')`);
    await named(f, "Bo Twin");
    await named(f, "Bo Twin");

    const byEmail = await sms({ email: "ANN@firm.example" });
    const byName = await sms({ company: f, name: " ann example " });
    const twins = await sms({ company: f, name: "Bo Twin" });
    const mainLine = await sms({ company: f });
    const elsewhere = await sms({ company: await firm(), email: "ann@firm.example" });
    expect(await linkPeople(pg.db, "sms_contacts", [byName.id])).toBe(1);
    expect(await linkPeople(pg.db, "sms_contacts")).toBe(1);
    expect(await linked("sms_contacts", byEmail.id)).toEqual({ person_id: ann.id, company_id: f });
    expect(await linked("sms_contacts", byName.id)).toEqual({ person_id: ann.id, company_id: f });
    for (const c of [twins, mainLine])
      expect(await linked("sms_contacts", c.id)).toMatchObject({ person_id: null, company_id: f });
    expect((await linked("sms_contacts", elsewhere.id)).person_id).toBeNull();

    const dm = await one<{ id: number }>(sql`
      INSERT INTO reach_contacts (platform, handle, url, found_in)
      VALUES ('linkedin', 'ann-example', 'https://www.linkedin.com/in/ann-example/', 'test') RETURNING id`);
    expect(await linkPeople(pg.db, "reach_contacts", [dm.id])).toBe(1);
    expect(await linked("reach_contacts", dm.id)).toEqual({ person_id: ann.id, company_id: f });
    expect(await linkPeople(pg.db, "reach_contacts")).toBe(0);
  });
});
