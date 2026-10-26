import type { MetroBody } from "@wren/pipeline/metro";
import type { MetroDiff } from "@wren/pipeline/metro-diff";
import { describe, expect, it } from "vitest";
import type { NodeNumbers, Person } from "./model.js";
import { columnOf, kindOf, viewOf } from "./view.js";

const NOW = new Date("2026-10-21T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 36e5).toISOString();

const metro: MetroBody = {
  model: "metro",
  name: "Sample",
  lines: [
    { id: "yt", label: "YouTube", tier: "out" },
    { id: "web", label: "Webinar", tier: "front", offer: "starter", colour: 0 },
  ],
  stations: [
    { id: "post", label: "Post a video", kind: "att", line: "yt", column: "marketing" },
    { id: "hub", label: "First touch", kind: "hub", column: "marketing" },
    { id: "reply", label: "Replied", kind: "att", line: "web", column: "sales" },
    { id: "book", label: "Booked", kind: "time", line: "web", column: "sales" },
    { id: "check", label: "Fits?", kind: "condition", line: "web", column: "sales" },
    { id: "pay", label: "Paid", kind: "cash", line: "web", column: "money", planned: true },
  ],
  tracks: [
    { id: "post_to_hub", from: "post", to: "hub", line: "yt", by: "system" },
    { id: "hub_to_reply", from: "hub", to: "reply", line: "web", by: "system" },
    {
      id: "reply_to_book",
      from: "reply",
      to: "book",
      line: "web",
      by: "person",
      owner: "Ada North",
      promise: "4h",
    },
    { id: "book_to_check", from: "book", to: "check", line: "web", by: "system", cond: "yes" },
  ],
  groups: [{ id: "g1", label: "Talk", line: "web", stations: ["reply", "book"] }],
  frames: [],
};

const row = (id: string, n: Partial<NodeNumbers>): [string, NodeNumbers] => [
  id,
  {
    id,
    now: null,
    arrived: null,
    left: null,
    medianDays: null,
    opened: null,
    replied: null,
    booked: null,
    deals: null,
    collected: null,
    scheduled: null,
    ...n,
  },
];

const numbers = {
  stations: new Map([
    row("hub", { now: 42 }),
    row("reply", { now: 5, medianDays: 4 }),
    row("book", { now: 3 }),
  ]),
};

const person = (id: string, node: string, h: number): Person => ({
  id,
  name: `Person ${id}`,
  node,
  nodeName: node,
  movedAt: hoursAgo(h),
  daysAtNode: 0,
});

const none: MetroDiff["lines"] = { added: [], removed: [], renamed: [], changed: [] };
const diff = (over: Partial<MetroDiff>): MetroDiff => ({
  lines: none,
  stations: none,
  tracks: none,
  groups: none,
  frames: none,
  flows: none,
  name: null,
  ...over,
});

describe("kindOf, columnOf", () => {
  it("maps the body's names to the drawing's", () => {
    expect(kindOf({ kind: "condition" })).toBe("dec");
    expect(kindOf({ kind: "approval" })).toBe("ok");
    expect(kindOf({ kind: "cash", planned: true })).toBe("plan");
    expect(kindOf({ kind: "time" })).toBe("time");
    expect(columnOf("money")).toBe("Money");
  });
});

describe("viewOf", () => {
  const v = viewOf(metro, numbers, [], NOW);

  it("takes lines, stations, tracks and groups from the body", () => {
    expect(v.title).toBe("Sample");
    expect(v.lines.map((l) => l.id)).toEqual(["yt", "web"]);
    expect(v.lines[1]).toEqual({
      id: "web",
      label: "Webinar",
      offer: "starter",
      tier: "front",
      colour: 0,
    });
    expect(v.stations.map((s) => s.id)).toEqual(["post", "hub", "reply", "book", "check", "pay"]);
    expect(v.tracks.map((t) => t.id)).toEqual([
      "post_to_hub",
      "hub_to_reply",
      "reply_to_book",
      "book_to_check",
    ]);
    expect(v.groups).toEqual([{ id: "g1", label: "Talk" }]);
  });

  it("maps kind, column, group and the track label", () => {
    const by = (id: string) => v.stations.find((s) => s.id === id);
    expect(by("check")?.kind).toBe("dec");
    expect(by("pay")?.kind).toBe("plan");
    expect(by("reply")?.column).toBe("Sales");
    expect(by("reply")?.group).toBe("g1");
    expect(by("post")?.group).toBeUndefined();
    expect(v.tracks[3]?.label).toBe("yes");
  });

  it("says now and the median under a station, the leads under the hub", () => {
    const by = (id: string) => v.stations.find((s) => s.id === id);
    expect(by("reply")?.sub).toBe("5 now · 4 d");
    expect(by("hub")?.sub).toBe("42 leads");
    // No median: no line.
    expect(by("book")?.sub).toBeUndefined();
    // No row: no line.
    expect(by("post")?.sub).toBeUndefined();
  });

  it("keeps the owner and promise of a person track, and marks it late past the promise", () => {
    expect(v.tracks[2]).toMatchObject({ by: "person", owner: "Ada North", promise: "4h" });
    expect(v.tracks[2]?.late).toBeUndefined();
    const late = viewOf(metro, numbers, [person("j1", "reply", 6)], NOW);
    expect(late.tracks[2]?.late).toBe(true);
    const ok = viewOf(metro, numbers, [person("j1", "reply", 2)], NOW);
    expect(ok.tracks[2]?.late).toBeUndefined();
  });

  it("puts a mark on each added or changed part", () => {
    const m = viewOf(
      metro,
      numbers,
      [],
      NOW,
      diff({
        stations: {
          added: ["book"],
          removed: [],
          renamed: [{ id: "reply", from: "A", to: "B" }],
          changed: [],
        },
        tracks: { added: [], removed: [], renamed: [], changed: ["reply_to_book"] },
        lines: { added: ["web"], removed: [], renamed: [], changed: [] },
      }),
    );
    expect(m.stations.find((s) => s.id === "book")?.mark).toBe("added");
    expect(m.stations.find((s) => s.id === "reply")?.mark).toBe("changed");
    expect(m.stations.find((s) => s.id === "post")?.mark).toBeUndefined();
    expect(m.tracks.find((t) => t.id === "reply_to_book")?.mark).toBe("changed");
    expect(m.lines.find((l) => l.id === "web")?.mark).toBe("added");
  });

  it("draws the removed parts back from the older body", () => {
    const old: MetroBody = {
      ...metro,
      lines: [...metro.lines, { id: "ads", label: "Ads", tier: "out" }],
      stations: [
        ...metro.stations,
        { id: "ad", label: "Ad click", kind: "att", line: "ads", column: "marketing" },
      ],
      tracks: [
        ...metro.tracks,
        { id: "ad_to_hub", from: "ad", to: "hub", line: "ads", by: "system" },
      ],
    };
    const m = viewOf(
      metro,
      numbers,
      [],
      NOW,
      diff({
        lines: { added: [], removed: ["ads"], renamed: [], changed: [] },
        stations: { added: [], removed: ["ad"], renamed: [], changed: [] },
        tracks: { added: [], removed: ["ad_to_hub"], renamed: [], changed: [] },
      }),
      old,
    );
    expect(m.lines.at(-1)).toMatchObject({ id: "ads", mark: "removed" });
    expect(m.stations.at(-1)).toMatchObject({ id: "ad", line: "ads", mark: "removed" });
    expect(m.tracks.at(-1)).toMatchObject({
      id: "ad_to_hub",
      from: "ad",
      to: "hub",
      mark: "removed",
    });
    // Without the older body nothing is drawn back.
    const bare = viewOf(
      metro,
      numbers,
      [],
      NOW,
      diff({ stations: { added: [], removed: ["ad"], renamed: [], changed: [] } }),
    );
    expect(bare.stations.some((s) => s.id === "ad")).toBe(false);
  });
});
