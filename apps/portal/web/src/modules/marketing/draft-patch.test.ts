import { describe, expect, it } from "vitest";
import { keptLinks, shapePatch } from "./draft-patch.js";

const shape = {
  draftId: "d1",
  status: "draft",
  title: "Old",
  fields: [
    { key: "title", value: "Old" },
    { key: "images", value: ["s3://b/a.png", "s3://b/b.png", "s3://b/c.png"] },
    { key: "thumbnail", value: "s3://b/t.png" },
  ],
  missing: ["Title"],
  links: { "images.0": "A", "images.1": "B", "images.2": "C", thumbnail: "T", media: "M" },
  carousel: {
    slides: [{ title: "x", lines: [] }],
    images: ["i1"],
    pdf: "p",
    fresh: true,
    shares: [
      { id: "d1", status: "draft" },
      { id: "d2", status: "approved" },
    ],
  },
};
const saved = (over: Record<string, unknown> = {}) => ({
  done: ["d1"],
  saved: {
    title: "New",
    status: "draft",
    editable: true,
    fields: [
      { key: "title", value: "New" },
      { key: "images", value: ["s3://b/a.png", "s3://b/c.png"] },
      { key: "thumbnail", value: null },
    ],
    missing: [],
    ...over,
  },
});

describe("shapePatch", () => {
  it("patches the fields, title and missing from the answer", () => {
    const got = shapePatch({ shape, post: {} }, saved()) as { detail: { shape: typeof shape } };
    expect(got.detail.shape.title).toBe("New");
    expect(got.detail.shape.missing).toEqual([]);
    expect(got.detail.shape.fields[0]).toEqual({ key: "title", value: "New" });
    expect(got.detail.shape.links).toEqual({ "images.0": "A", "images.1": "C", media: "M" });
  });

  it("reads again when the save moved the draft's status, or has no saved fields", () => {
    expect(shapePatch({ shape }, saved({ status: "approved" }))).toBeNull();
    expect(shapePatch({ shape }, { done: ["d1"] })).toBeNull();
    expect(shapePatch({ shape: null }, saved())).toBeNull();
  });

  it("drops drawn slides when the set changed, and moves the shares' status", () => {
    const got = shapePatch(
      { shape },
      saved({
        carousel: { slides: [{ title: "y", lines: [] }], fresh: false, drawn: null, unfit: "Draw" },
        shares: [
          { id: "d1", status: "draft" },
          { id: "d2", status: "draft" },
        ],
      }),
    ) as { detail: { shape: typeof shape } };
    const c = got.detail.shape.carousel;
    expect(c.slides).toEqual([{ title: "y", lines: [] }]);
    expect(c.images).toEqual([]);
    expect(c.pdf).toBeNull();
    expect(c.shares.map((s) => s.status)).toEqual(["draft", "draft"]);
  });

  it("reads the answer inside a per-record call's wrapper", () => {
    const got = shapePatch({ shape }, { done: [1], skipped: [], answer: saved() });
    expect(got).not.toBeNull();
  });
});

describe("keptLinks", () => {
  it("keeps a single file's link only while it is the same file", () => {
    const f = [{ key: "cover", value: "x" }];
    expect(keptLinks({ cover: "L" }, f, f)).toEqual({ cover: "L" });
    expect(keptLinks({ cover: "L" }, f, [{ key: "cover", value: "y" }])).toEqual({});
  });
});
