import { describe, expect, it } from "vitest";
import { ATTACH_MAX_BYTES, attachmentOf } from "./attach.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const SRT = new TextEncoder().encode("1\n00:00:00,000 --> 00:00:01,000\nHi\n");

describe("a file on a post field", () => {
  it("takes a thumbnail, a cover and subtitles by name and bytes", () => {
    expect(attachmentOf("youtube", "thumbnail", "t.png", PNG)).toBe(".png");
    expect(attachmentOf("youtube", "captions", "en.srt", SRT)).toBe(".srt");
    expect(attachmentOf("instagram", "cover", "c.jpg", JPEG)).toBe(".jpg");
  });

  it("refuses a field with no file, a wrong type, a renamed file and a big one", () => {
    expect(() => attachmentOf("youtube", "title", "t.png", PNG)).toThrow("takes no file");
    expect(() => attachmentOf("reddit", "image", "i.png", PNG)).toThrow("takes no file");
    expect(() => attachmentOf("instagram", "cover", "c.png", PNG)).toThrow("Cover");
    expect(() => attachmentOf("youtube", "thumbnail", "t.png", JPEG)).toThrow("isn't the PNG");
    const big = new Uint8Array(ATTACH_MAX_BYTES + 1);
    big.set(PNG);
    expect(() => attachmentOf("youtube", "thumbnail", "t.png", big)).toThrow("up to 2 MB");
  });
});
