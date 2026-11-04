import { describe, expect, it } from "vitest";
import { nextSlot } from "./meta-pace.js";
import { gbpPush, metaComments, metaPushes, metaTaps, socialWatchKey } from "./social-push.js";

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

describe("metaComments", () => {
  it("keeps an Instagram comment from the push, no read", () => {
    const got = metaComments({
      object: "instagram",
      entry: [
        {
          id: "900",
          time: 1_700_000_000,
          changes: [
            {
              field: "comments",
              value: {
                id: "c1",
                text: "GUIDE please",
                from: { id: "42", username: "someone" },
                media: { id: "m1" },
              },
            },
          ],
        },
      ],
    });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      account: "900",
      platform: "instagram",
      post: "m1",
      row: { id: "c1", postId: "m1", author: "someone", text: "GUIDE please" },
    });
    expect(got[0]?.row.mine).toBeUndefined();
    expect(got[0]?.row.at).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("keeps a Page comment's add only, and marks our own", () => {
    const change = (verb: string, from: string, parent = "111_1") => ({
      field: "feed",
      value: {
        item: "comment",
        verb,
        post_id: "111_1",
        comment_id: `c-${verb}`,
        parent_id: parent,
        message: "link",
        from: { id: from, name: "A person" },
        created_time: 1_700_000_000,
      },
    });
    const got = metaComments({
      object: "page",
      entry: [
        {
          id: "111",
          changes: [change("add", "7"), change("edited", "7"), change("remove", "7")],
        },
        {
          id: "111",
          changes: [
            {
              ...change("add", "111", "c-x"),
              value: { ...change("add", "111", "c-x").value, comment_id: "c-ours" },
            },
          ],
        },
      ],
    });
    expect(got.map((c) => c.row.id)).toEqual(["c-add", "c-ours"]);
    expect(got[0]?.row.parentId).toBeUndefined();
    expect(got[1]?.row).toMatchObject({ parentId: "c-x", mine: true });
  });

  it("skips anything else", () => {
    expect(
      metaComments({
        object: "instagram",
        entry: [{ id: "9", changes: [{ field: "mentions", value: {} }] }],
      }),
    ).toEqual([]);
    expect(metaComments({ object: "user" })).toEqual([]);
  });
});

describe("metaTaps", () => {
  it("reads a button's postback and a quick reply, never our own echo", () => {
    const got = metaTaps({
      object: "instagram",
      entry: [
        {
          id: "900",
          messaging: [
            { sender: { id: "42" }, postback: { title: "Send it", payload: "kw:7" } },
            {
              sender: { id: "43" },
              message: { text: "Send it", quick_reply: { payload: "kw:8" } },
            },
            { sender: { id: "900" }, postback: { payload: "kw:9" } },
            { sender: { id: "44" }, message: { text: "hi" } },
          ],
        },
      ],
    });
    expect(got).toEqual([
      { account: "900", platform: "instagram", from: "42", payload: "kw:7" },
      { account: "900", platform: "instagram", from: "43", payload: "kw:8" },
    ]);
  });
});

describe("nextSlot", () => {
  it("spaces sends evenly under the hourly cap", () => {
    expect(nextSlot(null, 1000, 600)).toBe(1000);
    expect(nextSlot(1000, 1000, 600)).toBe(7000);
    expect(nextSlot(1000, 60_000, 600)).toBe(60_000);
  });
});
