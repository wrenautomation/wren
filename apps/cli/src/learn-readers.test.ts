import { describe, expect, it } from "vitest";
import { metaOf } from "./learn-readers.js";

describe("metaOf", () => {
  it("gives yt-dlp's fields from what the feed said", () => {
    expect(
      metaOf({
        text: " Full caption\nsecond line ",
        creator: "@maker",
        publishedAt: new Date("2026-09-30T21:40:31Z"),
      }),
    ).toEqual({
      description: "Full caption\nsecond line",
      uploader: "maker",
      upload_date: "20260930",
    });
  });

  it("leaves out what the feed didn't say", () => {
    expect(metaOf({ text: "", creator: null, publishedAt: null })).toEqual({});
  });
});
