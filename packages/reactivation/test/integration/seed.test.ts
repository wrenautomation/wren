/**
 * `crm seed-demo` end to end on fakes: the agency's site names two customers,
 * search finds people who hire there (one has moved on), the made-up history
 * goes in through the Bullhorn import, and a second seed replaces the first.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedDemo } from "../../src/demo/seed.js";
import { deps, today } from "./demo-fixture.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() =>
  truncate(pg.db, ["crm_contacts", "sightings", "import_errors", "people", "companies", "imports"]),
);
const db = () => pg.db;

describe("seedDemo", () => {
  it("builds the list from the agency's customers and imports it", async () => {
    const { stats, csv } = await seedDemo(db(), deps, { agency: "northside.example", today });
    expect(stats).toMatchObject({
      agency: { name: "Northside Talent", domain: "northside.example" },
      customersNamed: 2,
      customersUsed: 2,
      sitesFound: 2,
      noContacts: 0,
      people: 3,
      moved: 1,
    });
    expect(csv.split("\r\n")[0]).toMatch(/^ID,First Name,Last Name,Email/);
    const people = await db().execute(
      sql`select p.first_name, p.last_name, c.name as company, c.domain,
            cc.owner, cc.last_placement_on is not null or cc.last_contacted_on is not null as dated
          from people p join companies c on c.id = p.company_id
          left join crm_contacts cc on cc.person_id = p.id
          order by p.last_name`,
    );
    expect(people.map((r) => [r.last_name, r.company])).toEqual([
      ["Doe", "Umbrella Health"],
      ["Lim", "Umbrella Health"],
      ["Roe", "Globex"],
    ]);
    // The address a recruiter would have saved: at the customer, even for the one who left.
    const emails = await db().execute(
      sql`select email as address from contact_candidates order by email`,
    );
    expect(emails.map((r) => r.address)).toEqual([
      "bob.roe@globex.com",
      "cara.lim@umbrellahealth.com",
      "jane.doe@umbrellahealth.com",
    ]);
    for (const r of people) expect(r.owner).toBeTruthy();
  });

  it("the same agency gets the same list; a second seed replaces the first", async () => {
    const a = await seedDemo(db(), deps, { agency: "https://northside.example/", today });
    const b = await seedDemo(db(), deps, { agency: "northside.example", today });
    expect(b.csv).toBe(a.csv);
    const n = await db().execute(sql`select count(*)::int as n from people`);
    expect(n[0]?.n).toBe(3);
  });

  it("perCompany and companies cap the list", async () => {
    const { stats } = await seedDemo(db(), deps, {
      agency: "northside.example",
      companies: 1,
      perCompany: 1,
      today,
    });
    expect(stats).toMatchObject({ customersUsed: 1, people: 1 });
  });
});
