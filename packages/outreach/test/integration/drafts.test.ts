/**
 * DM drafts and Message from People on Postgres with a fake model and a fixed clock: a waiting
 * thread is drafted once and again after a newer word; an accepted invite gets a first message;
 * a draft past the length cap is kept as none; a People id becomes a contact, written from
 * `reddit@wren`, and LinkedIn waits on an accepted invite.
 */

import { companies, people } from "@wren/core/schema";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount, setAccountState } from "../../src/accounts.js";
import { addProspects, contactByHandle, contactById } from "../../src/contacts.js";
import {
  contactsToDraft,
  DRAFT_MAX,
  DRAFTS_PER_DAY,
  draftDm,
  draftsToday,
  queueDraft,
} from "../../src/drafts.js";
import { messageAccount, personContact } from "../../src/from-people.js";
import { personRecord } from "../../src/records.js";
import { receive } from "../../src/replies.js";
import { type ReachAccount, reachContacts, reachMessages } from "../../src/schema.js";

const TABLES = [
  "reach_messages",
  "reach_contacts",
  "reach_accounts",
  "reddit_people",
  "people",
  "companies",
];
const NOW = new Date("2026-10-06T15:00:00Z");
const later = (min: number) => new Date(NOW.getTime() + min * 60_000);
const SENDER = "Sam";

let pg: TestPostgres;
const db = () => pg.db;
let reddit: ReachAccount;
let linkedin: ReachAccount;

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, TABLES);
  const r = await addAccount(db(), { platform: "reddit", account: "reddit@wren", now: NOW });
  reddit = await setAccountState(db(), r.id, "active", { reason: null, now: NOW });
  const l = await addAccount(db(), { platform: "linkedin", account: "linkedin@wren", now: NOW });
  linkedin = await setAccountState(db(), l.id, "active", { reason: null, now: NOW });
});

const inbound = (handle: string, ref: string, text: string, at: Date) =>
  receive(
    db(),
    "reddit",
    reddit.id,
    { ref, handle, name: null, text, at: at.toISOString(), threadUrl: null },
    at,
  );

/** A model that answers `draft` and keeps every prompt it was asked. */
const model = (draft: string) => {
  const asked: { prompt: string; system: string | undefined }[] = [];
  const llm = new FakeLlm({
    respond: (prompt, system) => {
      asked.push({ prompt, system });
      return JSON.stringify({ draft });
    },
  });
  return { llm, asked };
};

describe("DM drafts", () => {
  it("drafts a reply to their last word once, again after a newer one, never once answered", async () => {
    await inbound("jo_test", "m1", "How do you chase invoices?", NOW);
    const c = await contactByHandle(db(), "reddit", "jo_test");
    expect(await contactsToDraft(db(), DRAFTS_PER_DAY)).toEqual([c.id]);

    const { llm, asked } = model("We send them from the CRM. Happy to show you.");
    const draft = await draftDm(db(), llm, c.id, { sender: SENDER, now: NOW });
    expect(draft).toBe("We send them from the CRM. Happy to show you.");
    expect(asked[0]?.prompt).toContain("Them: How do you chase invoices?");
    expect(asked[0]?.system).toContain("Sam's next direct message on Reddit");
    expect(asked[0]?.system).toContain("No pitch");
    const kept = await contactById(db(), c.id);
    const [m1] = await db().select().from(reachMessages).where(eq(reachMessages.ref, "m1"));
    expect(kept).toMatchObject({ draft, draftFor: m1?.id });
    expect(await contactsToDraft(db(), DRAFTS_PER_DAY)).toEqual([]);

    // A newer word makes the draft stale: gone, and due again.
    await inbound("jo_test", "m2", "Also, what does it cost?", later(5));
    expect((await contactById(db(), c.id)).draft).toBeNull();
    expect(await contactsToDraft(db(), DRAFTS_PER_DAY)).toEqual([c.id]);

    // The SOP replaces the brief.
    const sop = model("It depends on volume.");
    await draftDm(db(), sop.llm, c.id, {
      sender: SENDER,
      guide: async () => "Lowercase only.",
      now: later(6),
    });
    expect(sop.asked[0]?.system).toContain("Lowercase only.");
    expect(sop.asked[0]?.system).not.toContain("No pitch");

    // Sent untouched: the console leaves the words out and the desk sends the draft it holds.
    const sent = await queueDraft(db(), await contactById(db(), c.id), undefined, null, later(6));
    expect(sent).toMatchObject({ body: "It depends on volume.", kind: "manual", state: "queued" });
    expect((await contactById(db(), c.id)).draft).toBeNull();
    await expect(
      queueDraft(db(), await contactById(db(), c.id), "  ", null, later(6)),
    ).rejects.toThrow(/empty/);
    await db().delete(reachMessages).where(eq(reachMessages.id, sent.id));

    // His reply answers it: nothing to draft.
    await db()
      .insert(reachMessages)
      .values({
        contactId: c.id,
        accountId: reddit.id,
        direction: "out",
        kind: "manual",
        body: "hi",
        state: "queued",
        createdAt: later(7),
      });
    await db().update(reachContacts).set({ draftFor: null }).where(eq(reachContacts.id, c.id));
    expect(await contactsToDraft(db(), DRAFTS_PER_DAY)).toEqual([]);
  });

  it("drafts a first message to an accepted invite; one past the cap is kept as none", async () => {
    await addProspects(db(), "linkedin", [
      { handle: "ana-test", url: "", name: "Ana Test", headline: "Founder", foundIn: "people" },
    ]);
    const c = await contactByHandle(db(), "linkedin", "ana-test");
    await db()
      .update(reachContacts)
      .set({ accountId: linkedin.id, state: "connected", connectedAt: NOW })
      .where(eq(reachContacts.id, c.id));
    await db().insert(reachMessages).values({
      contactId: c.id,
      accountId: linkedin.id,
      direction: "out",
      kind: "connect",
      body: "",
      state: "sent",
      sentAt: NOW,
    });
    expect(await contactsToDraft(db(), 0)).toEqual([]);
    expect(await contactsToDraft(db(), DRAFTS_PER_DAY)).toEqual([c.id]);

    const { llm, asked } = model("x".repeat(DRAFT_MAX + 1));
    expect(await draftDm(db(), llm, c.id, { sender: SENDER, now: NOW })).toBeNull();
    expect(asked[0]?.prompt).toContain("They just accepted my LinkedIn invite.");
    expect(asked[0]?.prompt).toContain("Headline: Founder");
    expect((await contactById(db(), c.id)).draftAt).toEqual(NOW);
    // Stamped: not asked again until something changes.
    expect(await contactsToDraft(db(), DRAFTS_PER_DAY)).toEqual([]);
    expect(await draftsToday(db(), later(60))).toBe(1);
  });
});

describe("Message from People", () => {
  it("adds the contact, writes from reddit@wren, and waits on an accepted invite on LinkedIn", async () => {
    const r = await personContact(db(), "reddit:cfo_test");
    expect(r).toMatchObject({ platform: "reddit", handle: "cfo_test", foundIn: "people" });
    expect((await messageAccount(db(), r, NOW)).id).toBe(reddit.id);
    // Asked again: the same contact, any case.
    expect((await personContact(db(), "reddit:CFO_test")).id).toBe(r.id);

    const [co] = await db()
      .insert(companies)
      .values({ domain: "acme-test.example", name: "Acme Test", niche: "recruiting" })
      .returning();
    const [p] = await db()
      .insert(people)
      .values({
        companyId: (co as { id: number }).id,
        fullName: "Lee Test",
        title: "Owner",
        isCompliance: false,
        origin: "website",
        originRef: "test",
        raw: {},
        linkedinUrl: "https://www.linkedin.com/in/Lee-Test/",
      })
      .returning();
    const pid = (p as { id: number }).id;
    const rows = (await personRecord.rows?.(db())) ?? [];
    expect(rows.find((x) => x.id === `li:${pid}`)).toMatchObject({ can: "invite" });
    expect(rows.find((x) => x.id === "reddit:cfo_test")).toBeUndefined();

    const l = await personContact(db(), `li:${pid}`);
    expect(l).toMatchObject({
      platform: "linkedin",
      handle: "lee-test",
      personId: pid,
      companyId: (co as { id: number }).id,
    });
    await expect(messageAccount(db(), l, NOW)).rejects.toThrow(/invite them first/);
    await db()
      .update(reachContacts)
      .set({ accountId: linkedin.id, state: "connected", connectedAt: NOW })
      .where(eq(reachContacts.id, l.id));
    const after = (await personRecord.rows?.(db())) ?? [];
    expect(after.find((x) => x.id === `li:${pid}`)).toMatchObject({ can: "message" });
    expect((await messageAccount(db(), await contactById(db(), l.id), NOW)).id).toBe(linkedin.id);

    await db().update(reachContacts).set({ state: "opted_out" }).where(eq(reachContacts.id, r.id));
    await expect(messageAccount(db(), await contactById(db(), r.id), NOW)).rejects.toThrow(
      /asked us to stop/,
    );
  });
});
