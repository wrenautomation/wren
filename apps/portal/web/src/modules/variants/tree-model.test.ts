import { describe, expect, it } from "vitest";
import { deltaOf, G, shortName, type TreeBatch, type TreeSample, treeOf } from "./tree-model.js";

const sample = (
  id: number,
  verdict: TreeSample["verdict"],
  change: string | null,
  parentId: number | null = null,
): TreeSample => ({
  id,
  body: null,
  mediaUrl: null,
  posterUrl: null,
  verdict,
  keptAt: null,
  notes: [],
  change,
  parentId,
});
const batch = (id: number, day: number, samples: TreeSample[], state = "closed"): TreeBatch => ({
  id,
  why: `why ${id}`,
  note: null,
  state,
  createdAt: `2026-11-0${day}T10:00:00Z`,
  closedAt: state === "closed" ? `2026-11-0${day}T12:00:00Z` : null,
  samples,
});

describe("shortName", () => {
  it("cuts at a joining word after three words, never ends on one", () => {
    expect(shortName("Type on a curve: the headline set on a slow curve.", "x")).toBe(
      "Type on a curve",
    );
    expect(shortName("Particle ribbons (65k): ink as silk", "x")).toBe("Particle ribbons");
    expect(shortName("  ", "Sample 4")).toBe("Sample 4");
    expect(shortName(null, "Sample 4")).toBe("Sample 4");
  });
});

describe("deltaOf", () => {
  it("takes the idea after the first clause", () => {
    expect(deltaOf("Type, slow ease: a longer, softer ease.")).toBe("longer, softer ease");
    expect(deltaOf("Lit desk scene: the caustic light on a 3D desk.")).toBe(
      "caustic light on a 3D desk",
    );
    expect(deltaOf("No clause here")).toBeNull();
    expect(deltaOf(null)).toBeNull();
  });
});

describe("treeOf", () => {
  it("handles a subject with no batches", () => {
    const t = treeOf([], []);
    expect(t.S).toEqual([]);
    expect(t.first).toBeNull();
    expect(t.goodLine().size).toBe(0);
    expect(t.height).toBe(G.TOP + 46);
  });

  it("keeps an open batch blind: no parent, idea or notes", () => {
    const t = treeOf(
      [
        batch(1, 1, [sample(1, "good", "Kinetic type: big")]),
        batch(2, 2, [sample(2, null, "Secret idea", 1)], "open"),
      ],
      [],
    );
    const open = t.byId.get(2);
    expect(open?.v).toBe("open");
    expect(open?.p).toEqual([]);
    expect(open?.change).toBeNull();
    expect(open?.name).toBe("Sample A");
    expect(t.rounds[1]?.call).toBe("1 to mark");
    // the open batch's why is not "took" from batch 1
    expect(t.rounds[0]?.took).toBeNull();
  });

  it("marks a parent with no call as grew, and the rest unmarked", () => {
    const t = treeOf(
      [
        batch(1, 1, [sample(1, null, "A"), sample(2, null, "B")]),
        batch(2, 2, [sample(3, null, "C", 1)]),
      ],
      [],
    );
    expect(t.byId.get(1)?.v).toBe("grew");
    expect(t.byId.get(2)?.v).toBe("unmarked");
    expect(t.rounds[0]?.call).toBe("Note only");
  });

  it("drops a missing parent, a same-row parent and a cycle", () => {
    const t = treeOf(
      [
        batch(1, 1, [sample(1, "good", "A", 2), sample(2, "good", "B", 1)]),
        batch(2, 2, [sample(3, "bad", "C", 99)]),
      ],
      [],
    );
    for (const s of t.S) expect(s.p).toEqual([]);
    expect(t.pathUp(1).map((s) => s.id)).toEqual([1]);
  });

  it("calls an all-bad round None of these", () => {
    const t = treeOf([batch(1, 1, [sample(1, "bad", "A"), sample(2, "bad", "B")])], []);
    expect(t.rounds[0]?.call).toBe("None of these");
  });

  it("places every node of a wide batch inside the frame", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      sample(i + 1, i % 3 ? "bad" : null, `S ${i}`),
    );
    const blind = Array.from({ length: 20 }, (_, i) => sample(200 + i, null, null));
    const t = treeOf(
      [batch(1, 1, many), batch(2, 2, [sample(100, "good", "X", 1)]), batch(3, 3, blind, "open")],
      [],
    );
    for (const s of t.S) {
      const { x } = t.pos(s);
      expect(x).toBeGreaterThanOrEqual(G.AX);
      expect(x).toBeLessThanOrEqual(G.W);
    }
  });

  it("files a lock under the round it was decided after", () => {
    const t = treeOf(
      [batch(1, 1, [sample(1, "good", "A")]), batch(2, 3, [sample(2, "good", "B", 1)])],
      [
        { text: "Type is the hero", state: "locked", decidedAt: "2026-11-02T00:00:00Z" },
        { text: "Draft", state: "proposed", decidedAt: "2026-11-02T00:00:00Z" },
      ],
    );
    expect(t.rounds[0]?.locks).toEqual(["Type is the hero"]);
    expect(t.rounds[1]?.locks).toEqual([]);
  });
});
