import { describe, expect, it } from "vitest";
import { foldRows, type RecordFold } from "./records.js";

// One person's comments in one thread fold into one row (designs/2026-10-15-engage-threads.md).
const FOLD: RecordFold = {
  by: (r) => (r.type === "comment" ? `${r.post}|${String(r.who).toLowerCase()}` : null),
  at: "at",
  open: (r) => r.state === "waiting",
  text: "words",
  state: "state",
  due: "due",
  into: "messages",
};
const row = (
  id: string,
  who: string,
  at: string,
  state: string,
  post = "p1",
  type = "comment",
) => ({
  id,
  type,
  post,
  who,
  at,
  state,
  words: `${id} words`,
  due: at,
});

describe("foldRows", () => {
  it("shows one person's two messages as one row, newest first", () => {
    const got = foldRows(
      [
        row("comment:1", "replier_a", "2026-10-01T02:00:00.000Z", "answered"),
        row("comment:2", "Replier_A", "2026-10-01T03:00:00.000Z", "waiting"),
      ],
      FOLD,
      "id",
    );
    expect(got).toHaveLength(1);
    expect(got[0]?.id).toBe("comment:2");
    const msgs = ((got[0] as Record<string, unknown> | undefined)?.messages ?? []) as {
      id: string;
      open: boolean;
    }[];
    expect(msgs.map((m) => [m.id, m.open])).toEqual([
      ["comment:2", true],
      ["comment:1", false],
    ]);
  });

  it("leads with the newest waiting message, takes the newest time, and is due at the oldest waiting", () => {
    const got = foldRows(
      [
        row("comment:1", "replier_a", "2026-10-01T02:00:00.000Z", "waiting"),
        row("comment:2", "replier_a", "2026-10-01T03:00:00.000Z", "waiting"),
        row("comment:3", "replier_a", "2026-10-01T04:00:00.000Z", "answered"),
      ],
      FOLD,
      "id",
    );
    expect(got[0]).toMatchObject({
      id: "comment:2",
      state: "waiting",
      at: "2026-10-01T04:00:00.000Z",
      due: "2026-10-01T02:00:00.000Z",
    });
  });

  it("an all-answered group leads with its newest and keeps no due from a waiting one", () => {
    const got = foldRows(
      [
        row("comment:1", "replier_a", "2026-10-01T02:00:00.000Z", "answered"),
        row("comment:2", "replier_a", "2026-10-01T03:00:00.000Z", "answered"),
      ],
      FOLD,
      "id",
    );
    expect(got[0]).toMatchObject({
      id: "comment:2",
      state: "answered",
      due: "2026-10-01T03:00:00.000Z",
    });
  });

  it("keeps people, threads and other kinds apart, in their first order", () => {
    const got = foldRows(
      [
        row("dm:9", "replier_a", "2026-10-01T05:00:00.000Z", "waiting", "p1", "dm"),
        row("comment:1", "replier_a", "2026-10-01T02:00:00.000Z", "waiting"),
        row("comment:2", "replier_b", "2026-10-01T03:00:00.000Z", "waiting"),
        row("comment:3", "replier_a", "2026-10-01T04:00:00.000Z", "waiting", "p2"),
        row("comment:4", "replier_a", "2026-10-01T06:00:00.000Z", "waiting"),
      ],
      FOLD,
      "id",
    );
    expect(got.map((r) => r.id)).toEqual(["dm:9", "comment:4", "comment:2", "comment:3"]);
    expect(got[0]).not.toHaveProperty("messages");
  });
});
