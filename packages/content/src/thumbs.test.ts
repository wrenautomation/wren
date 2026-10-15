/** A card's picture: which of a draft's or a recording's files it shows. */
import { describe, expect, it } from "vitest";
import { draftPicture, videoPicture } from "./thumbs.js";

describe("draftPicture", () => {
  const base = { platform: "linkedin" as const, extra: {}, title: null };
  it("its image first", () => {
    expect(draftPicture({ ...base, media: { kind: "image", source: "s3://b/a.png" } })).toEqual({
      source: "s3://b/a.png",
      kind: "image",
    });
  });
  it("a video plays when nothing stills it", () => {
    expect(draftPicture({ ...base, media: { kind: "video", source: "v.mp4" } })).toEqual({
      source: "v.mp4",
      kind: "video",
    });
  });
  it("words only: none", () => {
    expect(draftPicture({ ...base, media: null })).toBeNull();
  });
});

describe("videoPicture", () => {
  it("the picked thumbnail's key", () => {
    expect(
      videoPicture({
        files: { thumb1: "/a/1.png", thumb2: "/a/2.png", thumbnailPick: "/a/2.png" },
        keys: { thumb1: "k/1.png", thumb2: "k/2.png", long: "k/long.mp4" },
      }),
    ).toEqual({ source: "k/2.png", kind: "image" });
  });
  it("else the first, else a cover, else the cut plays", () => {
    expect(
      videoPicture({ files: {}, keys: { thumb2: "k/2.png", thumb1: "k/1.png" } })?.source,
    ).toBe("k/1.png");
    expect(videoPicture({ files: {}, keys: { "cover-vertical": "k/c.png" } })?.source).toBe(
      "k/c.png",
    );
    expect(videoPicture({ files: {}, keys: { long: "k/long.mp4" } })).toEqual({
      source: "k/long.mp4",
      kind: "video",
    });
    expect(videoPicture({ files: {}, keys: {} })).toBeNull();
  });
});
