/**
 * The funnel against Postgres (designs/2026-10-07-content-funnel.md): stage, target and the
 * derived link on a draft; approve's refusal while the video isn't up; the Short's Reel pointing
 * at its long video; a promo drafting one post per platform. Synthetic rows only; nothing posts.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { videoEdits } from "@wren/studio/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { redraft } from "../../src/draft.js";
import { readFunnel, setFunnel } from "../../src/funnel.js";
import { promosOf, promoteVideo, videoDraftOf } from "../../src/promo.js";
import { approveDrafts } from "../../src/review.js";
import { contentDrafts, contentIdeas } from "../../src/schema.js";
import { shapeView } from "../../src/shape-view.js";
import { approveVideo } from "../../src/video.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});

const prompts: string[] = [];
const llm = new FakeLlm({
  respond: async (prompt) => {
    prompts.push(prompt);
    if (prompt.includes("a Reddit text post"))
      return '{"title": "How I cut a demo to the part that matters", "text": "I cut a demo to the part that matters."}';
    if (prompt.includes("one post on X"))
      return '{"text": "Most demos bury the point. Cut to the part that matters."}';
    if (prompt.includes("Instagram Reel caption"))
      return '{"text": "Cut to the part that matters.\\n\\nThe full video is on YouTube, link in bio."}';
    if (prompt.includes("The author read it and says"))
      return '{"text": "Cut the demo to the part that matters. Shorter."}';
    return '{"text": "Most demos bury the point.\\n\\nThis one shows how I cut to the part that matters.\\n\\nThe full walkthrough is in the video."}';
  },
});

const track = { path: "/rec/main.mp4", durationS: 480, width: 1920, height: 1080, fps: 30 };

async function video(title: string) {
  const [v] = await pg.db
    .insert(videoEdits)
    .values({
      title,
      description: "How I cut a demo to the part that matters.",
      state: "rendered",
      dir: "/rec",
      tracks: { main: track },
      words: [],
      cuts: [],
      shorts: [{ from: 20, to: 50, title: "The cut" }],
      tags: [],
      files: { long: "/rec/out/long.mp4", "short-1": "/rec/out/short-1.mp4" },
      keys: {
        long: "studio/1/long.mp4",
        "reel-1": `s3://media/studio/${title}/reel-1.mp4`,
        "reel-vertical": `s3://media/studio/${title}/reel-vertical.mp4`,
      },
    })
    .returning();
  return v!.id;
}

async function post(platform: "linkedin" | "x" | "reddit", extra = {}) {
  const [idea] = await pg.db
    .insert(contentIdeas)
    .values({ text: "Cut the demo to the part that matters.", source: "cli" })
    .returning();
  const [d] = await pg.db
    .insert(contentDrafts)
    .values({
      ideaId: idea!.id,
      platform,
      text: "Cut the demo to the part that matters.",
      extra,
      promptVersion: "test",
    })
    .returning();
  return d!;
}

describe("funnel", () => {
  it("derives the link from stage and target, and records the change", async () => {
    const d = await post("linkedin");
    let f = await readFunnel(pg.db, d);
    expect(f).toMatchObject({ stage: "reach", to: "site", linked: true, chosen: false });
    expect(f.posts).toBe(`https://wrenautomation.com/go/li/reach/${d.id.slice(0, 8)}`);

    const row = await setFunnel(pg.db, d.id, { stage: "convert", to: "booking" }, { by: "t@x" });
    f = await readFunnel(pg.db, row);
    expect(f.posts).toBe(
      `https://wrenautomation.com/go/li/convert/${d.id.slice(0, 8)}?to=/book/reactivation`,
    );
    const ev = await pg.db.execute<{ meta: { funnel: Record<string, unknown> } }>(
      sql`select meta from draft_events where item = ${`draft:${d.id}`} and event = 'edited'`,
    );
    expect(ev[0]?.meta.funnel).toMatchObject({ stage: ["reach", "convert"] });

    const off = await setFunnel(pg.db, d.id, { linked: false });
    expect(await readFunnel(pg.db, off)).toMatchObject({ posts: null, chosen: true });
    await expect(setFunnel(pg.db, d.id, { video: d.id })).rejects.toThrow(/itself/);
  });

  it("keeps X and unresearched Reddit posts unlinked", async () => {
    const x = await post("x");
    expect(await readFunnel(pg.db, x)).toMatchObject({ allowed: true, linked: false, posts: null });
    const r = await post("reddit", { subreddit: "r/SomeSub" });
    expect(await readFunnel(pg.db, r)).toMatchObject({ allowed: false, posts: null });
  });

  it("points a Short's Reel at its long video and promotes the video per platform", async () => {
    const id = await video("promo-a");
    const long = await approveVideo(pg.db, id, { source: "cli" });
    const short = await approveVideo(pg.db, id, { source: "cli", short: 1 });
    if (!short.reel || !("id" in short.reel)) throw new Error("no reel");
    const [reel] = await pg.db
      .select()
      .from(contentDrafts)
      .where(eq(contentDrafts.id, short.reel.id));
    expect(reel).toMatchObject({ stage: "reach", pointsTo: "video", videoDraft: long.id });
    const [up] = await pg.db.select().from(contentDrafts).where(eq(contentDrafts.id, long.id));
    expect(up).toMatchObject({ stage: "trust", pointsTo: "site" });
    expect(await videoDraftOf(pg.db, id)).toBe(long.id);

    await pg.db.execute(sql`insert into reddit_places (subreddit, name, found_by, judged, fit, state)
      values ('editing', 'Editing', 'topic: demos',
        ${JSON.stringify({ fit: 8, why: "fits", rules: "No self-promotion.", mayComment: true, mayPost: true, linkOnly: false })}::jsonb,
        8, 'watching')`);

    const r = await promoteVideo(pg.db, llm, long.id);
    const by = Object.fromEntries(r.results.map((x) => [x.platform, x]));
    expect(by.linkedin?.ok && by.x?.ok && by.reddit?.ok && by.instagram?.ok).toBe(true);
    for (const res of r.results) {
      if (!res.ok) continue;
      expect(res.draft).toMatchObject({
        status: "draft",
        stage: "reach",
        pointsTo: "video",
        videoDraft: long.id,
        promptVersion: "promo-v1",
      });
    }
    if (by.reddit?.ok) expect(by.reddit.draft.extra).toMatchObject({ subreddit: "Editing" });
    if (by.instagram?.ok)
      expect(by.instagram.draft.media?.source).toBe("s3://media/studio/promo-a/reel-vertical.mp4");
    const redditPrompt = prompts.find((p) => p.includes("a Reddit text post"));
    expect(redditPrompt).toContain("No self-promotion.");
    expect(redditPrompt).toContain("recorded a walkthrough");

    // Not on YouTube yet: a linked promo waits; once it's up, it carries the video's URL.
    const li = by.linkedin?.ok ? by.linkedin.draft : null;
    if (!li) throw new Error("no linkedin promo");
    await expect(approveDrafts(pg.db, [li.id], { now: new Date() })).rejects.toThrow(
      /isn't on YouTube yet/,
    );
    await pg.db
      .update(contentDrafts)
      .set({ status: "published", url: "https://www.youtube.com/watch?v=synthetic01" })
      .where(eq(contentDrafts.id, long.id));
    expect(await readFunnel(pg.db, li)).toMatchObject({
      posts: "https://www.youtube.com/watch?v=synthetic01",
    });
    const view = await shapeView(pg.db, li.id);
    expect(view?.funnel).toMatchObject({ to: "video", video: { id: long.id } });
    expect(view?.funnel.videos.map((v) => v.id)).toContain(long.id);
    await approveDrafts(pg.db, [li.id], { now: new Date() });

    // Again: each platform says why not; the video's page lists one per platform.
    const again = await promoteVideo(pg.db, llm, long.id, ["linkedin"]);
    expect(again.results[0]).toMatchObject({ ok: false, reason: "already drafted" });
    const promos = await promosOf(pg.db, long.id);
    expect(promos.map((p) => p.platform).sort()).toEqual(["instagram", "linkedin", "reddit", "x"]);

    // A redraft keeps where the post points.
    const xDraft = by.x?.ok ? by.x.draft : null;
    if (!xDraft) throw new Error("no x promo");
    const [idea] = await pg.db.select().from(contentIdeas).where(eq(contentIdeas.id, r.ideaId));
    const re = await redraft(pg.db, llm, xDraft, idea!, "shorter");
    expect(re).toMatchObject({ ok: true, draft: { pointsTo: "video", videoDraft: long.id } });
  });

  it("keeps the Reddit promo off the video where the sub forbids links", async () => {
    await pg.db.execute(
      sql`update reddit_places set judged = judged || '{"linkOnly": true}'::jsonb`,
    );
    const id = await video("promo-b");
    const long = await approveVideo(pg.db, id, { source: "cli" });
    prompts.length = 0;
    const r = await promoteVideo(pg.db, llm, long.id, ["reddit"]);
    expect(r.results[0]?.ok).toBe(true);
    expect(prompts[0]).toContain("Do not mention the video");
    if (r.results[0]?.ok)
      expect(await readFunnel(pg.db, r.results[0].draft)).toMatchObject({
        allowed: false,
        posts: null,
        note: "r/Editing doesn't allow links",
      });
  });

  it("refuses a Short or a video not approved", async () => {
    const d = await post("linkedin");
    await expect(promoteVideo(pg.db, llm, d.id)).rejects.toThrow(/isn't a YouTube draft/);
    await expect(videoDraftOf(pg.db, 999_999)).rejects.toThrow(/approve it first/);
  });
});
