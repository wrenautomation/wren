/**
 * Comment examples on Postgres (designs/2026-10-07-content-funnel.md, part c): his sent and
 * turned-down comment drafts, with what they answered, read back into the next comment's prompt.
 * Synthetic rows only.
 */
import { recordDraft } from "@wren/core/draft-record";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sortComment } from "../../src/comments.js";
import { commentDecisions, commentExamples } from "../../src/examples.js";
import { comments, linkedinPosts, redditPlaces, redditThreads } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});

const NOW = new Date();

async function comment(n: number, body: string, postTitle: string) {
  const [c] = await pg.db
    .insert(comments)
    .values({
      platform: "youtube",
      channel: "content",
      ref: `c${n}`,
      post: "v1",
      parent: "v1",
      kind: "post_reply",
      postTitle,
      author: `viewer${n}`,
      body,
      url: `https://example.com/c${n}`,
      at: NOW,
      raw: {},
    })
    .returning();
  return c!;
}

describe("comment examples", () => {
  it("reads each item's last decision with what it answered, closest first, a no kept", async () => {
    const sent = await comment(
      1,
      "Does the invoice chaser work with QuickBooks?",
      "Invoice chasing",
    );
    await recordDraft(pg.db, {
      item: `comment:${sent.id}`,
      kind: "comment",
      platform: "youtube",
      event: "generated",
      via: "model",
      text: "Yes, it reads QuickBooks invoices.",
    });
    await recordDraft(pg.db, {
      item: `comment:${sent.id}`,
      kind: "comment",
      platform: "youtube",
      event: "sent",
      via: "person",
      text: "Yes. It reads QuickBooks invoices and chases the late ones.",
    });

    await pg.db
      .insert(redditPlaces)
      .values({ subreddit: "smallbiz", name: "smallbiz", foundBy: "named" });
    await pg.db.insert(redditThreads).values({
      id: "t3_synth1",
      subreddit: "smallbiz",
      title: "How do you chase late invoices?",
      body: "Spending hours a week on it.",
      author: "owner1",
      url: "https://example.com/t3_synth1",
      postedAt: NOW,
      comments: 3,
      raw: {},
    });
    await recordDraft(pg.db, {
      item: "thread:t3_synth1",
      kind: "thread",
      platform: "reddit",
      event: "rejected",
      via: "person",
      text: "We built a tool for this, DM me.",
      reason: "salesy",
      note: "never pitch in a thread",
    });

    const [post] = await pg.db
      .insert(linkedinPosts)
      .values({
        urn: "urn:li:activity:1",
        author: "A Founder",
        text: "Hiring is the hardest part of a small agency.",
        url: "https://example.com/li1",
        foundBy: "topic: hiring",
        account: "linkedin@test",
        raw: {},
      })
      .returning();
    await recordDraft(pg.db, {
      item: `lipost:${post!.id}`,
      kind: "linkedin_comment",
      platform: "linkedin",
      event: "sent",
      via: "person",
      text: "Same here: the first hire took months.",
    });

    const all = await commentDecisions(pg.db);
    expect(all).toHaveLength(3);
    const byItem = Object.fromEntries(all.map((e) => [e.item, e]));
    expect(byItem[`comment:${sent.id}`]).toMatchObject({
      yes: true,
      text: "Yes. It reads QuickBooks invoices and chases the late ones.",
      about: "Does the invoice chaser work with QuickBooks?",
    });
    expect(byItem["thread:t3_synth1"]).toMatchObject({
      yes: false,
      reason: "salesy",
      note: "never pitch in a thread",
      about: "How do you chase late invoices?\nSpending hours a week on it.",
    });
    expect(byItem[`lipost:${post!.id}`]?.about).toBe(
      "Hiring is the hardest part of a small agency.",
    );

    const two = await commentExamples(pg.db, { about: "chasing invoices in QuickBooks", limit: 2 });
    expect(two.map((e) => e.item)).toEqual([`comment:${sent.id}`, "thread:t3_synth1"]);
    // Only yeses rank first: the last place goes to a no.
    const one = await commentExamples(pg.db, { about: "QuickBooks", limit: 1 });
    expect(one[0]?.yes).toBe(false);
  });

  it("feeds them to the next comment's prompt", async () => {
    const next = await comment(9, "Can it chase invoices in Xero?", "Invoice chasing");
    let system = "";
    const llm = new FakeLlm({
      respond: (_prompt, s) => {
        system = s ?? "";
        return '{"sort":"question","why":"asks about a tool","answer":"Not yet."}';
      },
    });
    expect(await sortComment(pg.db, llm, next.id)).toBe("question");
    expect(system).toContain("His past decisions on comment drafts");
    expect(system).toContain("He sent it.");
    expect(system).toContain('He turned it down: Too salesy ("never pitch in a thread").');
  });
});
