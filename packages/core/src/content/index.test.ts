import { describe, expect, it } from "vitest";
import {
  CONTENT_LIST_LIMIT,
  fakeContentChannel,
  mediaFileOf,
  pageOf,
  previewOf,
  publicUrlOf,
} from "./index.js";

describe("content channel port", () => {
  it("pages newest first with a cursor, capped at the list limit", () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({
      id: String(i),
      publishedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }));
    const first = pageOf(rows);
    expect(first).toHaveLength(CONTENT_LIST_LIMIT);
    expect(first[0]?.id).toBe("249");
    const second = pageOf(rows, { before: first[first.length - 1]?.publishedAt as string });
    expect(second[0]?.id).toBe("149");
    expect(pageOf(rows, { limit: 0 })).toHaveLength(1);
    expect(pageOf(rows, { limit: 5000 })).toHaveLength(CONTENT_LIST_LIMIT);
    expect(pageOf([{ id: "c", at: "2026-01-01T00:00:00Z" }], { limit: 1 })).toHaveLength(1);
  });

  it("the fake publishes, lists rows with previews, counts and takes comments", async () => {
    let t = 0;
    const ch = fakeContentChannel("linkedin", {
      now: () => new Date(Date.UTC(2026, 8, 21, 0, t++)),
    });
    const long = "x".repeat(200);
    const a = await ch.publish({ text: "first post" });
    const b = await ch.publish({ text: long });
    expect(a).toEqual({
      id: "linkedin-1",
      url: "https://linkedin.test/p/linkedin-1",
      publishedAt: "2026-09-21T00:00:00.000Z",
      fetchedWith: "api",
    });
    const rows = await ch.list();
    expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(rows[0]?.preview).toBe(previewOf(long));
    expect(rows[0]?.preview).toHaveLength(120);
    expect((await ch.metrics(a.id)).views).toBe(0);
    ch.count(a.id, { views: 40, reactions: 3 });
    expect(await ch.metrics(a.id)).toMatchObject({ views: 40, reactions: 3, comments: 0 });
    await expect(ch.metrics("nope")).rejects.toThrow(/no post/);
    ch.receive({ id: "c1", postId: a.id, author: "Ana", text: "nice", at: "2026-09-21T01:00:00Z" });
    expect(await ch.comments(a.id)).toHaveLength(1);
    expect(await ch.comments(b.id)).toHaveLength(0);
    await ch.reply?.("c1", "thanks");
    expect((await ch.comments(a.id))[0]?.repliedWith).toMatch(/^reply-/);
  });
});

describe("media sources", () => {
  const host = { host: async (s: string) => `https://cdn.test/${encodeURIComponent(s)}` };
  it("publicUrlOf: a URL as is, anything else through the host, refused without one", async () => {
    expect(await publicUrlOf("https://a.test/v.mp4", undefined, "instagram")).toBe(
      "https://a.test/v.mp4",
    );
    expect(await publicUrlOf("s3://b/media/k.mp4", host, "instagram")).toBe(
      "https://cdn.test/s3%3A%2F%2Fb%2Fmedia%2Fk.mp4",
    );
    await expect(publicUrlOf("/tmp/v.mp4", undefined, "instagram")).rejects.toThrow(
      /public URL is needed/,
    );
  });
  it("mediaFileOf: a stored object needs the host, a bare path without one is the box's own", async () => {
    expect(await mediaFileOf("/box/v.mp4", undefined, "youtube")).toBe("/box/v.mp4");
    expect(await mediaFileOf("/laptop/v.mp4", host, "youtube")).toMatch(/^https:\/\/cdn\.test\//);
    expect(await mediaFileOf("s3://b/k.mp4", host, "x")).toMatch(/^https:\/\/cdn\.test\//);
    await expect(mediaFileOf("s3://b/k.mp4", undefined, "x")).rejects.toThrow(/public URL/);
  });
});
