/**
 * A race won in a metro campaign stops the person's active enrollments in that campaign only
 * (designs/2026-11-02-campaigns.md, phase 4). Synthetic data only.
 */
import { companies } from "@wren/core";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { asc } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enrollments } from "../../src/schema.js";
import { stopCampaignEnrollments } from "../../src/send/stops.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const NOW = new Date("2026-11-02T12:00:00Z");

async function enrolled(email: string, campaign: string | null) {
  const [co] = await pg.db
    .insert(companies)
    .values({ domain: `${email.split("@")[0]}.example`, name: email, raw: {} })
    .returning();
  if (!co) throw new Error("no company");
  await pg.db.insert(enrollments).values({
    companyId: co.id,
    kind: "role_inbox",
    toEmail: email,
    sender: "me@sender.example",
    niche: "test",
    sequenceName: "seq",
    sequenceSnapshot: { name: "seq", steps: [] },
    offer: "test-offer",
    state: "active",
    campaign,
  });
}

describe("stopCampaignEnrollments", () => {
  it("stops the person's rows in the won campaign, by address, and no other", async () => {
    await enrolled("a@one.example", "spring");
    await enrolled("b@two.example", null);
    await enrolled("c@three.example", "spring");
    const at = { persons: [], now: NOW, detail: "race r won by booking" };

    const n = await stopCampaignEnrollments(pg.db, {
      ...at,
      campaign: "spring",
      emails: ["A@one.example", "b@two.example"],
      reason: "booked",
    });
    expect(n).toBe(1);
    // The default campaign is its own: null matches only null.
    expect(
      await stopCampaignEnrollments(pg.db, {
        ...at,
        campaign: null,
        emails: ["b@two.example"],
        reason: "reply",
      }),
    ).toBe(1);
    const rows = await pg.db
      .select({ to: enrollments.toEmail, state: enrollments.state, why: enrollments.stopReason })
      .from(enrollments)
      .orderBy(asc(enrollments.id));
    expect(rows).toEqual([
      { to: "a@one.example", state: "stopped", why: "booked" },
      { to: "b@two.example", state: "stopped", why: "reply" },
      { to: "c@three.example", state: "active", why: null },
    ]);
    expect(
      await stopCampaignEnrollments(pg.db, {
        ...at,
        campaign: "spring",
        emails: [],
        reason: "manual",
      }),
    ).toBe(0);
  });
});
