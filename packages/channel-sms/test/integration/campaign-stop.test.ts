/**
 * A race won in a metro campaign finishes the person's SMS contacts in it and skips their queued
 * sequence and follow-up texts; answers still go (designs/2026-11-02-campaigns.md, phase 4).
 * Synthetic data only.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { asc } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stopCampaignTexts } from "../../src/deliver.js";
import { type SmsContact, smsContacts, smsMessages } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const NOW = new Date("2026-11-02T12:00:00Z");

async function contact(e164: string, campaign: string | null, state: SmsContact["state"]) {
  const [c] = await pg.db
    .insert(smsContacts)
    .values({ e164, sourceKind: "form", sourceRef: e164, basis: "opt_in", state, campaign })
    .returning({ id: smsContacts.id });
  return c?.id as number;
}

const text = (contactId: number, kind: "sequence" | "follow_up" | "text_back") => ({
  contactId,
  direction: "out" as const,
  kind,
  toE164: "+15550000000",
  body: kind,
  step: kind === "sequence" ? 1 : null,
  state: "queued" as const,
});

describe("stopCampaignTexts", () => {
  it("finishes contacts in the won campaign and skips their sequence and follow-up texts", async () => {
    const a = await contact("+15550000001", "spring", "enrolled");
    const b = await contact("+15550000002", null, "enrolled");
    await pg.db
      .insert(smsMessages)
      .values([
        text(a, "sequence"),
        text(a, "follow_up"),
        text(a, "text_back"),
        text(b, "sequence"),
      ]);

    const n = await stopCampaignTexts(pg.db, {
      campaign: "spring",
      phones: ["+15550000001", "+15550000002"],
      persons: [],
      why: "race r won by payment",
      now: NOW,
    });
    expect(n).toBe(1);
    expect(
      await pg.db
        .select({ id: smsContacts.id, state: smsContacts.state })
        .from(smsContacts)
        .orderBy(asc(smsContacts.id)),
    ).toEqual([
      { id: a, state: "finished" },
      { id: b, state: "enrolled" },
    ]);
    expect(
      await pg.db
        .select({ kind: smsMessages.kind, state: smsMessages.state })
        .from(smsMessages)
        .orderBy(asc(smsMessages.id)),
    ).toEqual([
      { kind: "sequence", state: "skipped" },
      { kind: "follow_up", state: "skipped" },
      { kind: "text_back", state: "queued" },
      { kind: "sequence", state: "queued" },
    ]);
  });
});
