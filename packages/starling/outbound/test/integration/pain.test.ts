/**
 * The pain points line on Postgres: the pass reads the kept reach posts once (a cursor), asks the
 * model for each author's own pain with a quote, drops a pain whose quote is not in the post,
 * keeps the rest as a finding on the post's document and a line on the author's timeline, and
 * fires the author's profile into the shape at the line's list. With no live sourced source for
 * the list it waits and the cursor stays.
 */
import { resolveObjects } from "@wren/core/objects";
import { profileOf } from "@wren/core/profiles";
import { profileEvents } from "@wren/core/profiles-schema";
import { imports } from "@wren/core/schema";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { findings } from "@wren/research";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { painBatch, painPass } from "../../src/pain.js";
import { reachPosts } from "../../src/schema.js";

const TABLES = [
  "reach_posts",
  "platform_objects",
  "reach_passes",
  "imports",
  "findings",
  "documents",
  "profile_events",
  "profile_keys",
  "profiles",
  "social_handles",
];
const NOW = new Date("2026-10-26T10:00:00Z");
const DAY = 86_400_000;

let pg: TestPostgres;
const db = () => pg.db;

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, TABLES);
});

const TEXT = "We lost two placements this month because the client's ATS ate our notes.";

const addPost = async (n: number, o: Partial<typeof reachPosts.$inferInsert> = {}) => {
  await resolveObjects(db(), [
    { platform: "linkedin", kind: "post", raw: `urn:li:activity:70000000000000000${n}` },
  ]);
  const [r] = await db()
    .insert(reachPosts)
    .values({
      platform: "linkedin",
      ref: `urn:li:activity:70000000000000000${n}`,
      author: `Person ${n}`,
      authorUrl: `https://www.linkedin.com/in/person-${n}/`,
      handle: `person-${n}`,
      headline: "Founder at Example Staffing",
      text: TEXT,
      url: `https://www.linkedin.com/feed/update/urn:li:activity:70000000000000000${n}/`,
      postedAt: new Date(NOW.getTime() - DAY),
      fit: 80,
      state: "found",
      foundBy: "search",
      account: "wren",
      raw: {},
      ...o,
    })
    .returning({ id: reachPosts.id });
  if (!r) throw new Error("no post");
  return r.id;
};

const llmSaying = (pains: (id: number[]) => object[]) =>
  new FakeLlm({
    respond: (prompt) => {
      const ids = [...prompt.matchAll(/^Post (\d+) by/gm)].map((m) => Number(m[1]));
      return JSON.stringify({ pains: pains(ids) });
    },
  });

describe("the pain points pass", () => {
  it("makes the line's list once", async () => {
    const a = await painBatch(db());
    expect(a).toMatch(/^import:\d+$/);
    expect(await painBatch(db())).toBe(a);
    const rows = await db().select().from(imports);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sourceType: "pain", sourceRef: "reach_posts" });
  });

  it("waits with the cursor kept while no live sourced source names the list", async () => {
    await addPost(1);
    const r = await painPass(
      db(),
      llmSaying(() => []),
      ["import:999"],
      0,
      NOW,
    );
    expect(r).toMatchObject({ waiting: true, cursor: 0, scanned: 0, fires: [] });
  });

  it("keeps a proven pain as a finding, a timeline line and a fire; drops an unproven one", async () => {
    const source = await painBatch(db());
    const a = await addPost(1);
    const b = await addPost(2);
    const under = await addPost(3, { fit: 40 });
    const llm = llmSaying((ids) =>
      ids.flatMap((id) =>
        id === a
          ? [
              {
                post: id,
                pain: "Their ATS loses placements.",
                quote: "lost two placements this month",
              },
            ]
          : id === b
            ? [{ post: id, pain: "Made up.", quote: "we never said this" }]
            : [{ post: id, pain: "Under fit.", quote: "lost two placements" }],
      ),
    );
    const r = await painPass(db(), llm, [source], 0, NOW);
    expect(r).toMatchObject({
      waiting: false,
      cursor: under,
      scanned: 3,
      read: 2,
      pains: 1,
      unproven: 1,
      more: false,
    });
    const profile = await profileOf(db(), { kind: "handle:linkedin", value: "person-1" });
    expect(profile).not.toBeNull();
    expect(r.fires).toHaveLength(1);
    expect(r.fires[0]).toMatchObject({
      facts: { trigger: "trigger.source", source },
      event: {
        subject: `source:${source}:rp${a}`,
        data: { profile, row: `rp:${a}`, source, post: a, cause: { kind: "sourced", ref: source } },
      },
    });
    const found = await db().select().from(findings);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: "fact",
      via: "pain",
      question: "pain",
      by: "model",
      proof: { quote: "lost two placements this month" },
      value: {
        pain: "Their ATS loses placements.",
        platform: "linkedin",
        handle: "person-1",
        post: a,
        profile,
      },
    });
    expect(found[0]?.factKey).toMatch(/^doc:\d+\/pain\/[0-9a-f]{12}$/);
    const lines = await db()
      .select()
      .from(profileEvents)
      .where(eq(profileEvents.profileId, profile ?? -1));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: "finding",
      channel: "linkedin",
      summary: "Pain: Their ATS loses placements.",
      body: "lost two placements this month",
      source: "pain",
      sourceId: `rp:${a}`,
    });
    // The next pass starts past the cursor: nothing read again.
    const again = await painPass(db(), llm, [source], r.cursor, NOW);
    expect(again).toMatchObject({ scanned: 0, fires: [] });
  });

  it("reads a post again only by key, keeping one finding per quote", async () => {
    const source = await painBatch(db());
    const a = await addPost(1);
    const llm = llmSaying((ids) =>
      ids.map((id) => ({
        post: id,
        pain: "Their ATS loses placements.",
        quote: "lost two placements this month",
      })),
    );
    await painPass(db(), llm, [source], 0, NOW);
    await painPass(db(), llm, [source], a - 1, NOW);
    expect(await db().select().from(findings)).toHaveLength(1);
    expect(await db().select().from(profileEvents)).toHaveLength(1);
  });

  it("leaves old posts, dropped posts and passed-on authors", async () => {
    const source = await painBatch(db());
    await addPost(1, { postedAt: new Date(NOW.getTime() - 20 * DAY) });
    await addPost(2, { state: "dropped" });
    const llm = llmSaying((ids) =>
      ids.map((id) => ({ post: id, pain: "x", quote: "lost two placements this month" })),
    );
    const r = await painPass(db(), llm, [source], 0, NOW);
    expect(r).toMatchObject({ scanned: 0, read: 0, pains: 0, fires: [] });
  });
});
