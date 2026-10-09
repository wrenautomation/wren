import { describe, expect, it } from "vitest";
import { PLATFORMS } from "./index.js";
import {
  fieldsOf,
  fieldViews,
  mediaUnfit,
  missingFields,
  patchFields,
  SHAPES,
  ShapeError,
  tagsLength,
} from "./shapes.js";

describe("post shapes", () => {
  it("has one for every platform, each field labeled", () => {
    for (const p of PLATFORMS) {
      expect(SHAPES[p].fields.length).toBeGreaterThan(0);
      for (const f of SHAPES[p].fields) expect(f.label).not.toBe("");
    }
  });

  it("parses a YouTube draft typed and drops keys it doesn't know", () => {
    const f = fieldsOf("youtube", {
      title: "A title",
      privacyStatus: "unlisted",
      madeForKids: false,
      tags: ["ops", "growth"],
      stray: 1,
    });
    expect(f).toEqual({
      title: "A title",
      privacyStatus: "unlisted",
      madeForKids: false,
      tags: ["ops", "growth"],
    });
  });

  it("refuses a bad value in the field's words", () => {
    expect(() => fieldsOf("youtube", { privacyStatus: "friends" })).toThrow(
      "Who sees it: pick one of the options",
    );
    expect(() => fieldsOf("youtube", { title: "x".repeat(101) })).toThrow("Title: up to 100");
    expect(() => fieldsOf("reddit", { subreddit: "no spaces here" })).toThrow(ShapeError);
    expect(() => fieldsOf("instagram", { collaborators: ["a", "b", "c", "d"] })).toThrow(
      "Collaborators: up to 3",
    );
    expect(() => fieldsOf("youtube", { captions: "s3://b/media/x.txt" })).toThrow("Subtitles");
  });

  it("counts YouTube tags the way YouTube does", () => {
    expect(tagsLength(["a", "b c"])).toBe(1 + 5 + 1);
    const many = Array.from({ length: 60 }, (_, i) => `tag number ${i}`);
    expect(() => fieldsOf("youtube", { tags: many })).toThrow("500 characters");
  });

  it("patches: null unsets, the title comes back apart, changes are listed", () => {
    const out = patchFields(
      "reddit",
      { subreddit: "startups", sendReplies: false },
      { title: "New title", sendReplies: null, url: "https://example.com/a" },
    );
    expect(out.title).toBe("New title");
    expect(out.extra).toEqual({ subreddit: "startups", url: "https://example.com/a" });
    expect(out.changed).toEqual({
      sendReplies: [false, null],
      url: [null, "https://example.com/a"],
    });
  });

  it("refuses a field in development, an unknown one and a read-only one", () => {
    expect(() => patchFields("reddit", {}, { image: "s3://m/a.png" })).toThrow("in development");
    expect(() => patchFields("reddit", {}, { color: "red" })).toThrow("no field color");
    expect(() => patchFields("youtube", {}, { kind: "short" })).toThrow("set when");
  });

  it("names the required fields still unset", () => {
    expect(missingFields("reddit", {}, null)).toEqual(["Subreddit", "Title"]);
    expect(missingFields("reddit", { subreddit: "startups" }, "T")).toEqual([]);
    // Who sees it and Made for kids have defaults: never missing.
    expect(missingFields("youtube", {}, "T")).toEqual([]);
    expect(missingFields("linkedin", {}, null)).toEqual([]);
  });

  it("shows a Short no thumbnail upload, and says why", () => {
    const video = fieldViews("youtube", {}, "T").filter((f) => f.label === "Thumbnail");
    const short = fieldViews("youtube", { kind: "short" }, "T").filter(
      (f) => f.label === "Thumbnail",
    );
    expect(video.map((f) => f.status)).toEqual(["sent"]);
    expect(short.map((f) => f.status)).toEqual(["none"]);
    expect(fieldViews("youtube", {}, "T").find((f) => f.key === "title")?.value).toBe("T");
  });

  it("keeps a thread's kind and a carousel's slides, read-only, on their kind", () => {
    expect(fieldsOf("x", { kind: "thread" })).toEqual({ kind: "thread" });
    expect(() => patchFields("x", {}, { kind: "thread" })).toThrow(/set when the post is made/);
    const slides = Array.from({ length: 5 }, (_, i) => ({ title: `Slide ${i + 1}`, lines: ["a"] }));
    expect(fieldsOf("instagram", { kind: "carousel", slides }).slides).toHaveLength(5);
    expect(() => fieldsOf("linkedin", { kind: "document", slides: slides.slice(0, 2) })).toThrow(
      /Slides: 5 to 10/,
    );
    expect(() => patchFields("linkedin", { kind: "document" }, { slides })).toThrow(ShapeError);
    const reel = fieldViews("instagram", {}, null).map((f) => f.key);
    const carousel = fieldViews("instagram", { kind: "carousel" }, null).map((f) => f.key);
    expect(reel).toContain("cover");
    expect(reel).not.toContain("slides");
    expect(carousel).toContain("slides");
    expect(carousel).not.toContain("cover");
  });
  it("X takes up to four images or a poll, and says which clash with the post's file", () => {
    expect(fieldsOf("x", { images: ["s3://m/a.jpg"], pollMinutes: 30 }).images).toEqual([
      "s3://m/a.jpg",
    ]);
    expect(() => fieldsOf("x", { poll: ["a", "b"], images: ["s3://m/a.jpg"] })).toThrow(
      /poll or images/,
    );
    expect(() => fieldsOf("x", { poll: ["only one"] })).toThrow(/2 to 4/);
    expect(() => fieldsOf("x", { pollMinutes: 2 })).toThrow(/5 minutes/);
    expect(mediaUnfit("x", { images: ["/a.jpg"] }, { kind: "video" })).toMatch(/goes alone/);
    expect(mediaUnfit("x", { poll: ["a", "b"] }, { kind: "image" })).toMatch(/poll or a file/);
    expect(mediaUnfit("x", { images: ["/a", "/b", "/c"] }, { kind: "image" })).toBeNull();
    expect(mediaUnfit("linkedin", { poll: ["a", "b"] }, { kind: "image" })).toBeNull();
  });
});
