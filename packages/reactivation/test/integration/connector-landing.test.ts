/**
 * A connected app's people through the CRM import (designs/2026-10-09-connectors.md): a household
 * with no company is its own account, a second read updates the same row, and the sync finds its
 * people's email and phone by the app's id. Synthetic data only.
 */
import { peopleCsv } from "@wren/connectors";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crmLanding } from "../../src/crm/landing.js";
import { crmContacts } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});

const pat = {
  id: "7",
  firstName: null,
  lastName: null,
  fullName: "Pat Doe",
  email: "pat@example.test",
  phone: "+1 416 555 0100",
  company: "Pat Doe",
  website: null,
  title: null,
  status: null,
  created: "2026-10-02T00:00:00Z",
  lastContacted: null,
};
const csv = (p: typeof pat) => new TextEncoder().encode(peopleCsv([p]));

describe("crmLanding", () => {
  it("lands a household and updates it in place", async () => {
    await crmLanding.land(pg.db, { format: "quickbooks", ref: "quickbooks:1:a", csv: csv(pat) });
    await crmLanding.land(pg.db, {
      format: "quickbooks",
      ref: "quickbooks:1:b",
      csv: csv({ ...pat, phone: "+1 416 555 0199" }),
    });
    const rows = await pg.db.select().from(crmContacts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ format: "quickbooks", crmKey: "7", addedOn: "2026-10-02" });
    expect(await crmLanding.contacts(pg.db, "quickbooks", ["7", "8"])).toEqual([
      { id: "7", email: "pat@example.test", phone: "+1 416 555 0199" },
    ]);
  });
});
