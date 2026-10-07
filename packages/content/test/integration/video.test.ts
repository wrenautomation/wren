/**
 * Marketing → Videos against Postgres: a rendered video waits in To approve, Approve writes
 * one private YouTube draft of the file on the Mac (never two), a Short (plus its Instagram Reel
 * draft, waiting in To approve) and a thumbnail pick.
 * Synthetic rows only.
 */
import { serveRecords } from "@wren/core/records/serve";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { videoEdits } from "@wren/studio/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contentDrafts } from "../../src/schema.js";
import { approvalRecord } from "../../src/social/records.js";
import { approveVideo, pickThumbnail, videoRecord } from "../../src/video.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});

const track = { path: "/rec/main.mp4", durationS: 480, width: 1920, height: 1080, fps: 30 };

describe("marketing.video", () => {
  it("queues a rendered video, approves it once, privately, and its Short and thumbnail", async () => {
    const [v] = await pg.db
      .insert(videoEdits)
      .values({
        title: "Synthetic walkthrough",
        description: "What it does.",
        state: "rendered",
        dir: "/rec",
        tracks: { main: track },
        words: [
          { w: "hello", s: 1, e: 1.4 },
          { w: "um", s: 3, e: 3.2 },
        ],
        cuts: [
          { from: 2, to: 4, why: "silence", state: "cut" },
          { from: 10, to: 12, why: "filler", state: "proposed" },
        ],
        shorts: [{ from: 20, to: 50, title: "The one trick" }],
        tags: ["demo"],
        files: {
          long: "/rec/out/long.mp4",
          "short-1": "/rec/out/short-1.mp4",
          "thumb-1": "/rec/out/thumb-1.jpg",
          "thumb-2": "/rec/out/thumb-2.jpg",
        },
        keys: {
          long: "studio/1/long.mp4",
          "reel-1": "s3://media/studio/1/reel-1.mp4",
          "thumb-1": "studio/1/thumb-1.jpg",
          "thumb-2": "studio/1/thumb-2.jpg",
        },
      })
      .returning();
    const id = v!.id;
    const approvals = serveRecords([approvalRecord], pg.db);
    const waiting = await approvals.list({ record: approvalRecord.id, view: "waiting", limit: 50 });
    expect(waiting.rows).toContainEqual(
      expect.objectContaining({ id: `video:${id}`, type: "video", state: "waiting" }),
    );

    await pickThumbnail(pg.db, id, 2);
    const first = await approveVideo(pg.db, id, { source: "cli" });
    const again = await approveVideo(pg.db, id, { source: "api" });
    expect(again).toEqual({ id: first.id, again: true });
    const [d] = await pg.db.select().from(contentDrafts).where(eq(contentDrafts.id, first.id));
    expect(d).toMatchObject({
      platform: "youtube",
      status: "approved",
      scheduledFor: null,
      title: "Synthetic walkthrough",
      text: "What it does.",
      media: { kind: "video", source: "/rec/out/long.mp4" },
      extra: { privacyStatus: "private", tags: ["demo"], thumbnail: "/rec/out/thumb-2.jpg" },
    });
    const short = await approveVideo(pg.db, id, { source: "cli", short: 1 });
    const [s] = await pg.db.select().from(contentDrafts).where(eq(contentDrafts.id, short.id));
    expect(s).toMatchObject({ title: "The one trick", media: { source: "/rec/out/short-1.mp4" } });
    expect(s?.extra).not.toHaveProperty("thumbnail");

    // The Short's Reel: an Instagram draft of the uploaded full render, waiting for his yes.
    if (!short.reel || !("id" in short.reel)) throw new Error("no reel draft");
    const reelId = short.reel.id;
    const [reel] = await pg.db.select().from(contentDrafts).where(eq(contentDrafts.id, reelId));
    expect(reel).toMatchObject({
      platform: "instagram",
      status: "draft",
      scheduledFor: null,
      text: "The one trick\n\nWhat it does.",
      media: { kind: "video", source: "s3://media/studio/1/reel-1.mp4" },
    });
    expect(await approveVideo(pg.db, id, { source: "api", short: 1 })).toEqual({
      id: short.id,
      again: true,
      reel: { id: reelId, again: true },
    });
    const reels = await serveRecords([approvalRecord], pg.db).list({
      record: approvalRecord.id,
      view: "waiting",
      limit: 50,
    });
    expect(reels.rows.map((r) => r.id)).toContain(`draft:${reelId}`);
    await expect(approveVideo(pg.db, id, { source: "cli", short: 2 })).rejects.toThrow(/Short 2/);

    // A fresh serve: the first one keeps its rows for a while.
    const after = await serveRecords([approvalRecord], pg.db).list({
      record: approvalRecord.id,
      view: "waiting",
      limit: 50,
    });
    expect(after.rows.map((r) => r.id)).not.toContain(`video:${id}`);

    const signed: string[] = [];
    const rec = videoRecord({
      bucket: "media",
      host: { host: async (k) => (signed.push(k), `https://signed/${k}`) },
    });
    const api = serveRecords([rec], pg.db);
    const all = await api.list({ record: rec.id, view: "all", limit: 9 });
    expect(all.rows).toEqual([
      expect.objectContaining({
        id: String(id),
        state: "approved",
        raw: "8:00",
        cut: "7:58",
        shorts: 1,
      }),
    ]);
    const detail = (await rec.load?.(pg.db, String(id))) as {
      video: {
        preview: string;
        words: { cut: string | null }[];
        thumbnails: { picked: boolean }[];
      };
    };
    expect(detail.video.preview).toBe("https://signed/s3://media/studio/1/long.mp4");
    expect(detail.video.words.map((w) => w.cut)).toEqual([null, "cut"]);
    expect(detail.video.thumbnails.map((t) => t.picked)).toEqual([false, true]);
  });

  it("a Short rendered before Reels uploaded says to render again, and still goes to YouTube", async () => {
    const [v] = await pg.db
      .insert(videoEdits)
      .values({
        title: "Older render",
        state: "rendered",
        dir: "/rec",
        tracks: { main: track },
        shorts: [{ from: 0, to: 30, title: "Short one" }],
        files: { "short-1": "/rec/out/short-1.mp4" },
        keys: { "short-1": "s3://media/studio/2/short-1-540.mp4" },
      })
      .returning();
    if (!v) throw new Error("no video");
    const r = await approveVideo(pg.db, v.id, { source: "cli", short: 1 });
    expect(r.reel).toEqual({ missing: expect.stringMatching(/render it again/) });
    const rows = await pg.db.select().from(contentDrafts).where(eq(contentDrafts.id, r.id));
    expect(rows.map((d) => d.platform)).toEqual(["youtube"]);
  });

  it("refuses a video not rendered yet", async () => {
    const [v] = await pg.db
      .insert(videoEdits)
      .values({ title: "Draft", dir: "/rec", tracks: { main: track } })
      .returning();
    await expect(approveVideo(pg.db, v!.id, { source: "cli" })).rejects.toThrow(/render it first/);
  });
});
