/**
 * LinkedIn comment authors on our posts, from URN to profile: the comment notice that names the
 * comment's id wins; else the only notice on that post within two days; two people on one post
 * stay unlinked.
 */
import { recordTouch } from "@wren/core/touches";
import { socialHandles, touches } from "@wren/core/touches-schema";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { socialActivity } from "../../src/schema.js";
import { linkCommentAuthors } from "../../src/touches.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
}, 120_000);
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, ["touches", "social_handles", "social_activity"]);
});

const AT = new Date("2026-10-08T12:00:00Z");
const comment = (person: string, post: string, cid: string, at = AT) =>
  recordTouch(pg.db, {
    platform: "linkedin",
    handle: `urn:li:person:${person}`,
    kind: "comment",
    direction: "theirs",
    account: "wren",
    text: "Good point.",
    at,
    externalId: `urn:li:comment:(urn:li:activity:${post},${cid})`,
    source: "comments",
    ref: `c:${cid}`,
  });
const notice = (ref: string, vanity: string, name: string, url: string, at = AT) =>
  pg.db.insert(socialActivity).values({
    platform: "linkedin",
    kind: "notification",
    ref,
    actor: name,
    actorUrl: `https://www.linkedin.com/in/${vanity}/`,
    text: `${name} commented on your post`,
    url,
    at,
    raw: { kind: "comment", links: [url] },
  });
const handles = async () =>
  (await pg.db.select().from(socialHandles).orderBy(socialHandles.id)).map((h) => [
    h.handle,
    h.name,
  ]);

describe("linkCommentAuthors", () => {
  it("moves a URN's touches to the profile its notice names", async () => {
    await comment("AbC1", "7001", "9001");
    await notice(
      "n1",
      "jane-doe",
      "Jane Doe",
      "https://www.linkedin.com/feed/update/urn:li:activity:7001/?commentUrn=urn%3Ali%3Acomment%3A%28activity%3A7001%2C9001%29",
    );
    expect(await linkCommentAuthors(pg.db)).toBe(1);
    expect(await handles()).toEqual([["jane-doe", "Jane Doe"]]);
    const [h] = await pg.db.select().from(socialHandles);
    const t = await pg.db
      .select()
      .from(touches)
      .where(eq(touches.handleId, h?.id ?? 0));
    expect(t.map((x) => x.ref)).toEqual(["c:9001"]);
    // A second run finds nothing left to move.
    expect(await linkCommentAuthors(pg.db)).toBe(0);
  });

  it("the only notice on the post that day; never one days away", async () => {
    await comment("P1", "7002", "9002");
    await notice(
      "n2",
      "sam-lee",
      "Sam Lee",
      "https://www.linkedin.com/feed/update/urn:li:activity:7002/",
    );
    await comment("P2", "7003", "9003");
    await notice(
      "n3",
      "late-one",
      "Late One",
      "https://www.linkedin.com/feed/update/urn:li:activity:7003/",
      new Date(AT.getTime() + 5 * 86_400_000),
    );
    expect(await linkCommentAuthors(pg.db)).toBe(1);
    expect((await handles()).map(([h]) => h).sort()).toEqual(["sam-lee", "urn:li:person:P2"]);
  });

  it("two people on one post the same day: both stay URNs", async () => {
    await comment("Q1", "7004", "9004");
    await comment("Q2", "7004", "9005");
    await notice("n4", "ann", "Ann", "https://www.linkedin.com/feed/update/urn:li:activity:7004/");
    await notice("n5", "bob", "Bob", "https://www.linkedin.com/feed/update/urn:li:activity:7004/");
    expect(await linkCommentAuthors(pg.db)).toBe(0);
  });
});
