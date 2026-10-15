import { describe, expect, it } from "vitest";
import { keptLinks, shapePatch, tiktokMissing } from "./draft-patch.js";

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

  it("moves a TikTok row's missing with the picks, so Post now frees without a reload", () => {
    const tiktok = { ...shape, platform: "tiktok", fields: [], missing: ["Who can see it"] };
    const picked = (fields: { key: string; value: unknown }[]) =>
      shapePatch({ shape: tiktok }, saved({ fields })) as { row?: Record<string, unknown> };
    expect(picked([{ key: "privacy", value: null }]).row).toEqual({ missing: "privacy" });
    expect(
      picked([
        { key: "privacy", value: "SELF_ONLY" },
        { key: "disclose", value: true },
      ]).row,
    ).toEqual({ missing: "disclosure" });
    expect(
      picked([
        { key: "privacy", value: "SELF_ONLY" },
        { key: "disclose", value: true },
        { key: "yourBrand", value: true },
      ]).row,
    ).toEqual({ missing: null });
    // Other platforms leave the row alone: their row never holds a pick.
    expect((shapePatch({ shape }, saved()) as { row?: unknown }).row).toBeUndefined();
  });
});

describe("tiktokMissing", () => {
  it("reads the picks the way marketing_draft_records does", () => {
    expect(tiktokMissing([])).toBe("privacy");
    expect(tiktokMissing([{ key: "privacy", value: "" }])).toBe("privacy");
    expect(tiktokMissing([{ key: "privacy", value: "PUBLIC_TO_EVERYONE" }])).toBeNull();
    expect(
      tiktokMissing([
        { key: "privacy", value: "SELF_ONLY" },
        { key: "disclose", value: true },
        { key: "brandedContent", value: true },
      ]),
    ).toBeNull();
  });
});
