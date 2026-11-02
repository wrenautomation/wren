/** The email side of a dossier: a person's address with its verdict, the firm's own inboxes. */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailFacts } from "../../src/dossier.js";
import { makeCompany, makePerson, makeRoleLead, TABLES } from "./compose-fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, TABLES));

describe("emailFacts", () => {
  it("gives a person their address and verdict, and the firm only the inboxes nobody owns", async () => {
    const firm = await makeCompany(pg.db);
    const jane = await makePerson(pg.db, firm, { email: "jane@oakbridge.example" });
    await makeRoleLead(pg.db, firm, "info@oakbridge.example");
    const { byCompany, byPerson } = await emailFacts(pg.db, [firm.id], [jane.id]);
    expect(byPerson.get(jane.id)?.map((f) => [f.value, f.via])).toEqual([
      [
        {
          address: "jane@oakbridge.example",
          state: "verified",
          evidence: "scraped",
          rank: 0,
          verdict: "valid",
        },
        "test",
      ],
    ]);
    expect(byCompany.get(firm.id)?.map((f) => f.value)).toEqual([
      { address: "info@oakbridge.example", status: "imported", persona: null },
    ]);
    const none = await emailFacts(pg.db, [], []);
    expect([none.byCompany.size, none.byPerson.size]).toEqual([0, 0]);
  });
});
