/** A lead form's consent box as marketing consent, on Postgres. Synthetic leads only. */
import { mayMarket, withdrawConsent } from "@wren/core/marketing";
import { consentEvents, topics } from "@wren/core/schema";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Lead } from "../../src/ads.js";
import { consentFromLeads } from "../../src/consent.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [
    "consent_events",
    "consents",
    "topics",
    "suppression_events",
    "suppressions",
  ]);
  await pg.db.insert(topics).values({
    name: "weekly-breakdown",
    publicName: "Weekly breakdown",
    line: "One short email a week.",
    channel: "email",
    cadence: "weekly",
  });
});

const lead = (id: string, email: string, checked: boolean | string | null): Lead => ({
  id,
  created_time: "2026-10-01T12:00:00+0000",
  ad_id: "ad1",
  field_data: [{ name: "email", values: [email] }],
  ...(checked === null
    ? {}
    : { custom_disclaimer_responses: [{ checkbox_key: "news", is_checked: checked }] }),
});
const FORM = {
  formId: "f1",
  topic: "weekly-breakdown",
  checkbox: "news",
  text: "Email me the weekly breakdown.",
};
const may = (address: string) =>
  mayMarket(pg.db, { channel: "email", address, topic: "weekly-breakdown" });

describe("consentFromLeads", () => {
  it("records ticked boxes with the form as proof, skips the rest, and never re-subscribes", async () => {
    const leads = [
      lead("l1", "Ann@Example.com", true),
      lead("l2", "bo@example.com", "1"),
      lead("l3", "cy@example.com", false),
      lead("l4", "dee@example.com", null),
      lead("l5", "not an email", true),
    ];
    expect(await consentFromLeads(pg.db, leads, FORM)).toEqual({ given: 2, skipped: 3 });
    expect((await may("ann@example.com")).send).toBe(true);
    expect((await may("cy@example.com")).send).toBe(false);
    const [proof] = await pg.db.select().from(consentEvents).limit(1);
    expect(proof?.evidence).toMatchObject({ form: "f1", checkbox: "news", text: FORM.text });

    // Ann leaves; pulling the form again must not put her back.
    await withdrawConsent(pg.db, {
      channel: "email",
      address: "ann@example.com",
      topic: "weekly-breakdown",
      by: "subscriber",
    });
    expect(await consentFromLeads(pg.db, leads, FORM)).toEqual({ given: 0, skipped: 5 });
    expect((await may("ann@example.com")).send).toBe(false);
  });
});
