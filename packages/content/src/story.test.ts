import { describe, expect, it } from "vitest";
import { STORY_PHOTO_MAX, storyPhotoOf } from "./story.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

describe("a story photo", () => {
  it("takes a JPG or PNG by name and bytes, stored as .jpg or .png", () => {
    expect(storyPhotoOf("bts.JPEG", JPEG)).toBe(".jpg");
    expect(storyPhotoOf("bts.jpg", JPEG)).toBe(".jpg");
    expect(storyPhotoOf("desk.png", PNG)).toBe(".png");
  });

  it("refuses another type, a mislabeled file, an empty one, one over 2 MB", () => {
    expect(() => storyPhotoOf("clip.mp4", JPEG)).toThrow(/JPG or PNG/);
    expect(() => storyPhotoOf("noname", JPEG)).toThrow(/JPG or PNG/);
    expect(() => storyPhotoOf("bts.jpg", PNG)).toThrow(/isn't the JPG/);
    expect(() => storyPhotoOf("bts.jpg", new Uint8Array())).toThrow(/empty/);
    const big = new Uint8Array(STORY_PHOTO_MAX + 1);
    big.set(JPEG);
    expect(() => storyPhotoOf("bts.jpg", big)).toThrow(/2 MB/);
  });
});
