/**
 * One person, one race won, every channel stopped at once: the worker's `stopCampaign` finds the
 * person by their profile's keys and ends their email enrollment, reach contact and SMS contact
 * in that campaign, leaving another person's rows in the same campaign alone
 * (designs/2026-11-02-campaigns.md, phase 4). Each channel's own test covers its edge cases;
 * this one proves the three meet. Synthetic data only.
 */
import { companies } from "@wren/core";
import { resolveProfile } from "@wren/core/profiles";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { addAccount, setAccountState } from "@wren/starling-acts";
import { addProspects, contactByHandle } from "@wren/starling-conversations";
import { reachContacts, reachMessages } from "@wren/starling-conversations/schema";
import { enrollments } from "@wren/starling-email/schema";
import { smsContacts, smsMessages } from "@wren/starling-sms/schema";
import { stopCampaign } from "@wren/worker/campaign-stop";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const NOW = new Date("2026-11-02T12:00:00Z");
const EMAIL = "ann@one.example";
const PHONE = "+15550000001";
const HANDLE = "ann-test";

// One active enrollment per address, so the email control is another person in the same campaign.
async function enroll(email: string, campaign: string | null) {
  const [co] = await pg.db
    .insert(companies)
    .values({ domain: `${email.split("@")[0]}.example`, name: email, raw: {} })
    .returning();
  if (!co) throw new Error("no company");
  const [e] = await pg.db
    .insert(enrollments)
    .values({
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
    })
    .returning({ id: enrollments.id });
  return e?.id as number;
}

// One enrolled contact per number: the SMS control is another number in the same campaign.
async function text(e164: string, campaign: string | null) {
  const [c] = await pg.db
    .insert(smsContacts)
    .values({
      e164,
      sourceKind: "form",
      sourceRef: e164,
      basis: "opt_in",
      state: "enrolled",
      campaign,
    })
    .returning({ id: smsContacts.id });
  const id = c?.id as number;
  await pg.db.insert(smsMessages).values({
    contactId: id,
    direction: "out",
    kind: "sequence",
    toE164: e164,
    body: "hi",
    step: 1,
    state: "queued",
  });
  return id;
}

describe("stopCampaign", () => {
  it("stops one person's email, reach and SMS rows in the won campaign, nobody else's", async () => {
    // One profile holds all three addresses.
    const got = await resolveProfile(
      pg.db,
      [
        { kind: "email", value: EMAIL },
        { kind: "phone", value: PHONE },
        { kind: "handle:linkedin", value: HANDLE },
      ],
      "test",
    );
    if (!got) throw new Error("no profile");

    const inSpring = await enroll(EMAIL, "spring");
    const other = await enroll("bo@two.example", "spring");
    const textSpring = await text(PHONE, "spring");
    const textOther = await text("+15550000002", "spring");

    // Reach: one contact per handle, so the person's one contact sits in spring.
    const a = await addAccount(pg.db, { platform: "linkedin", account: "linkedin@wren", now: NOW });
    await setAccountState(pg.db, a.id, "active", { reason: null, now: NOW });
    await addProspects(pg.db, "linkedin", [
      {
        handle: HANDLE,
        url: `https://example.com/in/${HANDLE}`,
        name: null,
        headline: null,
        foundIn: "people",
      },
    ]);
    const contact = await contactByHandle(pg.db, "linkedin", HANDLE);
    await pg.db
      .update(reachContacts)
      .set({ campaign: "spring", state: "enrolled" })
      .where(eq(reachContacts.id, contact.id));
    await pg.db.insert(reachMessages).values({
      contactId: contact.id,
      accountId: a.id,
      direction: "out",
      kind: "sequence",
      body: "hi",
      state: "queued",
      dueAt: NOW,
    });

    await stopCampaign(
      pg.db,
      { profile: got.id, campaign: "spring", gate: "g", cause: { kind: "booking", ref: "x" } },
      NOW,
    );

    expect(
      await pg.db
        .select({ id: enrollments.id, state: enrollments.state, why: enrollments.stopReason })
        .from(enrollments)
        .orderBy(asc(enrollments.id)),
    ).toEqual([
      { id: inSpring, state: "stopped", why: "booked" },
      { id: other, state: "active", why: null },
    ]);
    expect(
      await pg.db
        .select({ id: smsContacts.id, state: smsContacts.state })
        .from(smsContacts)
        .orderBy(asc(smsContacts.id)),
    ).toEqual([
      { id: textSpring, state: "finished" },
      { id: textOther, state: "enrolled" },
    ]);
    expect(
      await pg.db
        .select({ to: smsMessages.contactId, state: smsMessages.state })
        .from(smsMessages)
        .orderBy(asc(smsMessages.id)),
    ).toEqual([
      { to: textSpring, state: "skipped" },
      { to: textOther, state: "queued" },
    ]);
    expect(
      await pg.db
        .select({ state: reachContacts.state, why: reachContacts.stateReason })
        .from(reachContacts)
        .where(eq(reachContacts.id, contact.id)),
    ).toEqual([{ state: "finished", why: "race g won by booking" }]);
    expect(await pg.db.select({ state: reachMessages.state }).from(reachMessages)).toEqual([
      { state: "skipped" },
    ]);
  });
});
