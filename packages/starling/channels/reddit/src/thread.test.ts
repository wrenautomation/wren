import { describe, expect, it } from "vitest";
import { threadOf, threadQuery } from "./thread.js";

const listing = (rows: Array<[string, Record<string, unknown>]>) => ({
  kind: "Listing",
  data: { children: rows.map(([kind, data]) => ({ kind, data })) },
});
const t1 = (id: string, parent: string, author: string, utc: number, replies: unknown = "") =>
  [
    "t1",
    {
      id,
      name: `t1_${id}`,
      parent_id: parent,
      author,
      body: `${author} says ${id}`,
      created_utc: utc,
      permalink: `/r/sales/comments/p1/x/${id}/`,
      replies,
    },
  ] as [string, Record<string, unknown>];

describe("reddit thread", () => {
  const now = () => new Date("2026-10-15T12:00:00Z");

  it("flattens every depth oldest first, keeps parents, counts load-more stubs", () => {
    const read = threadOf(
      "t3_p1",
      [
        listing([
          [
            "t3",
            {
              name: "t3_p1",
              title: "How do you price?",
              selftext: "Asking for a friend",
              author: "poster",
              subreddit: "sales",
              permalink: "/r/sales/comments/p1/x/",
              num_comments: 5,
              thumbnail: "self",
              created_utc: 1_790_000_000,
            },
          ],
        ]),
        listing([
          t1(
            "ours",
            "t3_p1",
            "wren_bot",
            1_790_000_100,
            listing([
              t1(
                "a1",
                "t1_ours",
                "asker",
                1_790_000_200,
                listing([
                  t1(
                    "a2",
                    "t1_a1",
                    "asker",
                    1_790_000_300,
                    listing([t1("b1", "t1_a2", "third", 1_790_000_400)]),
                  ),
                ]),
              ),
            ]),
          ),
          ["more", { count: 4, children: ["x", "y"] }],
        ]),
      ],
      now,
    );
    expect(read.post).toMatchObject({
      ref: "t3_p1",
      title: "How do you price?",
      text: "Asking for a friend",
      place: "sales",
      media: null,
      count: 5,
      url: "https://www.reddit.com/r/sales/comments/p1/x/",
    });
    expect(read.nodes.map((n) => [n.ref, n.parent, n.handle])).toEqual([
      ["t1_ours", "t3_p1", "wren_bot"],
      ["t1_a1", "t1_ours", "asker"],
      ["t1_a2", "t1_a1", "asker"],
      ["t1_b1", "t1_a2", "third"],
    ]);
    expect(read.more).toBe(4);
    expect(read.nodes[1]?.url).toBe("https://www.reddit.com/r/sales/comments/p1/x/a1/?context=3");
  });

  it("asks deep and old-first; a focus reads around one comment", () => {
    expect(threadQuery()).toEqual({ raw_json: 1, limit: 500, depth: 10, sort: "old" });
    expect(threadQuery("t1_ours")).toMatchObject({ comment: "ours", context: 8 });
  });

  it("a broken answer reads as an empty thread, not a throw", () => {
    expect(threadOf("p9", null, now)).toMatchObject({ post: { ref: "t3_p9" }, nodes: [], more: 0 });
  });
});
