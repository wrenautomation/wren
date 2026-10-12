import { describe, expect, it } from "vitest";
import { gbpPush, metaPushes, socialWatchKey } from "./social-push.js";

describe("metaPushes", () => {
  it("reads a Page's comment and DM entries", () => {
    const body = {
      object: "page",
      entry: [
        {
          id: "111",
          time: 1,
          changes: [
            { field: "feed", value: { item: "comment", post_id: "111_222", verb: "add" } },
            { field: "feed", value: { item: "reaction", post_id: "111_222" } },
          ],
        },
        { id: "111", time: 2, messaging: [{ sender: { id: "9" }, message: { mid: "m" } }] },
      ],
    };
    expect(metaPushes(body)).toEqual([
      { account: "111", platform: "facebook", kind: "comment", post: "111_222" },
      { account: "111", platform: "facebook", kind: "dm" },
    ]);
  });

  it("reads Instagram comments by media, messages and mentions; one push per post", () => {
    const body = {
      object: "instagram",
      entry: [
        {
          id: "17841",
          time: 1,
          changes: [
            { field: "comments", value: { id: "c1", media: { id: "m1" } } },
            { field: "comments", value: { id: "c2", media: { id: "m1" } } },
            { field: "mentions", value: { media_id: "m2" } },
            { field: "messages", value: {} },
          ],
        },
      ],
    };
    expect(metaPushes(body)).toEqual([
      { account: "17841", platform: "instagram", kind: "comment", post: "m1" },
      { account: "17841", platform: "instagram", kind: "activity" },
      { account: "17841", platform: "instagram", kind: "dm" },
    ]);
  });

  it("drops other objects and junk", () => {
    expect(metaPushes({ object: "user", entry: [{ id: "1" }] })).toEqual([]);
    expect(metaPushes(null)).toEqual([]);
    expect(metaPushes({ object: "page", entry: [{ changes: [] }] })).toEqual([]);
  });
});

describe("gbpPush", () => {
  it("takes new and updated reviews by location", () => {
    expect(
      gbpPush({ type: "NEW_REVIEW", location: "accounts/1/locations/2", review: "x" }),
    ).toEqual({ account: "accounts/1/locations/2", platform: "google_business", kind: "review" });
    expect(gbpPush({ type: "UPDATED_REVIEW", review: "accounts/1/locations/2/reviews/r" })).toEqual(
      { account: "accounts/1/locations/2", platform: "google_business", kind: "review" },
    );
    expect(gbpPush({ type: "NEW_QUESTION", location: "accounts/1/locations/2" })).toBeNull();
  });
});

describe("socialWatchKey", () => {
  it("is ours bare and a client's under its unit", () => {
    expect(socialWatchKey("wren")).toBe("wren");
    expect(socialWatchKey("acme")).toBe("acme/social");
  });
});
