/**
 * Marketing → Videos against Postgres: a rendered video waits in To approve, Approve writes
 * one private YouTube draft of the file on the Mac (never two), a Short (plus its Instagram Reel
 * draft, waiting in To approve), the vertical cut (the same, a Short on YouTube when 3 min or
 * less) and a thumbnail pick.
 * Synthetic rows only.
 */
import { serveRecords } from "@wren/core/records/serve";
import { clearTemplate, reset, saveLive } from "@wren/core/templates";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { setWords } from "@wren/studio/edit";
import { videoEdits } from "@wren/studio/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contentDrafts } from "../../src/schema.js";
import { approvalRecord } from "../../src/social/records.js";
import {
  approveVideo,
  pickThumbnail,
  VIDEO_FOOTERS,
  videoRecord,
  withFooter,
} from "../../src/video.js";
import { undoVideo, videoTurns } from "../../src/video-ask.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});

const BIO = "I'm Will, a Waterloo software engineering student building Wren in public.";

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
      text: expect.stringMatching(
        new RegExp(
          `^What it does\\.\\n\\nWebsite: https://wrenautomation\\.com/go/yt/${id}-synthetic-walkthrough\\n`,
        ),
      ),
      media: { kind: "video", source: "/rec/out/long.mp4" },
      extra: { privacyStatus: "private", tags: ["demo"], thumbnail: "/rec/out/thumb-2.jpg" },
    });
    const short = await approveVideo(pg.db, id, { source: "cli", short: 1, privacy: "public" });
    const [s] = await pg.db.select().from(contentDrafts).where(eq(contentDrafts.id, short.id));
    expect(s).toMatchObject({
      title: "The one trick",
      media: { source: "/rec/out/short-1.mp4" },
      extra: { privacyStatus: "public" },
    });
    expect(s?.extra).not.toHaveProperty("thumbnail");
    // A Short's links can't be clicked: the plain footer.
    expect(s?.text).toBe(`What it does.\n\nwrenautomation.com\n\n${BIO}`);

    // The Short's Reel: an Instagram draft of the uploaded full render, waiting for his yes.
    if (!short.reel || !("id" in short.reel)) throw new Error("no reel draft");
    const reelId = short.reel.id;
    const [reel] = await pg.db.select().from(contentDrafts).where(eq(contentDrafts.id, reelId));
    expect(reel).toMatchObject({
      platform: "instagram",
      status: "draft",
      scheduledFor: null,
      text: `The one trick\n\nWhat it does.\n\nwrenautomation.com, link in bio\n\n${BIO}`,
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

  it("approves the vertical: a long one as a video with its thumbnail, a short one as a Short", async () => {
    const [both] = await pg.db
      .insert(videoEdits)
      .values({
        title: "Both shapes",
        state: "rendered",
        dir: "/rec",
        tracks: { main: track },
        formats: ["long", "vertical"],
        files: {
          long: "/rec/out/long.mp4",
          vertical: "/rec/out/vertical.mp4",
          "thumb-1": "/rec/out/thumb-1.jpg",
        },
        keys: { vertical: "s3://media/v-540.mp4", "reel-vertical": "s3://media/v.mp4" },
      })
      .returning();
    if (!both) throw new Error("no video");
    const v = await approveVideo(pg.db, both.id, { source: "cli", vertical: true });
    const [d] = await pg.db.select().from(contentDrafts).where(eq(contentDrafts.id, v.id));
    expect(d).toMatchObject({
      platform: "youtube",
      media: { source: "/rec/out/vertical.mp4" },
      extra: { kind: "video", privacyStatus: "private", thumbnail: "/rec/out/thumb-1.jpg" },
    });
    if (!v.reel || !("id" in v.reel)) throw new Error("no reel draft");
    const [reel] = await pg.db.select().from(contentDrafts).where(eq(contentDrafts.id, v.reel.id));
    expect(reel).toMatchObject({
      platform: "instagram",
      status: "draft",
      media: { source: "s3://media/v.mp4" },
      extra: { shareToFeed: true },
    });
    expect(await approveVideo(pg.db, both.id, { source: "api", vertical: true })).toEqual({
      id: v.id,
      again: true,
      reel: { id: v.reel.id, again: true },
    });
    // The long video is its own draft.
    expect((await approveVideo(pg.db, both.id, { source: "cli" })).id).not.toBe(v.id);

    // A portrait take: its formats lack long, so a plain Approve (the Inbox's) is the vertical.
    const [tall] = await pg.db
      .insert(videoEdits)
      .values({
        title: "Phone take",
        state: "rendered",
        dir: "/rec",
        tracks: { main: { ...track, durationS: 60, width: 1080, height: 1920 } },
        formats: ["vertical"],
        files: { vertical: "/rec/out/vertical.mp4", "thumb-1": "/rec/out/thumb-1.jpg" },
      })
      .returning();
    if (!tall) throw new Error("no video");
    const s = await approveVideo(pg.db, tall.id, { source: "api" });
    const [sd] = await pg.db.select().from(contentDrafts).where(eq(contentDrafts.id, s.id));
    expect(sd?.extra).toMatchObject({ kind: "short" });
    expect(sd?.extra).not.toHaveProperty("thumbnail");
    expect(s.reel).toEqual({ missing: expect.stringMatching(/--only vertical/) });
  });

  it("fixes a misheard word, times kept, and Undo puts it back", async () => {
    const words = [
      { w: "we", s: 1, e: 1.2 },
      { w: "drug", s: 1.3, e: 1.6 },
      { w: "fooding.", s: 1.6, e: 2 },
      { w: "Ren", s: 3, e: 3.3 },
    ];
    const [v] = await pg.db
      .insert(videoEdits)
      .values({ title: "Words", dir: "/rec", tracks: { main: track }, words })
      .returning();
    if (!v) throw new Error("no video");
    const a = await setWords(
      pg.db,
      v.id,
      { wrong: "drug fooding", right: "dogfooding" },
      { by: "t" },
    );
    expect(a.n).toBe(1);
    const b = await setWords(pg.db, v.id, { at: 3.1, text: "Wren" }, { by: "t" });
    expect(b.edit.words).toEqual([
      { w: "we", s: 1, e: 1.2 },
      { w: "dogfooding.", s: 1.3, e: 2 },
      { w: "Wren", s: 3, e: 3.3 },
    ]);
    await expect(
      setWords(pg.db, v.id, { wrong: "zebra", right: "x" }, { by: "t" }),
    ).rejects.toThrow(/no "zebra"/);
    expect((await videoTurns(pg.db, v.id)).map((t) => t.fields)).toEqual([["words"], ["words"]]);
    const u = await undoVideo(pg.db, v.id, "t");
    expect(u.edit.words.map((w) => w.w)).toEqual(["we", "dogfooding.", "Ren"]);
  });

  it("puts the footer template under every description, after the chapters, slots filled; emptied, none", async () => {
    await saveLive(
      pg.db,
      VIDEO_FOOTERS.long,
      "Site: https://wrenautomation.com/go/yt/{video}\n\nSubscribe.\n",
      { by: "t" },
    );
    const [v] = await pg.db
      .insert(videoEdits)
      .values({
        title: "Chaptered, it's the one",
        description: "About it.",
        state: "rendered",
        dir: "/rec",
        tracks: { main: track },
        chapters: [
          { at: 0, title: "Start" },
          { at: 60, title: "Middle" },
          { at: 120, title: "End" },
        ],
        files: { long: "/rec/out/long.mp4" },
      })
      .returning();
    if (!v) throw new Error("no video");
    const a = await approveVideo(pg.db, v.id, { source: "cli" });
    const [d] = await pg.db.select().from(contentDrafts).where(eq(contentDrafts.id, a.id));
    expect(d?.text).toBe(
      `About it.\n\n0:00 Start\n1:00 Middle\n2:00 End\n\nSite: https://wrenautomation.com/go/yt/${v.id}-chaptered-its-the-one\n\nSubscribe.`,
    );
    await clearTemplate(pg.db, VIDEO_FOOTERS.long, "t");
    const [w] = await pg.db
      .insert(videoEdits)
      .values({
        title: "Plain",
        description: "Just this.",
        state: "rendered",
        dir: "/rec",
        tracks: { main: track },
        files: { long: "/rec/out/long.mp4" },
      })
      .returning();
    if (!w) throw new Error("no video");
    const b = await approveVideo(pg.db, w.id, { source: "cli" });
    const [e] = await pg.db.select().from(contentDrafts).where(eq(contentDrafts.id, b.id));
    expect(e?.text).toBe("Just this.");
    // A long description gives way; the footer is never cut.
    const long = withFooter(["x".repeat(6000)], "Footer.", 5000);
    expect(long).toHaveLength(5000);
    expect(long.endsWith("\n\nFooter.")).toBe(true);
    await reset(pg.db, VIDEO_FOOTERS.long, { by: "t", why: "back to the default" });
  });

  it("refuses a video not rendered yet", async () => {
    const [v] = await pg.db
      .insert(videoEdits)
      .values({ title: "Draft", dir: "/rec", tracks: { main: track } })
      .returning();
    await expect(approveVideo(pg.db, v!.id, { source: "cli" })).rejects.toThrow(/render it first/);
  });
});
