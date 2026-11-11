import { describe, expect, it } from "vitest";
import { type ItemRow, itemChanges, itemSource, providerOf } from "./knowledge.js";

const row = (over: Partial<ItemRow["item"]> = {}): ItemRow => ({
  item: {
    id: 7,
    url: "https://www.instagram.com/reel/AbC123/",
    type: "instagram",
    title: "A reel",
    creator: "maker",
    text: "the caption",
    transcript: "what was said",
    score: 8,
    verdict: "show",
    why: "a clear hook",
    moments: [],
    changes: ["offers"],
    publishedAt: new Date("2026-10-01T00:00:00Z"),
    ...over,
  } as ItemRow["item"],
  breakdown: null,
  feed: { name: "Maker", url: "https://www.instagram.com/maker/", kind: "instagram" },
  tags: ["hooks"],
});

describe("itemSource", () => {
  it("keeps caption and transcript in the body, the rest as fields", () => {
    const { fields, body } = itemSource(row());
    expect(fields).toMatchObject({
      kind: "reel",
      handle: "maker",
      date: "2026-10-01",
      learnItem: 7,
      sops: ["offers"],
    });
    expect(fields.moments).toBeUndefined();
    expect(body).toBe("# A reel\n\n## Caption\n\nthe caption\n\n## Transcript\n\nwhat was said");
  });
});

describe("itemChanges", () => {
  it("adds a new item, follows its own record, and only fills gaps in an SOP's", () => {
    const add = itemChanges(new Map(), [row()]);
    expect(add).toMatchObject([{ op: "add", id: "instagram-AbC123", tags: ["learn", "hooks"] }]);

    const { fields, body } = itemSource(row());
    const ours = new Map([
      [
        "instagram-AbC123",
        { fm: { type: "source", origin: "learn", ...fields, tags: ["learn", "hooks"] }, body },
      ],
    ]);
    expect(itemChanges(ours, [row()])).toEqual([]);
    expect(itemChanges(ours, [row({ score: 9 })])).toEqual([
      { op: "edit", id: "instagram-AbC123", score: 9 },
    ]);

    const sop = new Map([
      [
        "instagram-AbC123",
        {
          fm: {
            type: "source",
            url: "https://instagram.com/reel/AbC123",
            title: "Kept",
            tags: ["offers"],
          },
          body: "theirs",
        },
      ],
    ]);
    const [edit] = itemChanges(sop, [row()]);
    expect(edit).toMatchObject({
      op: "edit",
      id: "instagram-AbC123",
      learnItem: 7,
      tags: ["offers", "learn", "hooks"],
    });
    expect(edit).not.toHaveProperty("title");
    expect(edit).not.toHaveProperty("body");

    // after the first run the SOP's record holds Learn's fields: only they follow the item
    const merged = new Map([
      ["instagram-AbC123", { fm: { ...sop.get("instagram-AbC123")?.fm, ...edit }, body: "theirs" }],
    ]);
    expect(itemChanges(merged, [row({ score: 9, title: "New" })])).toEqual([
      { op: "edit", id: "instagram-AbC123", score: 9 },
    ]);
  });
});

describe("providerOf", () => {
  it("a person named at save is human; the CLI's own saves and feed imports are agents", () => {
    expect(providerOf({ savedBy: "william", savedVia: "cli" })).toEqual({
      kind: "human",
      who: "william",
    });
    expect(providerOf({ savedBy: "cli", savedVia: "cli" })).toEqual({
      kind: "agent",
      who: "learn-cli",
    });
    expect(providerOf({ savedBy: null, savedVia: null })).toEqual({
      kind: "agent",
      who: "learn-feed",
    });
    const [add] = itemChanges(new Map(), [row({ savedBy: "william", savedVia: "cli" } as never)]);
    expect(add).toMatchObject({ op: "add", provider: { kind: "human", who: "william" } });
  });
});
