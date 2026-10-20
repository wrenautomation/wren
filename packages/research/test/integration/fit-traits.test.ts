/**
 * What the light read gathers to score a person's fit to an ICP, on a real Postgres: the title,
 * the firm's niche and country, the people map's seniority and size. A missing trait stays out.
 * Synthetic data only.
 */
import { resolveProfile } from "@wren/core/profiles";
import { companies, people } from "@wren/core/schema";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fitTraitsOf, readProfileFacts } from "../../src/people/index.js";
import { makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

/** A profile that names a person at a firm; the rollup row is optional. */
async function made(o: {
  niche?: string | null;
  country?: string | null;
  title?: string | null;
  persona?: { role: string; niche: string; size: string };
  key: string;
}) {
  const company = await makeCompany(pg.db, {
    key: o.key,
    domain: `${o.key}.example`,
    name: "Acme Dental",
    niche: o.niche ?? null,
  });
  if (o.country)
    await pg.db.update(companies).set({ country: o.country }).where(eq(companies.id, company.id));
  const [person] = await pg.db
    .insert(people)
    .values({
      companyId: company.id,
      fullName: "Ada North",
      title: o.title ?? null,
      isCompliance: false,
      origin: "website",
      originRef: "https://firm.example/team",
      raw: {},
    })
    .returning();
  if (!person) throw new Error("no person");
  const r = await resolveProfile(pg.db, [{ kind: "person", value: String(person.id) }], "test", {
    name: "Ada North",
  });
  if (!r) throw new Error("no profile");
  if (o.persona)
    await pg.db.execute(sql`
      insert into profile_rollups (profile_id, stage, warmth, persona, persona_role, persona_niche, persona_size)
      values (${r.id}, 'lead', 'cold', ${`${o.persona.niche} ${o.persona.role}`}, ${o.persona.role},
        ${o.persona.niche}, ${o.persona.size})`);
  return r.id;
}

const traits = async (profile: number) =>
  fitTraitsOf(pg.db, profile, await readProfileFacts(pg.db, profile));

describe("fitTraitsOf", () => {
  it("reads the title, the firm's niche and country and the persona", async () => {
    const id = await made({
      key: "t1",
      niche: "dental",
      country: "US",
      title: "Owner",
      persona: { role: "owner", niche: "dental", size: "mid" },
    });
    expect(await traits(id)).toEqual({
      roles: ["Owner", "owner"],
      industries: ["dental"],
      size: "mid",
      regions: ["US"],
      about: [
        "Role: Owner at Acme Dental",
        "Seniority: owner",
        "Industry: dental",
        "Company size: mid",
        "Country: US",
      ],
    });
  });

  it("leaves out what is not known, and says nothing about a person it knows nothing of", async () => {
    const some = await made({
      key: "t2",
      title: "Manager",
      persona: { role: "unknown", niche: "unknown", size: "unknown" },
    });
    expect(await traits(some)).toEqual({
      roles: ["Manager"],
      about: ["Role: Manager at Acme Dental"],
    });
    const bare = await resolveProfile(pg.db, [{ kind: "email", value: "x@example.test" }], "test");
    if (!bare) throw new Error("no profile");
    expect(await traits(bare.id)).toEqual({ about: [] });
  });

  it("falls to the persona niche when the firm has none", async () => {
    const id = await made({
      key: "t3",
      persona: { role: "staff", niche: "recruiting", size: "small" },
    });
    expect(await traits(id)).toMatchObject({
      industries: ["recruiting"],
      size: "small",
      roles: ["staff"],
    });
  });
});
