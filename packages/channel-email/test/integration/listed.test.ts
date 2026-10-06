/**
 * Listed contacts: named leads at firms in play become people holding their lead's
 * address, the lead's verdict settles the candidate, and queueing never touches it.
 */
import { companies, imports, type LeadStatus, leads, people } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { asc, eq, sql } from "drizzle-orm";
import { LocalChecker } from "mailifier";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runListedContacts } from "../../src/resolution/listed.js";
import { queueCandidates } from "../../src/resolution/service.js";
import { contactCandidates } from "../../src/schema.js";
import { runVerification } from "../../src/verification/service.js";
import { FakeVerifier } from "../../src/verification/verifier.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["imports", "companies", "leads", "verifications"]));
const db = () => pg.db;

interface Seat {
  key: string;
  email: string;
  first?: string | null;
  last?: string | null;
  title?: string | null;
  status?: LeadStatus;
  decline?: string | null;
  niche?: string;
}

async function seed(...seats: Seat[]) {
  const [batch] = await db()
    .insert(imports)
    .values({ sourceType: "sba_search", sourceRef: "fixture", stats: {} })
    .returning();
  for (const s of seats) {
    const [co] = await db()
      .insert(companies)
      .values({
        sourceKey: s.key,
        name: `Firm ${s.key}`,
        niche: s.niche ?? "recruiting",
        country: "US",
        declineReason: s.decline ?? null,
      })
      .returning();
    await db()
      .insert(leads)
      .values({
        email: s.email,
        raw: {},
        importId: (batch as { id: number }).id,
        companyId: (co as { id: number }).id,
        firstName: s.first === undefined ? "Pat" : s.first,
        lastName: s.last === undefined ? "Doe" : s.last,
        title: s.title ?? null,
        status: s.status ?? "imported",
      });
  }
}

const candidates = () =>
  db()
    .select({ email: contactCandidates.email, state: contactCandidates.state })
    .from(contactCandidates)
    .orderBy(asc(contactCandidates.email));
const ranks = async () =>
  (await db().execute(sql`SELECT full_name, role_rank FROM person_facts ORDER BY full_name`)).map(
    (r) => [r.full_name, r.role_rank],
  );

describe("runListedContacts", () => {
  it("makes people of named leads in play; skips role inboxes, unnamed, declined, other niches", async () => {
    await seed(
      { key: "sba:1", email: "pat.owner@gmail.com", title: "Owner" },
      { key: "sba:2", email: "jobs@firm2.example" },
      { key: "sba:3", email: "anon@firm3.example", first: null, last: null },
      { key: "sba:4", email: "kim@firm4.example", decline: "chain" },
      { key: "sba:5", email: "lee@firm5.example", niche: "agencies" },
      { key: "sba:6", email: "sam@firm6.example", first: "Sam", last: "Roe", status: "verified" },
    );
    const stats = await runListedContacts(db(), "recruiting");
    expect(stats).toEqual({
      leads: 2,
      people_created: 2,
      people_seen: 0,
      candidates: 2,
      settled: 1,
      role_inboxes: 1,
    });
    expect(await candidates()).toEqual([
      { email: "pat.owner@gmail.com", state: "candidate" },
      { email: "sam@firm6.example", state: "verified" },
    ]);
    const pat = (await db().select().from(people).where(eq(people.fullName, "Pat Doe")))[0];
    expect(pat).toMatchObject({ origin: "registry", title: "Owner" });
    const [patLead] = await db().select().from(leads).where(eq(leads.email, "pat.owner@gmail.com"));
    expect(patLead?.personId).toBe(pat?.id);
    // Untitled registry people still rank; the recruiting branch ranks owners first.
    expect(await ranks()).toEqual([
      ["Pat Doe", 1],
      ["Sam Roe", 3],
    ]);
  });

  it("is idempotent: a second run adds nothing", async () => {
    await seed({ key: "sba:1", email: "pat.owner@gmail.com" });
    await runListedContacts(db(), "recruiting");
    const again = await runListedContacts(db(), "recruiting");
    expect(again).toMatchObject({ leads: 0, candidates: 0 });
    expect(await candidates()).toHaveLength(1);
  });

  it("the lead's verdict settles the candidate; queueing leaves it alone", async () => {
    await seed(
      { key: "sba:1", email: "pat@verifyco.example" },
      { key: "sba:2", email: "kim+invalid@verifyco.example", first: "Kim" },
    );
    await runListedContacts(db(), "recruiting");
    const queued = await queueCandidates(db(), { niche: "recruiting" });
    expect(queued.candidates_queued).toBe(0);
    await runVerification(db(), new FakeVerifier({ authoritative: true }), {
      niche: "recruiting",
      checker: new LocalChecker(async (name, rtype) =>
        name === "verifyco.example" && rtype === "MX" ? ["10 mail.verifyco.example."] : [],
      ),
    });
    expect(await candidates()).toEqual([
      { email: "kim+invalid@verifyco.example", state: "rejected" },
      { email: "pat@verifyco.example", state: "verified" },
    ]);
  });
});
