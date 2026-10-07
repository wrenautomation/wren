import { describe, expect, it } from "vitest";
import { PLATFORMS } from "./index.js";
import {
  fieldsOf,
  fieldViews,
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
    expect(() => patchFields("reddit", {}, { flair: "Discussion" })).toThrow("in development");
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
});
