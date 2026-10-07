/**
 * Touches on Postgres (designs/2026-10-07-touches.md), synthetic people only: each writer keeps
 * its line under the person it resolves to, their reply marks ours, an accepted invite reads
 * accepted, the backfill keeps nothing twice, and an earlier touch reaches the DM prompt and the
 * compose facts.
 */

import { companies, imports, leads, people } from "@wren/core/schema";
import { lookupTouches, touchesFor, touchFactsFor } from "@wren/core/touches";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount, setAccountState } from "../../src/accounts.js";
import { keepComments, markAnswered } from "../../src/comments.js";
import { dmContext } from "../../src/drafts.js";
import { personContact } from "../../src/from-people.js";
import { markAccepted } from "../../src/invites.js";
import { markPostCommented } from "../../src/linkedin-posts.js";
import { personRecord } from "../../src/records.js";
import {
  linkedinPosts,
  type ReachAccount,
  reachContacts,
  reachMessages,
} from "../../src/schema.js";
import { backfillOutreachTouches, touchFromMessage } from "../../src/touches.js";

const TABLES = [
  "touches",
  "social_handles",
  "comments",
  "linkedin_posts",
  "reach_messages",
  "reach_contacts",
  "reach_accounts",
  "leads",
  "imports",
  "people",
  "companies",
];
const NOW = new Date("2026-10-07T15:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

let pg: TestPostgres;
const db = () => pg.db;
let reddit: ReachAccount;
let linkedin: ReachAccount;
let personId: number;
let leadId: number;

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
  const [co] = await db()
    .insert(companies)
    .values({ domain: "northwind-test.example", name: "Northwind Test", niche: "recruiting" })
    .returning();
  const [p] = await db()
    .insert(people)
    .values({
      companyId: (co as { id: number }).id,
      fullName: "Sam Test",
      title: "Owner",
      isCompliance: false,
      origin: "website",
      originRef: "test",
      raw: {},
      linkedinUrl: "https://www.linkedin.com/in/Sam-Test/",
    })
    .returning();
  personId = (p as { id: number }).id;
  const [batch] = await db()
    .insert(imports)
    .values({ sourceType: "test", sourceRef: "inline", stats: {} })
    .returning();
  const [lead] = await db()
    .insert(leads)
    .values({
      email: "sam@northwind-test.example",
      status: "verified",
      raw: {},
      importId: (batch as { id: number }).id,
      personId,
    })
    .returning();
  leadId = (lead as { id: number }).id;
});

/** Our comment on Sam's LinkedIn post, as his Comment click keeps it. */
async function commentOnTheirPost(at: Date) {
  const [post] = await db()
    .insert(linkedinPosts)
    .values({
      urn: "urn:li:activity:7001",
      author: "Sam Test",
      authorUrl: "https://www.linkedin.com/in/sam-test",
      text: "Placed three nurses this week.",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:7001/",
      foundBy: "person: sam-test",
      account: "linkedin@wren",
      state: "queued",
      draft: "Three in a week is quick.",
      raw: {},
    })
    .returning();
  await markPostCommented(db(), post as typeof linkedinPosts.$inferSelect, {
    body: "Three in a week is quick.",
    by: "william",
    now: at,
  });
}

describe("touches", () => {
  it("keeps each touch under the person, and their reply marks ours", async () => {
    await commentOnTheirPost(ago(10));

    // A Reddit comment on our post, our answer, and their reply under it.
    const item = (ref: string, parent: string, kind: string, text: string, at: Date) => ({
      ref,
      post: "t3_post1",
      parent,
      kind,
      place: "startups",
      postTitle: "How we chase invoices",
      handle: "Jo_Test",
      text,
      url: `https://www.reddit.com/r/startups/comments/post1/_/${ref.slice(3)}/`,
      at: at.toISOString(),
      raw: {},
    });
    const [first] = await keepComments(
      db(),
      reddit,
      [item("t1_c1", "t3_post1", "post_reply", "Do you use a CRM for this?", ago(6))],
      ["wren_test"],
    );
    await markAnswered(db(), (first as { id: number }).id, {
      body: "We send them from the CRM.",
      ref: "t1_ours1",
      now: ago(5),
    });
    await keepComments(
      db(),
      reddit,
      [item("t1_c2", "t1_ours1", "comment_reply", "Which CRM?", ago(4))],
      ["wren_test"],
    );

    const jo = await lookupTouches(db(), "u/jo_test");
    expect(jo?.touches.map((t) => [t.kind, t.direction, t.response])).toEqual([
      ["reply", "theirs", null],
      ["reply", "ours", "replied"],
      ["comment", "theirs", null],
    ]);
    expect(jo?.touches[1]).toMatchObject({
      account: "reddit@wren",
      text: "We send them from the CRM.",
    });

    const sam = await touchesFor(db(), { leadId });
    expect(sam).toHaveLength(1);
    expect(sam[0]).toMatchObject({
      platform: "linkedin",
      handle: "sam-test",
      personId,
      leadId,
      kind: "comment",
      direction: "ours",
      account: "wren",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:7001/",
      text: "Three in a week is quick.",
    });
    const handles = await db().execute(
      sql`select linked_by from social_handles where handle = 'sam-test'`,
    );
    expect(handles).toEqual([{ linked_by: "linkedin_url" }]);

    // The People record's Touches tab and count.
    const rows = (await personRecord.rows?.(db())) ?? [];
    expect(rows.find((x) => x.id === `li:${personId}`)).toMatchObject({ touches: 1 });
    expect(rows.find((x) => x.id === "reddit:jo_test")).toMatchObject({ touches: 3 });
    const lines = (await db().execute(
      sql`select kind, what from person_touch_lines where person = ${`li:${personId}`}`,
    )) as unknown as Array<{ kind: string; what: string }>;
    expect(lines).toEqual([
      {
        kind: "LinkedIn comment",
        what: "We commented on their post as wren: Three in a week is quick. · https://www.linkedin.com/feed/update/urn:li:activity:7001/",
      },
    ]);
  });

  it("marks an invite accepted, and an earlier touch reaches the DM prompt and compose", async () => {
    await commentOnTheirPost(ago(10));
    const c = await personContact(db(), `li:${personId}`);
    await db()
      .update(reachContacts)
      .set({ accountId: linkedin.id, state: "enrolled" })
      .where(sql`id = ${c.id}`);
    const [invite] = await db()
      .insert(reachMessages)
      .values({
        contactId: c.id,
        accountId: linkedin.id,
        direction: "out",
        kind: "connect",
        body: "",
        state: "sent",
        sentAt: ago(3),
      })
      .returning();
    await touchFromMessage(db(), (invite as { id: number }).id);
    expect(await markAccepted(db(), linkedin.id, ["sam-test"], ago(1))).toEqual([c.id]);

    const all = await touchesFor(db(), { personId });
    expect(all.map((t) => [t.kind, t.response])).toEqual([
      ["connect", "accepted"],
      ["comment", null],
    ]);

    const { prompt, mine } = await dmContext(db(), c.id, NOW);
    expect(prompt).toContain("Earlier touches with them, newest first:");
    expect(prompt).toContain(
      '2026-09-27 LinkedIn: we commented on their post: "Three in a week is quick."',
    );
    // The invite is the thread's own; it isn't repeated as an earlier touch.
    expect(prompt).not.toContain("we sent a connection invite");
    expect(mine).toContain("Three in a week is quick.");

    const facts = await touchFactsFor(db(), personId, NOW);
    expect(facts).toMatchObject({
      "touch.line": "connecting on LinkedIn",
      "touch.platform": "LinkedIn",
      "touch.count": 2,
    });
    expect(String(facts["touch.context"])).toContain("we commented on their post");
  });

  it("backfills every source once", async () => {
    await commentOnTheirPost(ago(10));
    await db().execute(sql`delete from touches`);
    const dry = await backfillOutreachTouches(db(), { dryRun: true });
    expect(dry.posts).toBe(1);
    expect(await touchesFor(db(), { personId })).toHaveLength(0);
    expect((await backfillOutreachTouches(db(), { now: NOW })).posts).toBe(1);
    expect((await backfillOutreachTouches(db(), { now: NOW })).posts).toBe(0);
    expect(await touchesFor(db(), { personId })).toHaveLength(1);
  });
});
