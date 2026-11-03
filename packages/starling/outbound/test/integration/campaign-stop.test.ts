/**
 * A race won in a metro campaign ends the person's reach contacts in it and skips their queued
 * sends; an operator's own message stays (designs/2026-11-02-campaigns.md, phase 4). Synthetic
 * data only.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { addAccount, setAccountState } from "@wren/starling-acts";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addProspects, contactByHandle, stopCampaignContacts } from "../../src/contacts.js";
import { type ContactState, reachContacts, reachMessages } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const NOW = new Date("2026-11-02T12:00:00Z");

describe("stopCampaignContacts", () => {
  it("ends live contacts in the won campaign and skips their sends", async () => {
    const a = await addAccount(pg.db, { platform: "linkedin", account: "linkedin@wren", now: NOW });
    await setAccountState(pg.db, a.id, "active", { reason: null, now: NOW });
    const handles = ["ann-test", "bo-test", "cy-test"];
    await addProspects(
      pg.db,
      "linkedin",
      handles.map((h) => ({
        handle: h,
        url: `https://example.com/in/${h}`,
        name: null,
        headline: null,
        foundIn: "people",
      })),
    );
    const set = async (h: string, campaign: string | null, state: ContactState) => {
      const c = await contactByHandle(pg.db, "linkedin", h);
      await pg.db.update(reachContacts).set({ campaign, state }).where(eq(reachContacts.id, c.id));
      return c.id;
    };
    // ann: live in spring; bo: spring, sequence done, a follow-up queued; cy: another campaign.
    const ann = await set("ann-test", "spring", "enrolled");
    const bo = await set("bo-test", "spring", "finished");
    const cy = await set("cy-test", "autumn", "enrolled");
    const send = (contactId: number, kind: "sequence" | "manual" | "follow_up") => ({
      contactId,
      accountId: a.id,
      direction: "out" as const,
      kind,
      body: "hi",
      state: "queued" as const,
      dueAt: NOW,
    });
    await pg.db
      .insert(reachMessages)
      .values([
        send(ann, "sequence"),
        send(ann, "manual"),
        send(bo, "follow_up"),
        send(cy, "sequence"),
      ]);

    const n = await stopCampaignContacts(pg.db, {
      campaign: "spring",
      handles: handles.map((handle) => ({ platform: "linkedin", handle })),
      persons: [],
      why: "race r won by reply",
      now: NOW,
    });
    expect(n).toBe(1);
    const contacts = await pg.db
      .select({ id: reachContacts.id, state: reachContacts.state, why: reachContacts.stateReason })
      .from(reachContacts)
      .orderBy(asc(reachContacts.id));
    expect(contacts).toEqual([
      { id: ann, state: "finished", why: "race r won by reply" },
      { id: bo, state: "finished", why: null },
      { id: cy, state: "enrolled", why: null },
    ]);
    const sends = await pg.db
      .select({ to: reachMessages.contactId, kind: reachMessages.kind, state: reachMessages.state })
      .from(reachMessages)
      .orderBy(asc(reachMessages.id));
    expect(sends).toEqual([
      { to: ann, kind: "sequence", state: "skipped" },
      { to: ann, kind: "manual", state: "queued" },
      { to: bo, kind: "follow_up", state: "skipped" },
      { to: cy, kind: "sequence", state: "queued" },
    ]);
  });
});
