/**
 * Onboarding reads a stored terms version when the plan has one live today, and records which.
 * With none stored the terms are computed from the offer's price, as before. Synthetic amounts.
 */
import { clients } from "@wren/core/clients";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { offerFor } from "@wren/offers";
import { addTerms } from "@wren/pipeline/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agreementOf, engagementOf, onboard, termsFor, todayUtc } from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values(
    ["one", "two", "three", "four"].map((id) => ({
      id,
      name: `Client ${id}`,
      database: `wren_client_${id}`,
    })),
  );
});
afterAll(() => pg.stop());

const start = (clientId: string, over?: { setupCents: number }) =>
  onboard(pg.db, {
    clientId,
    offerId: "reactivation",
    startsOn: todayUtc(),
    ...(over ? { terms: over } : {}),
    by: "ops@wren.example",
  });

describe("terms version on an agreement", () => {
  it("is null and the terms are computed when no version is stored", async () => {
    const { agreement } = await start("one");
    expect(agreement.termsVersion).toBeNull();
    expect(agreement.terms).toEqual(termsFor(offerFor("reactivation")));
    const e = await engagementOf(pg.db, "one");
    expect((await agreementOf(pg.db, e))?.termsVersion).toBeNull();
  });

  it("follows the live stored version and records it", async () => {
    const stored = termsFor(offerFor("reactivation"), { setupCents: 12_345 });
    const row = await addTerms(pg.db, {
      offer: "reactivation",
      plan: "standard",
      from: "2020-01-01",
      body: stored,
      why: "test",
      by: "t",
    });
    const { agreement } = await start("two");
    expect(agreement.terms.setupCents).toBe(12_345);
    expect(agreement.termsVersion).toBe(row.id);
  });

  it("keeps the operator's change on top, and then names no version", async () => {
    const { agreement } = await start("three", { setupCents: 99 });
    expect(agreement.terms.setupCents).toBe(99);
    expect(agreement.termsVersion).toBeNull();
  });

  it("ignores a version that starts later", async () => {
    await addTerms(pg.db, {
      offer: "reactivation",
      plan: "standard",
      from: "2999-01-01",
      body: termsFor(offerFor("reactivation"), { setupCents: 777 }),
      why: "later",
      by: "t",
    });
    const { agreement } = await start("four");
    expect(agreement.terms.setupCents).toBe(12_345);
  });
});
