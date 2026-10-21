import type { MetroBody, MetroTrack } from "@wren/pipeline/metro";
import { describe, expect, it } from "vitest";
import type { Person } from "./model.js";
import { hoursSay, promiseHours, tasksOf, waitsOf } from "./tasks.js";

const NOW = new Date("2026-10-21T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 36e5).toISOString();

const person = (id: string, node: string, h: number | null): Person => ({
  id,
  name: `Person ${id}`,
  node,
  nodeName: node,
  movedAt: h === null ? null : hoursAgo(h),
  daysAtNode: 0,
});

const track = (
  over: Partial<MetroTrack> & { id: string; from: string; to: string },
): MetroTrack => ({
  by: "person",
  owner: "Ada North",
  ...over,
});

const metro: MetroBody = {
  model: "metro",
  name: "Sample",
  lines: [
    { id: "yt", label: "YouTube", tier: "out" },
    { id: "web", label: "Webinar", tier: "front", offer: "starter", colour: 0 },
  ],
  stations: [
    { id: "post", label: "Post a video", kind: "att", line: "yt", column: "marketing" },
    { id: "hub", label: "Hub", kind: "hub", column: "marketing" },
    { id: "reply", label: "Replied", kind: "att", line: "web", column: "sales" },
    { id: "book", label: "Booked", kind: "time", line: "web", column: "sales" },
    { id: "pay", label: "Paid", kind: "cash", line: "web", column: "money" },
  ],
  tracks: [
    track({ id: "post_to_hub", from: "post", to: "hub", owner: "Cai Moreno", promise: "1d" }),
    track({ id: "hub_to_reply", from: "hub", to: "reply", owner: "Ada North", promise: "4h" }),
    track({ id: "reply_to_book", from: "reply", to: "book", owner: "Ada North", promise: "4h" }),
    track({ id: "book_to_pay", from: "book", to: "pay", owner: "Bo Fenwick", promise: "2d" }),
    track({ id: "reply_to_pay", from: "reply", to: "pay", by: "system" }),
  ],
  groups: [],
  frames: [],
};

describe("promiseHours", () => {
  it("reads minutes, hours and days", () => {
    expect(promiseHours("30m")).toBe(0.5);
    expect(promiseHours("4h")).toBe(4);
    expect(promiseHours("2d")).toBe(48);
  });
  it("answers null for anything else", () => {
    for (const bad of ["", "soon", "4", "h", "4 h", "1.5h", "-2h"])
      expect(promiseHours(bad)).toBeNull();
  });
});

describe("waitsOf", () => {
  const t = track({ id: "a", from: "reply", to: "book", promise: "4h" });
  it("counts the people at the from-station and takes the median", () => {
    const got = waitsOf(
      t,
      [person("1", "reply", 1), person("2", "reply", 3), person("3", "book", 99)],
      NOW,
    );
    expect(got).toEqual({ waiting: 2, medianHours: 2, late: false });
  });
  it("is late when any one person waits past the promise", () => {
    const got = waitsOf(t, [person("1", "reply", 1), person("2", "reply", 5)], NOW);
    expect(got.late).toBe(true);
    expect(got.medianHours).toBe(3);
  });
  it("is not late at exactly the promise", () => {
    expect(waitsOf(t, [person("1", "reply", 4)], NOW).late).toBe(false);
  });
  it("is never late without a promise", () => {
    const none = track({ id: "b", from: "reply", to: "book" });
    expect(waitsOf(none, [person("1", "reply", 900)], NOW).late).toBe(false);
  });
  it("counts a person with no move time but takes no hours from them", () => {
    expect(waitsOf(t, [person("1", "reply", null)], NOW)).toEqual({
      waiting: 1,
      medianHours: null,
      late: false,
    });
  });
  it("gives nothing for a track that leaves the hub", () => {
    const out = track({ id: "c", from: "hub", to: "reply", promise: "4h" });
    expect(waitsOf(out, [person("1", "hub", 90)], NOW)).toEqual({
      waiting: 0,
      medianHours: null,
      late: false,
    });
  });
});

describe("tasksOf", () => {
  const people = [
    person("1", "reply", 6),
    person("2", "reply", 7),
    person("3", "book", 1),
    person("4", "post", 2),
  ];
  const got = tasksOf(metro, people, NOW);

  it("lists person tracks with an owner only", () => {
    expect(got.map((x) => x.id).sort()).toEqual(
      ["book_to_pay", "hub_to_reply", "post_to_hub", "reply_to_book"].sort(),
    );
  });
  it("puts late first, then most waiting, then name", () => {
    // reply_to_book is late (6h and 7h past 4h). The rest are on time.
    expect(got.map((x) => x.id)).toEqual([
      "reply_to_book",
      // One waiting each: "Hub" sorts before "Paid".
      "post_to_hub",
      "book_to_pay",
      "hub_to_reply",
    ]);
  });
  it("breaks a tie on waiting by name", () => {
    const tie = tasksOf(metro, [], NOW).map((x) => x.name);
    expect(tie).toEqual([...tie].sort((a, b) => a.localeCompare(b)));
  });
  it("fills a task from the stations and the line", () => {
    expect(got[0]).toEqual({
      id: "reply_to_book",
      name: "Booked",
      owner: "Ada North",
      initials: "AN",
      line: "web",
      lineName: "Webinar",
      at: "Replied",
      waiting: 2,
      medianHours: 6.5,
      promise: "4h",
      promiseHours: 4,
      late: true,
    });
  });
  it("takes the from-station's line for a track into the hub", () => {
    const x = got.find((t) => t.id === "post_to_hub");
    expect(x).toMatchObject({ line: "yt", lineName: "YouTube", waiting: 1, late: false });
  });
  it("lists a track out of the hub with 0 waiting", () => {
    expect(got.find((t) => t.id === "hub_to_reply")).toMatchObject({
      waiting: 0,
      medianHours: null,
      late: false,
      line: "web",
    });
  });
  it("gives a one-word owner one letter", () => {
    const one = tasksOf(
      { ...metro, tracks: [track({ id: "x", from: "reply", to: "book", owner: "ada" })] },
      [],
      NOW,
    );
    expect(one[0]?.initials).toBe("A");
  });
});

describe("hoursSay", () => {
  it("picks minutes, hours or days", () => {
    expect(hoursSay(0.5)).toBe("30m");
    expect(hoursSay(6.4)).toBe("6h");
    expect(hoursSay(47)).toBe("47h");
    expect(hoursSay(72)).toBe("3d");
  });
});
