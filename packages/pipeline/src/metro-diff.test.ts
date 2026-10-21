import { describe, expect, it } from "vitest";
import { flow, metroPair, metroShape, shape } from "../test/fixtures.js";
import { metroOf } from "./convert.js";
import { canonicalJson } from "./diff.js";
import type { MetroBody } from "./metro.js";
import { historyOfMetro, type MetroBlameVersion } from "./metro-blame.js";
import {
  diffMetro,
  type MetroChange,
  metroChangeKey,
  metroChangeLine,
  metroChangeLines,
  metroChangesOf,
  parseMetroChangeKey,
} from "./metro-diff.js";
import type { ShapeBody } from "./model.js";

/** Every change the pair holds, as keys. */
const PAIR_KEYS = [
  "name",
  "line:extra:added",
  "line:spare:removed",
  "line:nurture:renamed",
  "line:growth:changed",
  "line:social:renamed",
  "line:social:changed",
  "station:fresh:added",
  "station:docs:removed",
  "station:book:renamed",
  "station:prep:changed",
  "station:reply:renamed",
  "station:reply:changed",
  "track:fresh_to_review:added",
  "track:reply_to_book:added",
  "track:fork_to_docs:removed",
  "track:docs_to_merge:removed",
  "track:pay_to_done:removed",
  "track:book_to_wait:changed",
  "group:wrap:added",
  "group:closing:removed",
  "group:prepwork:renamed",
  "group:onboarding:changed",
  "frame:halt:added",
  "frame:stop:removed",
  "frame:keep:changed",
];

describe("diffMetro", () => {
  it("finds every added, removed, renamed and changed line, station, track, group and frame", () => {
    const { a, b } = metroPair();
    const keys = metroChangesOf(diffMetro(a, b)).map(metroChangeKey);
    expect([...keys].sort()).toEqual([...PAIR_KEYS].sort());
  });

  it("reads in a fixed order: name, then each list added, removed, renamed, changed", () => {
    const { a, b } = metroPair();
    expect(metroChangesOf(diffMetro(a, b)).map(metroChangeKey)).toEqual([
      "name",
      "line:extra:added",
      "line:spare:removed",
      "line:social:renamed",
      "line:nurture:renamed",
      "line:social:changed",
      "line:growth:changed",
      "station:fresh:added",
      "station:docs:removed",
      "station:reply:renamed",
      "station:book:renamed",
      "station:reply:changed",
      "station:prep:changed",
      "track:fresh_to_review:added",
      "track:reply_to_book:added",
      "track:fork_to_docs:removed",
      "track:docs_to_merge:removed",
      "track:pay_to_done:removed",
      "track:book_to_wait:changed",
      "group:wrap:added",
      "group:closing:removed",
      "group:prepwork:renamed",
      "group:onboarding:changed",
      "frame:halt:added",
      "frame:stop:removed",
      "frame:keep:changed",
    ]);
  });

  it("keeps the old and the new label of a rename", () => {
    const { a, b } = metroPair();
    const d = diffMetro(a, b);
    expect(d.lines.renamed).toEqual([
      { id: "social", from: "Social", to: "Socials" },
      { id: "nurture", from: "Nurture", to: "Warm" },
    ]);
    expect(d.stations.renamed).toContainEqual({ id: "book", from: "Book", to: "Booking" });
    expect(d.groups.renamed).toEqual([{ id: "prepwork", from: "Prep work", to: "Preparation" }]);
    expect(d.name).toEqual({ from: "Metro shape", to: "Newer name" });
  });

  it("counts a rename and a change in one version as two changes", () => {
    const { a, b } = metroPair();
    const keys = metroChangesOf(diffMetro(a, b)).map(metroChangeKey);
    expect(keys).toContain("line:social:renamed");
    expect(keys).toContain("line:social:changed");
    expect(keys).toContain("station:reply:renamed");
    expect(keys).toContain("station:reply:changed");
    // A rename alone is not a change.
    expect(keys).not.toContain("line:nurture:changed");
    expect(keys).not.toContain("station:book:changed");
  });

  it("calls a track or a frame label change a change, never a rename", () => {
    const a = metroShape();
    const b = structuredClone(a);
    (b.tracks.find((t) => t.id === "renew") as MetroBody["tracks"][number]).label = "after 30 days";
    (b.frames.find((f) => f.id === "stop") as MetroBody["frames"][number]).label = "Stop";
    expect(metroChangesOf(diffMetro(a, b)).map(metroChangeKey)).toEqual([
      "track:renew:changed",
      "frame:stop:changed",
    ]);
  });

  it("finds nothing between a body and itself or a copy with other key order", () => {
    const a = metroShape();
    expect(metroChangesOf(diffMetro(a, a))).toEqual([]);
    const reordered = JSON.parse(canonicalJson(a)) as MetroBody;
    expect(metroChangesOf(diffMetro(a, reordered))).toEqual([]);
  });

  it("ignores where an item sits in its list", () => {
    const a = metroShape();
    const b = { ...a, stations: [...a.stations].reverse(), tracks: [...a.tracks].reverse() };
    expect(metroChangesOf(diffMetro(a, b))).toEqual([]);
  });

  it("finds nothing when an item is removed and added again unchanged", () => {
    const a = metroShape();
    const b = { ...a, stations: a.stations.filter((s) => s.id !== "prep") };
    const c = { ...b, stations: [...b.stations, ...a.stations.filter((s) => s.id === "prep")] };
    expect(metroChangesOf(diffMetro(a, b)).map(metroChangeKey)).toEqual(["station:prep:removed"]);
    expect(metroChangesOf(diffMetro(b, c)).map(metroChangeKey)).toEqual(["station:prep:added"]);
    expect(metroChangesOf(diffMetro(a, c))).toEqual([]);
  });

  it("never changes its inputs", () => {
    const { a, b } = metroPair();
    const before = canonicalJson([a, b]);
    diffMetro(a, b);
    expect(canonicalJson([a, b])).toBe(before);
  });
});

describe("metroChangeKey and parseMetroChangeKey", () => {
  it("name every change and read it back", () => {
    const { a, b } = metroPair();
    for (const c of metroChangesOf(diffMetro(a, b))) {
      expect(parseMetroChangeKey(metroChangeKey(c)), metroChangeKey(c)).toEqual(c);
    }
  });

  it("use prefixes that never clash with the graph keys", () => {
    expect(parseMetroChangeKey("node:yt:added")).toBeNull();
    expect(parseMetroChangeKey("edge:yt_to_engaged:added")).toBeNull();
    expect(metroChangeKey({ on: "station", id: "node", how: "added" })).toBe("station:node:added");
  });

  it("return null for a key that names no change", () => {
    for (const key of [
      "",
      "station",
      "station:a",
      "station:a:bad",
      "track:a:renamed",
      "frame:a:renamed",
      "thing:a:added",
      "name:x",
    ]) {
      expect(parseMetroChangeKey(key), key).toBeNull();
    }
  });

  it("read renamed for a line, a station and a group", () => {
    for (const on of ["line", "station", "group"] as const) {
      expect(parseMetroChangeKey(`${on}:a_b:renamed`)).toEqual({ on, id: "a_b", how: "renamed" });
    }
  });
});

describe("metroChangeLine", () => {
  const { a, b } = metroPair();
  const line = (c: MetroChange) => metroChangeLine(a, b, c);

  it("says each change in one plain line, by label", () => {
    expect(line({ on: "name" })).toBe("Shape renamed from Metro shape to Newer name.");
    expect(line({ on: "line", id: "extra", how: "added" })).toBe("Added line Extra.");
    expect(line({ on: "line", id: "spare", how: "removed" })).toBe("Removed line Spare.");
    expect(line({ on: "line", id: "nurture", how: "renamed" })).toBe(
      "Renamed line Nurture to Warm.",
    );
    expect(line({ on: "line", id: "growth", how: "changed" })).toBe("Changed line Growth.");
    expect(line({ on: "station", id: "docs", how: "removed" })).toBe("Removed station Docs.");
    expect(line({ on: "station", id: "book", how: "renamed" })).toBe(
      "Renamed station Book to Booking.",
    );
    expect(line({ on: "group", id: "closing", how: "removed" })).toBe("Removed group Closing.");
    expect(line({ on: "frame", id: "halt", how: "added" })).toBe("Added frame halt.");
    expect(line({ on: "frame", id: "stop", how: "removed" })).toBe("Removed frame Stop on reply.");
  });

  it("names a track by its two stations, as the body that knows it", () => {
    expect(line({ on: "track", id: "fresh_to_review", how: "added" })).toBe(
      "Added track Fresh to Approve proposal.",
    );
    expect(line({ on: "track", id: "pay_to_done", how: "removed" })).toBe(
      "Removed track Pay to Done.",
    );
    expect(line({ on: "track", id: "book_to_wait", how: "changed" })).toBe(
      "Changed track Booking to Shows up?.",
    );
  });

  it("has one line per change in metroChangeLines", () => {
    const d = diffMetro(a, b);
    const lines = metroChangeLines(a, b, d);
    expect(lines).toHaveLength(PAIR_KEYS.length);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("falls back to the id when no body knows the item", () => {
    expect(line({ on: "station", id: "ghost", how: "changed" })).toBe("Changed station ghost.");
  });
});

// --- Blame ----------------------------------------------------------------------------------

const version = (
  number: number,
  body: MetroBody,
  over: Partial<MetroBlameVersion> = {},
): MetroBlameVersion => ({
  number,
  body,
  note: `note ${number}`,
  createdBy: "tester",
  createdAt: new Date(Date.UTC(2026, 9, number)),
  ...over,
});

describe("historyOfMetro", () => {
  it("gives one line for each way an item of each kind changed", () => {
    const { a, b } = metroPair();
    const versions = [version(1, a), version(2, b)];
    const d = diffMetro(a, b);
    for (const c of metroChangesOf(d)) {
      if (c.on === "name") continue;
      const lines = historyOfMetro(versions, c.id, c.on).filter((l) => l.version === 2);
      expect(
        lines.map((l) => l.how),
        metroChangeKey(c),
      ).toContain(c.how);
    }
  });

  it("gives a rename its old and new label, and puts a rename before a change", () => {
    const { a, b } = metroPair();
    const lines = historyOfMetro([version(1, a), version(2, b)], "reply", "station");
    expect(lines.map((l) => [l.version, l.how])).toEqual([
      [2, "renamed"],
      [2, "changed"],
      [1, "added"],
    ]);
    expect(lines[0]).toMatchObject({ from: "Reply", to: "Reply to us" });
    expect(lines[1]?.from).toBeUndefined();
  });

  it("says who, when and why, newest first, whatever order the versions come in", () => {
    const { a, b } = metroPair();
    const lines = historyOfMetro(
      [
        version(2, b, { note: "second", createdBy: "ann", createdAt: "2026-10-02T00:00:00.000Z" }),
        version(1, a, { note: "first", createdBy: "bo" }),
      ],
      "book",
      "station",
    );
    expect(lines).toEqual([
      {
        version: 2,
        how: "renamed",
        from: "Book",
        to: "Booking",
        note: "second",
        by: "ann",
        at: "2026-10-02T00:00:00.000Z",
      },
      {
        version: 1,
        how: "added",
        note: "first",
        by: "bo",
        at: "2026-10-01T00:00:00.000Z",
      },
    ]);
  });

  it("follows an item removed and added again", () => {
    const a = metroShape();
    const without = { ...a, tracks: a.tracks.filter((t) => t.id !== "pay_to_done") };
    const lines = historyOfMetro(
      [version(1, a), version(2, without), version(3, a)],
      "pay_to_done",
      "track",
    );
    expect(lines.map((l) => [l.version, l.how])).toEqual([
      [3, "added"],
      [2, "removed"],
      [1, "added"],
    ]);
  });

  it("gives nothing for an id no version holds, or one on another kind", () => {
    const { a, b } = metroPair();
    const versions = [version(1, a), version(2, b)];
    expect(historyOfMetro(versions, "ghost", "station")).toEqual([]);
    // A line and a station may share an id: each has its own history.
    expect(historyOfMetro(versions, "social", "station")).toEqual([
      expect.objectContaining({ version: 1, how: "added" }),
    ]);
    expect(historyOfMetro(versions, "social", "line").map((l) => l.how)).toEqual([
      "renamed",
      "changed",
      "added",
    ]);
  });

  it("reads a station's history back through versions made from graph versions", () => {
    const g1 = shape();
    const g2: ShapeBody = {
      ...g1,
      nodes: g1.nodes.map((n) => (n.id === "booked" ? { ...n, name: "Call" } : n)),
    };
    const g3: ShapeBody = {
      ...g2,
      nodes: g2.nodes.map((n) => (n.id === "engaged" ? { ...n, action: "other" as const } : n)),
    };
    // Version 4 drops booked and joins engaged to proposal.
    const g4: ShapeBody = {
      ...g3,
      nodes: g3.nodes.filter((n) => n.id !== "booked"),
      edges: [
        ...g3.edges.filter((e) => e.from !== "booked" && e.to !== "booked"),
        flow("engaged", "proposal"),
      ],
    };
    // Version 5 is version 3 again: booked is back, with the name Call.
    const bodies = [g1, g2, g3, g4, g3].map((g) => {
      const r = metroOf(g);
      if (!r.ok) throw new Error(r.errors.join(" "));
      return r.body;
    });
    const versions = bodies.map((body, i) => version(i + 1, body));
    expect(historyOfMetro(versions, "booked", "station").map((l) => [l.version, l.how])).toEqual([
      [5, "added"],
      [4, "removed"],
      [2, "renamed"],
      [1, "added"],
    ]);
    expect(historyOfMetro(versions, "engaged", "station").map((l) => [l.version, l.how])).toEqual([
      [3, "changed"],
      [1, "added"],
    ]);
    // The track that joined the two stations has its own history by the same id.
    expect(
      historyOfMetro(versions, "engaged_to_booked", "track").map((l) => [l.version, l.how]),
    ).toEqual([
      [5, "added"],
      [4, "removed"],
      [1, "added"],
    ]);
  });
});
