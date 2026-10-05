/** recruiting_facts → factsForCompany → the book-first opener: a stored research line never reaches the email. */
import { CALL_TIMES, factsForCompany, linkFacts, render } from "@wren/channel-email";
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

const LINE = "A line about the firm from research.";

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
  return render(tpl, { ...facts.values, ...offer, ...links, "call.times": CALL_TIMES }, "c:1").body;
};

describe("recruiting opener through the facts view", () => {
  it("the niche reads recruiting_facts", () => {
    expect(recruiting.factsView).toBe("recruiting_facts");
  });

  it("a stored line stays out: personalization is templated (William, 2026-10-05)", async () => {
    const lined = await email(await firm("lined.example", LINE));
    const bare = await email(await firm("bare.example", null));
    expect(lined).not.toContain(LINE);
    expect(lined).toBe(bare);
    expect(bare).toMatch(/^Hi there,\n\nI've /);
  });
});
