import { describe, expect, it } from "vitest";
import { flow, metroPair, metroShape, shape } from "../test/fixtures.js";
import { metroOf } from "./convert.js";
import { canonicalJson } from "./diff.js";
import type { Attach, MetroBody, MetroFlow, MetroStation } from "./metro.js";
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

describe("diffMetro: flows", () => {
  const flowOf = (b: MetroBody, id = "shared_followup"): MetroFlow => {
    const f = b.flows?.find((x) => x.id === id);
    if (!f) throw new Error(`no flow ${id}`);
    return f;
  };
  const keys = (a: MetroBody, b: MetroBody) => metroChangesOf(diffMetro(a, b)).map(metroChangeKey);
  const second = (): MetroFlow => ({
    id: "second",
    label: "Second flow",
    stations: [
      { id: "a", label: "A", kind: "att", line: "growth", column: "sales", action: "other" },
    ],
    tracks: [],
  });

  it("finds a flow added, removed, renamed and changed", () => {
    const a = metroShape();
    const added = structuredClone(a);
    added.flows?.push(second());
    expect(keys(a, added)).toEqual(["flow:second:added"]);
    expect(keys(added, a)).toEqual(["flow:second:removed"]);
    const renamed = structuredClone(a);
    flowOf(renamed).label = "Follow up";
    expect(keys(a, renamed)).toEqual(["flow:shared_followup:renamed"]);
    expect(diffMetro(a, renamed).flows.renamed).toEqual([
      { id: "shared_followup", from: "Follow-up flow", to: "Follow up" },
    ]);
  });

  it("calls any station or track change inside a flow a change of the flow", () => {
    const a = metroShape();
    const station = structuredClone(a);
    flowOf(station).stations[1] = {
      ...(flowOf(station).stations[1] as MetroStation),
      idleDays: 4,
    };
    expect(keys(a, station)).toEqual(["flow:shared_followup:changed"]);
    const track = structuredClone(a);
    (flowOf(track).tracks[0] as MetroBody["tracks"][number]).by = "person";
    expect(keys(a, track)).toEqual(["flow:shared_followup:changed"]);
    const added = structuredClone(a);
    flowOf(added).stations.push({
      id: "more",
      label: "More",
      kind: "att",
      line: "growth",
      column: "delivery",
      action: "other",
    });
    expect(keys(a, added)).toEqual(["flow:shared_followup:changed"]);
    const dropped = structuredClone(a);
    flowOf(dropped).tracks = [];
    expect(keys(a, dropped)).toEqual(["flow:shared_followup:changed"]);
  });

  it("counts a rename and a change in one version as two changes, rename first", () => {
    const a = metroShape();
    const b = structuredClone(a);
    flowOf(b).label = "Follow up";
    (flowOf(b).tracks[0] as MetroBody["tracks"][number]).by = "person";
    expect(keys(a, b)).toEqual(["flow:shared_followup:renamed", "flow:shared_followup:changed"]);
  });

  it("does not change the body for a flow station with the id of a body station", () => {
    const a = metroShape();
    const b = structuredClone(a);
    flowOf(b).stations.push({
      ...(b.stations.find((s) => s.id === "reply") as MetroStation),
      id: "reply",
    });
    expect(keys(a, b)).toEqual(["flow:shared_followup:changed"]);
  });

  it("reads a body with no flows as one with none: every flow is added or removed", () => {
    const a = metroShape();
    const none = structuredClone(a);
    delete none.flows;
    expect(keys(none, a)).toEqual(["flow:shared_followup:added"]);
    expect(keys(a, none)).toEqual(["flow:shared_followup:removed"]);
    const empty = structuredClone(a);
    empty.flows = [];
    expect(keys(none, empty)).toEqual([]);
    expect(keys(empty, none)).toEqual([]);
  });

  it("puts flows last, after frames", () => {
    const a = metroShape();
    const b = structuredClone(a);
    b.flows?.push(second());
    b.frames.push({
      id: "halt",
      stations: ["prep"],
      trigger: { trigger: "trigger.reply" },
      exit: "done",
    });
    b.name = "Other";
    expect(keys(a, b)).toEqual(["name", "frame:halt:added", "flow:second:added"]);
  });

  it("ignores where a flow sits in the list", () => {
    const a = metroShape();
    a.flows?.push(second());
    const b = structuredClone(a);
    b.flows?.reverse();
    expect(keys(a, b)).toEqual([]);
  });
});

describe("diffMetro: attach", () => {
  const keys = (a: MetroBody, b: MetroBody) => metroChangesOf(diffMetro(a, b)).map(metroChangeKey);
  const doc: Attach = { kind: "doc", ref: "extra-doc" };

  it("calls an attach change a change of its line, station and group", () => {
    const a = metroShape();
    const b = structuredClone(a);
    (b.lines.find((l) => l.id === "growth") as MetroBody["lines"][number]).attach?.push(doc);
    (b.stations.find((s) => s.id === "reply") as MetroBody["stations"][number]).attach = [];
    (b.groups.find((g) => g.id === "closing") as MetroBody["groups"][number]).attach?.shift();
    expect(keys(a, b)).toEqual([
      "line:growth:changed",
      "station:reply:changed",
      "group:closing:changed",
    ]);
  });

  it("calls an attach added or removed a change, never an add or remove of the item", () => {
    const a = metroShape();
    const b = structuredClone(a);
    (b.lines.find((l) => l.id === "nurture") as MetroBody["lines"][number]).attach = [doc];
    expect(keys(a, b)).toEqual(["line:nurture:changed"]);
    expect(keys(b, a)).toEqual(["line:nurture:changed"]);
  });

  it("calls a label, kind or ref change of an attach a change, and a label alone no rename", () => {
    const a = metroShape();
    for (const edit of [
      (x: Attach) => (x.label = "New label"),
      (x: Attach) => (x.ref = "other-ref"),
      (x: Attach) => (x.kind = "page"),
    ]) {
      const b = structuredClone(a);
      const first = (b.lines.find((l) => l.id === "growth") as MetroBody["lines"][number])
        .attach?.[0] as Attach;
      edit(first);
      expect(keys(a, b)).toEqual(["line:growth:changed"]);
    }
  });

  it("sees an attach on a station inside a flow as a change of the flow", () => {
    const a = metroShape();
    const b = structuredClone(a);
    const nudge = b.flows?.[0]?.stations[0] as MetroBody["stations"][number];
    nudge.attach = [{ kind: "template", ref: "book-first/other" }];
    expect(keys(a, b)).toEqual(["flow:shared_followup:changed"]);
  });

  it("finds nothing when the attach order and key order are the same", () => {
    const a = metroShape();
    const b = JSON.parse(JSON.stringify(a)) as MetroBody;
    const items = (b.stations.find((s) => s.id === "reply") as MetroBody["stations"][number])
      .attach as Attach[];
    b.stations = b.stations.map((s) =>
      s.id === "reply"
        ? {
            ...s,
            attach: items.map((i) => ({
              ...(i.label ? { label: i.label } : {}),
              ref: i.ref,
              kind: i.kind,
            })),
          }
        : s,
    );
    expect(keys(a, b)).toEqual([]);
  });

  it("treats a different attach order as a change", () => {
    const a = metroShape();
    const b = structuredClone(a);
    (b.lines.find((l) => l.id === "growth") as MetroBody["lines"][number]).attach?.reverse();
    expect(keys(a, b)).toEqual(["line:growth:changed"]);
  });
});

describe("flow keys and lines", () => {
  it("read and write the flow keys", () => {
    for (const how of ["added", "removed", "renamed", "changed"] as const) {
      expect(parseMetroChangeKey(`flow:shared_followup:${how}`)).toEqual({
        on: "flow",
        id: "shared_followup",
        how,
      });
      expect(metroChangeKey({ on: "flow", id: "shared_followup", how })).toBe(
        `flow:shared_followup:${how}`,
      );
    }
    expect(parseMetroChangeKey("flow:x:renamed")).toEqual({ on: "flow", id: "x", how: "renamed" });
    expect(parseMetroChangeKey("flow:x:bad")).toBeNull();
    expect(parseMetroChangeKey("flow:x")).toBeNull();
    expect(parseMetroChangeKey("flows:x:added")).toBeNull();
  });

  it("say each flow change in one plain line, by label", () => {
    const a = metroShape();
    const b = structuredClone(a);
    (b.flows?.[0] as MetroFlow).label = "Follow up";
    const line = (how: "added" | "removed" | "renamed" | "changed") =>
      metroChangeLine(a, b, { on: "flow", id: "shared_followup", how });
    expect(line("added")).toBe("Added flow Follow up.");
    expect(line("removed")).toBe("Removed flow Follow-up flow.");
    expect(line("renamed")).toBe("Renamed flow Follow-up flow to Follow up.");
    expect(line("changed")).toBe("Changed flow Follow up.");
    expect(metroChangeLine(a, b, { on: "flow", id: "ghost", how: "changed" })).toBe(
      "Changed flow ghost.",
    );
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

describe("historyOfMetro: flows and attach", () => {
  it("gives a flow its added, renamed, changed and removed lines", () => {
    const a = metroShape();
    const renamed = structuredClone(a);
    (renamed.flows?.[0] as MetroFlow).label = "Follow up";
    const changed = structuredClone(renamed);
    (changed.flows?.[0] as MetroFlow).tracks = [];
    const gone = structuredClone(changed);
    gone.flows = [];
    const none = structuredClone(a);
    delete none.flows;
    const versions = [
      version(1, none),
      version(2, a),
      version(3, renamed),
      version(4, changed),
      version(5, gone),
    ];
    const lines = historyOfMetro(versions, "shared_followup", "flow");
    expect(lines.map((l) => [l.version, l.how])).toEqual([
      [5, "removed"],
      [4, "changed"],
      [3, "renamed"],
      [2, "added"],
    ]);
    expect(lines[2]).toMatchObject({ from: "Follow-up flow", to: "Follow up" });
  });

  it("gives an item an attach change as a changed line", () => {
    const a = metroShape();
    const b = structuredClone(a);
    (b.lines.find((l) => l.id === "growth") as MetroBody["lines"][number]).attach?.push({
      kind: "doc",
      ref: "extra-doc",
    });
    const lines = historyOfMetro([version(1, a), version(2, b)], "growth", "line");
    expect(lines.map((l) => [l.version, l.how])).toEqual([
      [2, "changed"],
      [1, "added"],
    ]);
  });

  it("keeps a flow apart from a line, station or group of the same id", () => {
    const a = metroShape();
    const b = structuredClone(a);
    (b.flows?.[0] as MetroFlow).id = "closing";
    const versions = [version(1, a), version(2, b)];
    expect(historyOfMetro(versions, "closing", "flow").map((l) => [l.version, l.how])).toEqual([
      [2, "added"],
    ]);
    expect(historyOfMetro(versions, "closing", "group").map((l) => [l.version, l.how])).toEqual([
      [1, "added"],
    ]);
  });
});
