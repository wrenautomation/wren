import { describe, expect, it } from "vitest";
import {
  type DraftRow,
  type PieceRows,
  piecesOf,
  titleOf,
  type VideoRow,
  waitingOf,
} from "./pieces.js";

const draft = (o: Partial<DraftRow> & Pick<DraftRow, "id" | "idea_id" | "platform">): DraftRow => ({
  format: "post",
  status: "draft",
  title: null,
  text: "Words.",
  scheduled_for: null,
  published_at: null,
  url: null,
  error: null,
  video_draft: null,
  created_at: "2026-10-10T12:00:00Z",
  views: null,
  engaged: null,
  ...o,
});
const video = (o: Partial<VideoRow> & Pick<VideoRow, "id" | "title" | "created_at">): VideoRow => ({
  state: "added",
  shorts: [],
  ...o,
});
const rows = (o: Partial<PieceRows>): PieceRows => ({
  drafts: [],
  ideas: [],
  videos: [],
  blogs: [],
  site: "https://example.com",
  ...o,
});

describe("piecesOf", () => {
  it("one post on four platforms is one piece with four branches", () => {
    const out = piecesOf(
      rows({
        ideas: [
          {
            id: "i1",
            text: "Old clients are cheap revenue\nmore",
            ref: null,
            created_at: "2026-10-10T12:00:00Z",
          },
        ],
        drafts: ["x", "linkedin", "reddit", "facebook"].map((p, n) =>
          draft({
            id: `d${n}`,
            idea_id: "i1",
            platform: p,
            status: n ? "draft" : "published",
            published_at: n ? null : "2026-10-11T09:00:00Z",
            views: n ? null : 14,
          }),
        ),
      }),
    );
    expect(out).toHaveLength(1);
    const [p] = out;
    expect(p).toMatchObject({
      kind: "written",
      title: "Old clients are cheap revenue",
      at: "2026-10-11T09:00:00.000Z",
    });
    expect(p?.branches.map((b) => b.platform)).toEqual(["facebook", "linkedin", "reddit", "x"]);
    expect(p?.branches.find((b) => b.platform === "x")).toMatchObject({ state: "live", views: 14 });
    expect(waitingOf(p as never).map((b) => b.id)).toEqual(["d3", "d1", "d2"]);
  });

  it("a long video carries its clips and promo posts; a recording shows before its idea", () => {
    const out = piecesOf(
      rows({
        videos: [
          video({ id: 4, title: "How I automate outreach", created_at: "2026-10-01T00:00:00Z" }),
          video({ id: 5, title: "Fresh recording", created_at: "2026-10-12T00:00:00Z" }),
        ],
        ideas: [
          { id: "long", text: "x", ref: "video:4", created_at: "2026-10-02T00:00:00Z" },
          {
            id: "clip",
            text: "A clip",
            ref: "video:4/short:1",
            created_at: "2026-10-03T00:00:00Z",
          },
          { id: "promo", text: "Watch it", ref: "promo:yt", created_at: "2026-10-04T00:00:00Z" },
        ],
        drafts: [
          draft({
            id: "yt",
            idea_id: "long",
            platform: "youtube",
            format: "long",
            status: "published",
            published_at: "2026-10-02T10:00:00Z",
          }),
          draft({
            id: "s1",
            idea_id: "clip",
            platform: "youtube",
            format: "short",
            status: "approved",
            scheduled_for: "2026-10-14T15:00:00Z",
          }),
          draft({ id: "r1", idea_id: "clip", platform: "instagram", format: "reel" }),
          draft({ id: "p1", idea_id: "promo", platform: "x", video_draft: "yt" }),
        ],
      }),
    );
    // A queued clip is its long video's newest moment, so the video sorts first.
    expect(out.map((p) => p.id)).toEqual(["long", "video:5"]);
    expect(out[1]?.branches[0]).toMatchObject({ platform: "editor", state: "editing" });
    const long = out[0];
    expect(long).toMatchObject({
      video: 4,
      kind: "long",
      title: "How I automate outreach",
      at: "2026-10-14T15:00:00.000Z",
    });
    expect(long?.children.map((c) => [c.id, c.kind])).toEqual([
      ["clip", "vertical"],
      ["promo", "written"],
    ]);
    expect(long?.children[0]?.branches[1]).toMatchObject({
      platform: "youtube",
      state: "queued",
      at: "2026-10-14T15:00:00.000Z",
    });
  });

  it("a custom clip, a story and a blog post are their own kinds", () => {
    const out = piecesOf(
      rows({
        ideas: [
          { id: "c", text: "Clip", ref: null, created_at: "2026-10-05T00:00:00Z" },
          { id: "s", text: "Story", ref: null, created_at: "2026-10-04T00:00:00Z" },
        ],
        drafts: [
          draft({ id: "t", idea_id: "c", platform: "tiktok", format: "video" }),
          draft({ id: "st", idea_id: "s", platform: "instagram", format: "story" }),
        ],
        blogs: [
          {
            slug: "how-to-animate",
            title: "How to animate",
            description: "One line.",
            draft: false,
            publishedAt: new Date("2026-10-06T00:00:00Z"),
            emailedAt: null,
            createdAt: new Date("2026-10-03T00:00:00Z"),
            fromRef: null,
          },
        ],
      }),
    );
    expect(out.map((p) => [p.id, p.kind])).toEqual([
      ["blog:how-to-animate", "blog"],
      ["c", "vertical"],
      ["s", "story"],
    ]);
    expect(out[0]?.branches.map((b) => [b.platform, b.state, b.url])).toEqual([
      ["site", "live", "https://example.com/blog/how-to-animate"],
      ["email", "none", null],
    ]);
  });

  it("a rendered recording waits for review; proposed Shorts hang under it until they have an idea", () => {
    const out = piecesOf(
      rows({
        videos: [
          video({
            id: 7,
            title: "Rendered one",
            state: "rendered",
            shorts: [{ title: "First short" }, { title: "Second short" }],
            created_at: "2026-10-12T00:00:00Z",
          }),
        ],
        ideas: [
          {
            id: "s2",
            text: "Second short",
            ref: "video:7/short:2",
            created_at: "2026-10-13T00:00:00Z",
          },
        ],
        drafts: [draft({ id: "yt2", idea_id: "s2", platform: "youtube", format: "short" })],
      }),
    );
    expect(out.map((p) => p.id)).toEqual(["video:7"]);
    const [long] = out;
    expect(long?.branches[0]).toMatchObject({ platform: "editor", state: "review" });
    expect(waitingOf(long as never).map((b) => b.id)).toEqual(["video:7"]);
    expect(long?.children.map((c) => [c.id, c.kind, c.title])).toEqual([
      ["s2", "vertical", "Second short"],
      ["video:7/short:1", "vertical", "First short"],
    ]);
    expect(long?.children[1]?.branches).toMatchObject([
      { id: "video:7/short:1", platform: "editor", format: "short", state: "editing" },
    ]);
  });

  it("a post written about a video nests under it, its kind from its formats", () => {
    const [long] = piecesOf(
      rows({
        videos: [video({ id: 9, title: "Talk", created_at: "2026-10-10T00:00:00Z" })],
        ideas: [
          {
            id: "about",
            text: "Why I cut it",
            ref: "video:9/post:1a2b3c4d",
            created_at: "2026-10-11T00:00:00Z",
          },
        ],
        drafts: [draft({ id: "x1", idea_id: "about", platform: "x" })],
      }),
    );
    expect(long?.id).toBe("video:9");
    expect(long?.children.map((c) => [c.id, c.kind])).toEqual([["about", "written"]]);
  });

  it("a blog post written from a video hangs under it", () => {
    const [long] = piecesOf(
      rows({
        videos: [video({ id: 3, title: "Demo", created_at: "2026-10-10T00:00:00Z" })],
        blogs: [
          {
            slug: "from-the-demo",
            title: "From the demo",
            description: "One line.",
            draft: true,
            publishedAt: null,
            emailedAt: null,
            createdAt: new Date("2026-10-11T00:00:00Z"),
            fromRef: "video:3",
          },
        ],
      }),
    );
    expect(long).toMatchObject({ id: "video:3", video: 3 });
    expect(long?.children.map((c) => [c.id, c.kind])).toEqual([["blog:from-the-demo", "blog"]]);
  });

  it("an added or edited recording is still editing, and waits on no one", () => {
    const [p] = piecesOf(
      rows({ videos: [video({ id: 8, title: "Raw", state: "edited", created_at: "2026-10-12" })] }),
    );
    expect(p?.branches[0]?.state).toBe("editing");
    expect(waitingOf(p as never)).toEqual([]);
  });

  it("titles are a first line of 90 at most", () => {
    expect(titleOf(`  ${"a".repeat(120)}\nnext`)).toHaveLength(90);
    expect(titleOf("Short\nsecond")).toBe("Short");
  });

  it("an approved draft held by a busy browser says so; a plain approved one is queued", () => {
    const [p] = piecesOf(
      rows({
        ideas: [{ id: "i1", text: "A post", ref: null, created_at: "2026-10-10T12:00:00Z" }],
        drafts: [
          draft({
            id: "t",
            idea_id: "i1",
            platform: "tiktok",
            status: "approved",
            scheduled_for: "2026-10-15T17:00:00Z",
            error: "Waiting for the browser: not sent: profile google@test is busy (explore:9092)",
          }),
          draft({ id: "x", idea_id: "i1", platform: "x", status: "approved" }),
        ],
      }),
    );
    expect(p?.branches.find((b) => b.id === "t")).toMatchObject({
      state: "queued",
      waitingForBrowser: true,
      error: null,
    });
    expect(p?.branches.find((b) => b.id === "x")?.waitingForBrowser).toBeUndefined();
    expect(waitingOf(p as never)).toEqual([]);
  });
});
