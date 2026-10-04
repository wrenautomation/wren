/**
 * Cross-checks against real rows: `recheckLeads` writes one row per check,
 * `lead_sheet` folds them into `checks` and `verified`, and compose never takes
 * a wrong person.
 */
import { leads } from "@wren/core";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { findings } from "@wren/research/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { nextToEnroll } from "../../src/outreach/compose.js";
import { leadChecks } from "../../src/schema.js";
import { recheckLeads, recheckNiche } from "../../src/verification/lead-checks.js";
import { leadSheet } from "../../src/views.js";
import {
  makeBatch,
  makeCompany,
  makePerson,
  runCompose,
  TABLES,
  VERIFICATION_HORIZON_DAYS,
} from "./compose-fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, TABLES));
const db = (): Db => pg.db;

const stillThere = (personId: number, title: string) =>
  db()
    .insert(findings)
    .values({
      kind: "still_there",
      personId,
      factKey: `p${personId}:still_there`,
      value: { title },
      confidence: 0.9,
      via: "exa-cache",
    });

async function roleLead(companyId: number, email: string) {
  const [row] = await db()
    .insert(leads)
    .values({ email, status: "verified", raw: {}, importId: await makeBatch(db()), companyId })
    .returning();
  return row as { id: number };
}

const checksOf = async (leadId: number) =>
  Object.fromEntries(
    (await db().select().from(leadChecks).where(eq(leadChecks.leadId, leadId))).map((r) => [
      r.kind,
      r.result,
    ]),
  );

const sheetRow = async (email: string) =>
  (await db().select().from(leadSheet).where(eq(leadSheet.email, email)))[0];

describe("recheckLeads", () => {
  it("writes every check per lead; the sheet folds them into checks and verified", async () => {
    const oak = await makeCompany(db());
    const jane = await makePerson(db(), oak, {
      title: "Founder",
      email: "jane.doe@oakbridge.example",
    });
    await stillThere(jane.id, "Founder");
    // Bob's address is Jane's pattern: the wrong person at a live mailbox.
    await makePerson(db(), oak, {
      full: "Bob Roe",
      first: "Bob",
      email: "jdoe@oakbridge.example",
    });
    const info = await roleLead(oak.id, "info@oakbridge.example");

    const stats = await recheckLeads(db(), [oak.id]);
    expect(stats).toEqual({ companies: 1, leads: 3, wrong_person: 1 });

    const janeRow = await sheetRow("jane.doe@oakbridge.example");
    expect(janeRow?.verified).toBe("yes");
    expect(janeRow?.checks).toBe("mail ok · fits name · firm domain · works there · title agrees");
    expect(await checksOf(janeRow?.leadId ?? 0)).toMatchObject({
      mailbox_fits_name: "pass",
      domain_is_firm: "pass",
      works_there: "pass",
      title_agrees: "pass",
      page_is_firm: "unknown",
      phone_agrees: "unknown",
    });

    const bobRow = await sheetRow("jdoe@oakbridge.example");
    expect(bobRow?.verified).toBe("wrong person");
    expect(bobRow?.checks).toContain("fits someone else");
    const [fit] = await db()
      .select()
      .from(leadChecks)
      .where(
        sql`${leadChecks.leadId} = ${bobRow?.leadId} AND ${leadChecks.kind} = 'mailbox_fits_name'`,
      );
    expect(fit?.evidence).toMatchObject({ fits_person_id: jane.id });

    // A role inbox skips the name check; with no person it is never "yes".
    expect(await checksOf(info.id)).not.toHaveProperty("mailbox_fits_name");
    expect((await sheetRow("info@oakbridge.example"))?.verified).toBe("partial");
    expect((await sheetRow("info@oakbridge.example"))?.checks).toContain("role inbox");
  });

  it("a rerun replaces results and drops a check that no longer applies", async () => {
    const oak = await makeCompany(db());
    const info = await roleLead(oak.id, "info@oakbridge.example");
    await db()
      .insert(leadChecks)
      .values({ leadId: info.id, kind: "mailbox_fits_name", result: "fail", evidence: {} });
    await recheckLeads(db(), [oak.id]);
    await recheckLeads(db(), [oak.id]);
    const kinds = Object.keys(await checksOf(info.id)).sort();
    expect(kinds).toEqual([
      "domain_is_firm",
      "page_is_firm",
      "phone_agrees",
      "title_agrees",
      "works_there",
    ]);
  });

  it("no firms, no query; a niche pages through every firm", async () => {
    expect(await recheckLeads(db(), [])).toEqual({ companies: 0, leads: 0, wrong_person: 0 });
    const oak = await makeCompany(db());
    const elm = await makeCompany(db(), { domain: "elmstreet.example", name: "Elm Advisors" });
    await makePerson(db(), oak, { email: "jane.doe@oakbridge.example" });
    await makePerson(db(), elm, { full: "Ann Poe", first: "Ann", email: "ann@elmstreet.example" });
    const chunks: unknown[] = [];
    const total = await recheckNiche(db(), "sec_ria", { chunk: 1, onChunk: (s) => chunks.push(s) });
    expect(total).toMatchObject({ companies: 2, leads: 2, wrong_person: 0 });
    expect(chunks).toHaveLength(2);
  });
});

describe("compose and the wrong person", () => {
  it("a mailbox that fits a colleague is never taken", async () => {
    const oak = await makeCompany(db());
    await makePerson(db(), oak, { full: "Jane Doe", first: "Jane" });
    const bob = await makePerson(db(), oak, {
      full: "Bob Roe",
      first: "Bob",
      email: "jane.doe@oakbridge.example",
    });
    const next = () =>
      nextToEnroll(db(), { niche: "sec_ria", verificationHorizonDays: VERIFICATION_HORIZON_DAYS });
    expect(await next()).toEqual([bob.id]);
    await recheckLeads(db(), [oak.id]);
    expect(await next()).toEqual([]);
    expect((await runCompose(db())).enrolled).toBe(0);
  });
});
