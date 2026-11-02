/**
 * The `lead_sheet` view against real rows: one row per lead, the person through
 * its candidate, the newest verdict, role vs person, and each company column's
 * fallback (LinkedIn page, then the import, then the homepage), and the
 * contact points the firm publishes.
 */
import { companies, leads } from "@wren/core";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { contactPoints, documents, findings } from "@wren/research/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { verifications } from "../../src/schema.js";
import { leadSheet } from "../../src/views.js";
import { makeBatch, makeCompany, makePerson, TABLES } from "./compose-fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, TABLES));
const db = (): Db => pg.db;

const sheet = () => db().select().from(leadSheet).orderBy(leadSheet.leadId);

async function roleLead(companyId: number, email: string) {
  const [row] = await db()
    .insert(leads)
    .values({ email, status: "verified", raw: {}, importId: await makeBatch(db()), companyId })
    .returning();
  return row as { id: number };
}

describe("lead_sheet", () => {
  it("a person's lead: name, title, address, newest verdict, LinkedIn page columns first", async () => {
    const oak = await makeCompany(db(), {
      raw: { geo: "Springfield, ZZ", overture: { categories: { primary: "financial_service" } } },
    });
    const jane = await makePerson(db(), oak, {
      title: "Founder",
      email: "jane@oakbridge.example",
      verifiedCheckedAt: new Date("2026-09-01T12:00:00Z"),
    });
    await db()
      .insert(findings)
      .values({
        kind: "profile",
        companyId: oak.id,
        factKey: "profile:test",
        value: {
          industry: "Financial Services",
          location: "Shelbyville, ZZ",
          description: "We plan.",
        },
        confidence: 0.9,
        via: "exa-cache",
      });
    const [row, ...rest] = await sheet();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      niche: "sec_ria",
      personId: jane.id,
      personName: "Jane Doe",
      resultTitle: "Founder",
      email: "jane@oakbridge.example",
      validEmailOn: "2026-09-01",
      emailType: "person",
      mailStatus: "ok",
      companyName: "Acme Advisors",
      companyDomain: "oakbridge.example",
      companyLocation: "Shelbyville, ZZ",
      industry: "Financial Services",
      description: "We plan.",
    });
  });

  it("a newer risky verdict wins; a role inbox has no person and reads as role", async () => {
    const oak = await makeCompany(db());
    await makePerson(db(), oak, {
      email: "jane@oakbridge.example",
      verifiedCheckedAt: new Date("2026-08-01T00:00:00Z"),
    });
    const [lead] = await db().select().from(leads).where(eq(leads.email, "jane@oakbridge.example"));
    await db()
      .insert(verifications)
      .values({
        leadId: (lead as { id: number }).id,
        email: "jane@oakbridge.example",
        verifier: "test",
        result: "catch_all",
        raw: {},
        checkedAt: new Date("2026-09-02T00:00:00Z"),
      });
    await roleLead(oak.id, "Info+web@oakbridge.example");
    const [person, role] = await sheet();
    expect(person).toMatchObject({ mailStatus: "risky", validEmailOn: "2026-09-02" });
    expect(role).toMatchObject({
      personId: null,
      personName: null,
      emailType: "role",
      mailStatus: "unchecked",
      validEmailOn: null,
    });
  });

  it("no LinkedIn page: location, industry from the import, description from the homepage", async () => {
    const sba = await makeCompany(db(), {
      domain: "elmstreet.example",
      raw: { geo: "Ogdenville, ZZ", sba: { naics_primary: "523930" } },
    });
    await roleLead(sba.id, "hello@elmstreet.example");
    await db()
      .insert(documents)
      .values([
        {
          companyId: sba.id,
          kind: "webpage" as const,
          contentHash: "test",
          text: "",
          url: "https://elmstreet.example/about-our-team",
          html: '<meta name="description" content="Deep page">',
        },
        {
          companyId: sba.id,
          kind: "webpage" as const,
          contentHash: "test",
          text: "",
          url: "https://elmstreet.example/",
          html: '<head><meta content=" Plans for families. " name="description"></head>',
        },
      ]);
    const [row] = await sheet();
    expect(row).toMatchObject({
      companyLocation: "Ogdenville, ZZ",
      industry: "NAICS 523930",
      description: "Plans for families.",
    });
  });

  it("a moved-on person's still-there title fills in when people.title is empty", async () => {
    const oak = await makeCompany(db());
    const jane = await makePerson(db(), oak, { title: "", email: "jane@oakbridge.example" });
    await db()
      .insert(findings)
      .values({
        kind: "still_there",
        personId: jane.id,
        factKey: "still:test",
        value: { company: "Acme Advisors", title: "Principal" },
        confidence: 0.9,
        via: "exa-cache",
      });
    const [row] = await sheet();
    expect(row?.resultTitle).toBe("Principal");
  });

  it("published points fill phone, socials and both LinkedIn links; a trusted link wins", async () => {
    const oak = await makeCompany(db());
    const jane = await makePerson(db(), oak, { email: "jane@oakbridge.example" });
    const point = (
      kind: string,
      value: string,
      more: { pages?: number; source?: string } = {},
    ) => ({
      companyId: oak.id,
      kind: kind as "phone",
      value,
      source: (more.source ?? "link") as "link",
      pages: more.pages ?? 1,
      sourceUrl: "https://oakbridge.example/",
    });
    await db()
      .insert(contactPoints)
      .values([
        point("phone", "+18005550100", { pages: 9 }),
        point("phone", "+12125550187", { source: "text", pages: 3 }),
        point("phone", "+13125550111", { pages: 2 }),
        point("linkedin_company", "https://www.linkedin.com/company/oak/", { pages: 5 }),
        point("linkedin_company", "https://www.linkedin.com/company/partner/"),
        point("instagram", "https://www.instagram.com/oak/"),
        point("x", "https://x.com/oakold"),
        point("x", "https://x.com/oak", { pages: 4 }),
        { ...point("linkedin_person", "https://www.linkedin.com/in/janedoe/"), personId: jane.id },
      ]);
    const [row] = await sheet();
    expect(row).toMatchObject({
      phone: "+13125550111",
      companyLinkedin: "https://www.linkedin.com/company/oak/",
      linkedinUrl: "https://www.linkedin.com/in/janedoe/",
      socials: "https://www.instagram.com/oak/ https://x.com/oak",
    });

    // A number on six firms' sites is a seller's or a host's: nobody's own.
    for (let i = 0; i < 6; i++) {
      const other = i ? (await makeCompany(db(), { domain: `other${i}.example` })).id : oak.id;
      await db()
        .insert(contactPoints)
        .values({ ...point("phone", "+13125550999", { pages: 50 }), companyId: other });
    }
    expect((await sheet())[0]?.phone).toBe("+13125550111");

    await db()
      .update(companies)
      .set({ linkedinUrl: "https://www.linkedin.com/company/oak-trusted/" });
    expect((await sheet())[0]?.companyLinkedin).toBe(
      "https://www.linkedin.com/company/oak-trusted/",
    );
  });
});
