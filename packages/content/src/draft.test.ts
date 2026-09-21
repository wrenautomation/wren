import { describe, expect, it } from "vitest";
import { draftPrompt, unfitProposal } from "./draft.js";
import { PLATFORM_SPECS, postOf, unfitReason } from "./platforms.js";
import { DEFAULT_BRAND, DEFAULT_VOICE } from "./voice.js";

const idea = {
  text: "shipped the spend gate today. every buy asks me on discord first.",
  media: null,
};

describe("draftPrompt", () => {
  it("carries the voice, the platform shape, the idea and the answer shape", () => {
    const p = draftPrompt(idea, PLATFORM_SPECS.x, { voice: DEFAULT_VOICE, brand: DEFAULT_BRAND });
    expect(p).toContain("Extremely concise");
    expect(p).toContain("one post on X");
    expect(p).toContain(idea.text);
    expect(p).toContain('{"text": "<the post>"}');
    expect(p).not.toContain("title");
  });
  it("asks for a title on YouTube and mentions the video", () => {
    const p = draftPrompt(
      { text: "x", media: { kind: "video", source: "/tmp/a.mp4", title: "Spend gate demo" } },
      PLATFORM_SPECS.youtube,
      { voice: "v", brand: DEFAULT_BRAND },
    );
    expect(p).toContain('{"title": "<the title>"');
    expect(p).toContain('carries a video: "Spend gate demo"');
    expect(p).toContain("inside 100 characters");
  });
});

describe("unfitProposal", () => {
  it("refuses over-length text, a missing or long title, empty text", () => {
    expect(unfitProposal(PLATFORM_SPECS.x, { text: "a".repeat(281) })).toMatch(/over 280/);
    expect(unfitProposal(PLATFORM_SPECS.x, { text: "fine" })).toBeNull();
    expect(unfitProposal(PLATFORM_SPECS.youtube, { text: "d" })).toBe("no title");
    expect(unfitProposal(PLATFORM_SPECS.youtube, { text: "d", title: "t".repeat(101) })).toMatch(
      /over 100/,
    );
    expect(unfitProposal(PLATFORM_SPECS.youtube, { text: "d", title: "t" })).toBeNull();
    expect(unfitProposal(PLATFORM_SPECS.linkedin, { text: "   " })).toBe("empty text");
  });
});

describe("unfitReason", () => {
  it("needs a video for reels, shorts and tiktoks; text is fine elsewhere", () => {
    expect(unfitReason(PLATFORM_SPECS.instagram, null)).toMatch(/needs a video/);
    expect(unfitReason(PLATFORM_SPECS.tiktok, { kind: "image", source: "a.png" })).toMatch(
      /not an image/,
    );
    expect(unfitReason(PLATFORM_SPECS.youtube, { kind: "video", source: "a.mp4" })).toBeNull();
    expect(unfitReason(PLATFORM_SPECS.x, null)).toBeNull();
  });
});

describe("postOf", () => {
  it("puts the title in extra and keeps the media", () => {
    const media = { kind: "video" as const, source: "/v.mp4" };
    expect(postOf({ text: "d", title: "T", media, extra: { privacyStatus: "public" } })).toEqual({
      text: "d",
      media,
      extra: { privacyStatus: "public", title: "T" },
    });
    expect(postOf({ text: "d", title: null, media: null, extra: {} })).toEqual({ text: "d" });
  });
});
