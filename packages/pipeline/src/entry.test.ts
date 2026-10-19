import { describe, expect, it } from "vitest";
import { flow, shape } from "../test/fixtures.js";
import { entryNodes, entryOf, opensAt, sourceEdge } from "./entry.js";
import type { ShapeBody, ShapeNode } from "./model.js";

/** A shape whose sources are `sources`, each with a flow edge to the node in `to` (default engaged). */
const body = (sources: ShapeNode[], to: Record<string, string> = {}): ShapeBody => {
  const base = shape();
  const keep = base.nodes.filter((n) => n.kind !== "source");
  return {
    ...base,
    nodes: [...sources, ...keep],
    edges: [
      ...sources.map((s) => flow(s.id, to[s.id] ?? "engaged")),
      ...base.edges.filter((e) => e.from !== "yt" && e.from !== "mail"),
    ],
  };
};

const SOURCES: ShapeNode[] = [
  { id: "yt", kind: "source", name: "YouTube", via: "organic", channel: "youtube" },
  { id: "ad_a", kind: "source", name: "Ad A", via: "ads", channel: "meta", campaign: "camp-1" },
  { id: "ad_any", kind: "source", name: "Ad any", via: "ads", channel: "meta" },
  { id: "list", kind: "source", name: "List", via: "sourced", source: "list-1" },
  { id: "seg", kind: "source", name: "Group", via: "group", group: "7" },
  { id: "loose", kind: "source", name: "Loose", via: "organic" },
];

describe("entryOf", () => {
  const b = body(SOURCES);

  it("takes the source the cause names", () => {
    expect(entryOf(b, { entry: "seg", channel: "youtube" })?.id).toBe("seg");
  });

  it("matches the first source by channel and campaign", () => {
    expect(entryOf(b, { channel: "YouTube" })?.id).toBe("yt");
    expect(entryOf(b, { channel: "meta", campaign: "camp-1" })?.id).toBe("ad_a");
    // Body order: ad_a needs its campaign, so a bare Meta cause falls to ad_any.
    expect(entryOf(b, { channel: "meta" })?.id).toBe("ad_any");
    expect(entryOf(b, { channel: "meta", campaign: "camp-2" })?.id).toBe("ad_any");
  });

  it("matches a sourced or group cause", () => {
    expect(entryOf(b, { source: "list-1" })?.id).toBe("list");
    expect(entryOf(b, { group: "7" })?.id).toBe("seg");
  });

  it("never matches a source with no channel and no campaign", () => {
    expect(entryOf(b, { channel: "tiktok" })).toBeNull();
  });

  it("falls back to the first touch, then to nothing", () => {
    expect(entryOf(b, {}, { channel: "youtube" })?.id).toBe("yt");
    expect(entryOf(b, { channel: "meta" }, { channel: "youtube" })?.id).toBe("ad_any");
    expect(entryOf(b, {}, null)).toBeNull();
    expect(entryOf(b, {}, { channel: "tiktok" })).toBeNull();
  });

  it("uses the body's own manual source when it has one", () => {
    const own = body([{ id: "hand", kind: "source", name: "Hand", via: "manual" }]);
    expect(entryOf(own, {})?.id).toBe("hand");
  });

  it("skips a parked source", () => {
    const parked = body([
      {
        id: "yt",
        kind: "source",
        name: "YouTube",
        via: "organic",
        channel: "youtube",
        parked: true,
      },
      { id: "yt2", kind: "source", name: "YouTube 2", via: "organic", channel: "youtube" },
    ]);
    expect(entryOf(parked, { channel: "youtube" })?.id).toBe("yt2");
    expect(entryOf(parked, { entry: "yt" })).toBeNull();
  });

  it("prefers a source that opens at the node asked", () => {
    const two = body(
      [
        { id: "a", kind: "source", name: "A", via: "organic", channel: "youtube" },
        { id: "b", kind: "source", name: "B", via: "organic", channel: "youtube" },
      ],
      { a: "engaged", b: "booked" },
    );
    expect(entryOf(two, { channel: "youtube" }, null, "booked")?.id).toBe("b");
    expect(entryOf(two, { channel: "youtube" })?.id).toBe("a");
  });
});

describe("entryNodes", () => {
  it("is each live source's targets, once, in edge order", () => {
    const b = body(
      [
        { id: "yt", kind: "source", name: "YouTube", via: "organic", channel: "youtube" },
        { id: "late", kind: "source", name: "Late", via: "manual" },
        { id: "off", kind: "source", name: "Off", via: "organic", channel: "x", parked: true },
      ],
      { late: "signed", off: "proposal" },
    );
    expect(entryNodes(b)).toEqual(["engaged", "signed"]);
  });

  it("names the edge from a source to a node", () => {
    expect(sourceEdge(shape(), "yt", "engaged")?.id).toBe("yt_to_engaged");
    expect(sourceEdge(shape(), "yt", "booked")).toBeUndefined();
  });
});

describe("opensAt", () => {
  const partner = body(
    [
      { id: "yt", kind: "source", name: "YouTube", via: "organic", channel: "youtube" },
      { id: "partner", kind: "source", name: "Partner", via: "manual" },
    ],
    { partner: "signed" },
  );

  it("lets a node cause open where a feed-fed source opens", () => {
    expect(opensAt(partner, "engaged", false, { channel: "x" })).toBe(true);
  });

  it("never lets a node cause open at a manual source's node", () => {
    expect(opensAt(partner, "signed", false, {})).toBe(false);
  });

  it("lets a manual open in at any live source's node, and nowhere else", () => {
    expect(opensAt(partner, "signed", true, {})).toBe(true);
    expect(opensAt(partner, "booked", true, {})).toBe(false);
  });

  it("opens a group or sourced source only for the cause it names", () => {
    const b = body(
      [
        { id: "list", kind: "source", name: "List", via: "sourced", source: "import:1" },
        { id: "seg", kind: "source", name: "Group", via: "group", group: "7" },
      ],
      { list: "booked", seg: "signed" },
    );
    expect(opensAt(b, "booked", false, { source: "import:1" })).toBe(true);
    expect(opensAt(b, "booked", false, { source: "import:2" })).toBe(false);
    expect(opensAt(b, "signed", false, { group: "7" })).toBe(true);
    expect(opensAt(b, "signed", false, {})).toBe(false);
  });

  it("opens nothing at a parked source's node", () => {
    const b = body([
      {
        id: "yt",
        kind: "source",
        name: "YouTube",
        via: "organic",
        channel: "youtube",
        parked: true,
      },
    ]);
    expect(opensAt(b, "engaged", false, {})).toBe(false);
    expect(opensAt(b, "engaged", true, {})).toBe(false);
  });
});
