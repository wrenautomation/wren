/** recruiting_facts → factsForCompany → the reactivation opener: the stored line reaches the email. */
import { factsForCompany, linkFacts, render } from "@wren/channel-email";
import { companies } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { enrichments } from "@wren/research/schema";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recruiting } from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["imports", "companies"]));
const db = () => pg.db;

const LINE = "You have placed ICU nurses in Tulsa hospitals since 1999.";

async function firm(domain: string, line: string | null): Promise<number> {
  const [row] = await db()
    .insert(companies)
    .values({ domain, name: "Tulsa Nurse Partners", niche: "recruiting", raw: {} })
    .returning({ id: companies.id });
  const id = (row as { id: number }).id;
  await db()
    .insert(enrichments)
    .values({
      companyId: id,
      kind: "opener",
      model: "fake",
      promptVersion: "v1",
      output: {
        parse_error: null,
        opener: line === null ? null : { line, quote: "q", source_url: "u" },
        rejected: null,
      },
    });
  return id;
}

const email = async (companyId: number) => {
  const facts = await factsForCompany(db(), companyId, "recruiting_facts");
  const tpl = recruiting.templates.get("book-first/opener");
  if (!tpl) throw new Error("missing template");
  const links = linkFacts(
    "https://wrenautomation.com",
    "reactivation",
    facts.values,
    {},
    "code0001",
  );
  const offer = recruiting.offerFacts.get("reactivation");
  return render(tpl, { ...facts.values, ...offer, ...links }, "c:1").body;
};

describe("recruiting opener through the facts view", () => {
  it("the niche reads recruiting_facts", () => {
    expect(recruiting.factsView).toBe("recruiting_facts");
  });

  it("a stored line opens the email; no line leaves no gap", async () => {
    const lined = await email(await firm("lined.example", LINE));
    expect(lined.startsWith(`Hi there,\n\n${LINE}\n\nThis address is listed`)).toBe(true);
    const bare = await email(await firm("bare.example", null));
    expect(bare.startsWith("Hi there,\n\nThis address is listed")).toBe(true);
    expect(bare).not.toMatch(/\n{3,}/);
  });
});
