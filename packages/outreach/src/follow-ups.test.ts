import type { ThreadNode, ThreadRead } from "@wren/core/outreach";
import { describe, expect, it } from "vitest";
import { answerFor } from "./comments.js";
import {
  focusesOf,
  followUpsOf,
  mergeReads,
  needsRead,
  nextCheckAt,
  THREAD_FLOOR_MS,
  THREAD_IDLE_MS,
} from "./follow-ups.js";

// Synthetic thread: our account "wren_test", a first replier "replier_a", a third "replier_b".
const node = (
  ref: string,
  parent: string,
  handle: string,
  at: string,
  text = `${handle} says`,
): ThreadNode => ({
  ref,
  parent,
  handle,
  text,
  at,
  url: `https://example.test/c/${ref}`,
});
const readOf = (nodes: ThreadNode[], more = 0): ThreadRead => ({
  post: {
    ref: "t3_post",
    title: "A synthetic post",
    text: null,
    handle: "poster",
    url: "https://example.test/p",
    place: "r/test",
    media: null,
    at: "2026-10-01T00:00:00.000Z",
    count: nodes.length,
  },
  nodes,
  more,
});
const OURS = ["wren_test"];

describe("followUpsOf", () => {
  const thread = readOf([
    node("t1_ours", "t3_post", "wren_test", "2026-10-01T01:00:00.000Z"),
    node("t1_a1", "t1_ours", "replier_a", "2026-10-01T02:00:00.000Z", "First reply"),
    // Their reply to their own reply: the inbox never lists it.
    node("t1_a2", "t1_a1", "replier_a", "2026-10-01T03:00:00.000Z", "And a question?"),
    // A third person, deep under the follow-up.
    node("t1_b1", "t1_a2", "replier_b", "2026-10-01T04:00:00.000Z", "Same question"),
    // Elsewhere in the post, not under ours: someone else's chat.
    node("t1_x1", "t3_post", "stranger", "2026-10-01T01:30:00.000Z"),
    node("t1_x2", "t1_x1", "other", "2026-10-01T01:40:00.000Z"),
    // The first replier again, elsewhere in the thread: still talking to us.
    node("t1_a3", "t1_x1", "replier_a", "2026-10-01T05:00:00.000Z", "Over here too"),
    node("t1_ours2", "t1_a2", "wren_test", "2026-10-01T06:00:00.000Z"),
  ]);
  const known = new Set(["t1_a1"]);

  it("catches a self-reply under our comment that the inbox missed", () => {
    const got = followUpsOf(thread, { ours: OURS, talking: ["replier_a"], known });
    const a2 = got.find((c) => c.ref === "t1_a2");
    expect(a2).toMatchObject({
      handle: "replier_a",
      parent: "t1_a1",
      kind: "thread_reply",
      post: "t3_post",
    });
    expect(a2?.raw).toMatchObject({ via: "thread", parentAuthor: "replier_a" });
  });

  it("catches a third person's deep reply to the follow-up", () => {
    const got = followUpsOf(thread, { ours: OURS, talking: ["replier_a"], known });
    expect(got.find((c) => c.ref === "t1_b1")).toMatchObject({
      handle: "replier_b",
      kind: "thread_reply",
    });
  });

  it("takes the talking person anywhere, skips strangers, ours and what is kept", () => {
    const refs = followUpsOf(thread, { ours: OURS, talking: ["replier_a"], known }).map(
      (c) => c.ref,
    );
    expect(refs).toEqual(["t1_a2", "t1_b1", "t1_a3"]);
    expect(refs).not.toContain("t1_a1");
    expect(refs).not.toContain("t1_x2");
    expect(refs).not.toContain("t1_ours2");
  });

  it("never doubles: a second pass over the same read with the first's refs kept finds nothing", () => {
    const first = followUpsOf(thread, { ours: OURS, talking: ["replier_a"], known });
    const again = followUpsOf(thread, {
      ours: OURS,
      talking: ["replier_a"],
      known: new Set([...known, ...first.map((c) => c.ref)]),
    });
    expect(again).toEqual([]);
  });

  it("marks a direct reply to ours as a comment reply and skips the deleted", () => {
    const t = readOf([
      node("t1_ours", "t3_post", "Wren_Test", "2026-10-01T01:00:00.000Z"),
      node("t1_d", "t1_ours", "[deleted]", "2026-10-01T02:00:00.000Z"),
      node("t1_r", "t1_ours", "replier_a", "2026-10-01T03:00:00.000Z"),
    ]);
    const got = followUpsOf(t, { ours: OURS, talking: [], known: new Set() });
    expect(got.map((c) => [c.ref, c.kind])).toEqual([["t1_r", "comment_reply"]]);
  });

  it("survives a parent loop", () => {
    const t = readOf([
      node("t1_p", "t1_q", "replier_a", "2026-10-01T01:00:00.000Z"),
      node("t1_q", "t1_p", "replier_b", "2026-10-01T02:00:00.000Z"),
    ]);
    expect(followUpsOf(t, { ours: OURS, talking: [], known: new Set() })).toEqual([]);
  });
});

describe("mergeReads", () => {
  it("adds a focused read's nodes once, oldest first", () => {
    const base = readOf([node("t1_a", "t3_post", "x", "2026-10-01T02:00:00.000Z")], 3);
    const focus = readOf([
      node("t1_a", "t3_post", "x", "2026-10-01T02:00:00.000Z"),
      node("t1_b", "t1_a", "y", "2026-10-01T01:00:00.000Z"),
    ]);
    const got = mergeReads(base, [focus, focus]);
    expect(got.nodes.map((n) => n.ref)).toEqual(["t1_b", "t1_a"]);
    expect(got.more).toBe(3);
  });
});

describe("cadence", () => {
  const now = new Date("2026-10-10T12:00:00.000Z");
  it("waits at least the floor while fresh and the idle wait after a day", () => {
    const fresh = nextCheckAt(new Date(now.getTime() - 60_000), now, 0.5).getTime() - now.getTime();
    expect(fresh).toBeGreaterThanOrEqual(THREAD_FLOOR_MS);
    const idle =
      nextCheckAt(new Date(now.getTime() - 2 * 86_400_000), now, 0.5).getTime() - now.getTime();
    expect(idle).toBe(THREAD_IDLE_MS);
  });
  it("reads when never read, when the count moved, or on the sweep", () => {
    const t = { readAt: null, count: 4 } as Parameters<typeof needsRead>[0];
    expect(needsRead(t, 4, now)).toBe(true);
    const read = { ...t, readAt: new Date(now.getTime() - 60_000) };
    expect(needsRead(read, 4, now)).toBe(false);
    expect(needsRead(read, 5, now)).toBe(true);
    expect(needsRead({ ...read, readAt: new Date(now.getTime() - 13 * 3600_000) }, 4, now)).toBe(
      true,
    );
  });
  it("focuses our newest comments first", () => {
    const t = readOf([
      node("t1_o1", "t3_post", "wren_test", "2026-10-01T01:00:00.000Z"),
      node("t1_o2", "t3_post", "wren_test", "2026-10-01T03:00:00.000Z"),
      node("t1_o3", "t3_post", "wren_test", "2026-10-01T02:00:00.000Z"),
    ]);
    expect(focusesOf(t, OURS)).toEqual(["t1_o2", "t1_o3"]);
  });
});

describe("answerFor", () => {
  const c = (platform: string, kind: string, author = "replier_a") =>
    ({ platform, kind, author, ref: "c2", parent: "c1", post: "p1" }) as Parameters<
      typeof answerFor
    >[0];
  it("answers a reply to a reply under its parent on one-level sites, naming them", () => {
    expect(answerFor(c("instagram", "thread_reply"), "Thanks")).toEqual({
      target: "c1",
      text: "@replier_a Thanks",
    });
    expect(answerFor(c("youtube", "thread_reply"), "@replier_a Thanks")).toEqual({
      target: "c1",
      text: "@replier_a Thanks",
    });
  });
  it("answers in place where the site nests", () => {
    expect(answerFor(c("reddit", "thread_reply"), "Thanks")).toEqual({
      target: "c2",
      text: "Thanks",
    });
  });
});
