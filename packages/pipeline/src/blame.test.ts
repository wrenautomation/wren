import { describe, expect, it } from "vitest";
import { flow, grown, shape } from "../test/fixtures.js";
import { type BlameVersion, historyOf } from "./blame.js";
import type { ShapeBody } from "./model.js";

const ver = (number: number, body: ShapeBody, over: Partial<BlameVersion> = {}): BlameVersion => ({
  number,
  body,
  note: `Version ${number}`,
  createdBy: "ada",
  createdAt: new Date(Date.UTC(2026, 9, number)),
  ...over,
});

const rename = (body: ShapeBody, id: string, name: string): ShapeBody => ({
  ...body,
  nodes: body.nodes.map((n) => (n.id === id ? { ...n, name } : n)),
});

const hows = (v: BlameVersion[], id: string, on?: "node" | "edge") =>
  historyOf(v, id, on).map((l) => `${l.version}:${l.how}`);

describe("historyOf, nodes", () => {
  it("reads added, renamed, changed and removed, newest first", () => {
    const v1 = shape();
    const v2 = rename(v1, "booked", "On the calendar");
    const v3: ShapeBody = {
      ...v2,
      nodes: v2.nodes.map((n) => (n.id === "booked" ? { ...n, action: "other" as const } : n)),
    };
    const v4: ShapeBody = {
      ...v3,
      nodes: v3.nodes.filter((n) => n.id !== "booked"),
      edges: v3.edges.filter((e) => e.from !== "booked" && e.to !== "booked"),
    };
    const lines = historyOf([ver(1, v1), ver(2, v2), ver(3, v3), ver(4, v4)], "booked");
    expect(lines.map((l) => [l.version, l.how])).toEqual([
      [4, "removed"],
      [3, "changed"],
      [2, "renamed"],
      [1, "added"],
    ]);
    expect(lines[2]).toMatchObject({ from: "Booked", to: "On the calendar" });
    expect(lines[0]).not.toHaveProperty("from");
  });

  it("gives who, when and why as ISO text", () => {
    const [line] = historyOf(
      [
        ver(1, shape(), {
          note: "Start",
          createdBy: "grace",
          createdAt: "2026-10-01T09:30:00.000Z",
        }),
      ],
      "yt",
    );
    expect(line).toEqual({
      version: 1,
      how: "added",
      note: "Start",
      by: "grace",
      at: "2026-10-01T09:30:00.000Z",
    });
    const [fromDate] = historyOf([ver(1, shape())], "yt");
    expect(fromDate?.at).toBe("2026-10-01T00:00:00.000Z");
  });

  it("gives two lines, renamed first, when one version renames and changes", () => {
    const v1 = shape();
    const v2: ShapeBody = {
      ...v1,
      nodes: v1.nodes.map((n) =>
        n.id === "booked" ? { ...n, name: "Call", action: "other" as const } : n,
      ),
    };
    const lines = historyOf([ver(1, v1), ver(2, v2)], "booked");
    expect(lines.map((l) => `${l.version}:${l.how}`)).toEqual([
      "2:renamed",
      "2:changed",
      "1:added",
    ]);
  });

  it("skips versions that leave the node alone", () => {
    const v1 = shape();
    const v2 = rename(v1, "yt", "Videos");
    expect(hows([ver(1, v1), ver(2, v2), ver(3, v2)], "booked")).toEqual(["1:added"]);
  });

  it("shows both when a node is removed and added back", () => {
    const v1 = shape();
    const v2: ShapeBody = { ...v1, nodes: v1.nodes.filter((n) => n.id !== "standard") };
    expect(hows([ver(1, v1), ver(2, v2), ver(3, v1)], "standard")).toEqual([
      "3:added",
      "2:removed",
      "1:added",
    ]);
  });

  it("sorts by number, not by the order given, and leaves its input alone", () => {
    const v1 = shape();
    const v2 = rename(v1, "yt", "Videos");
    const input = [ver(2, v2), ver(1, v1)];
    expect(hows(input, "yt")).toEqual(["2:renamed", "1:added"]);
    expect(input.map((v) => v.number)).toEqual([2, 1]);
  });

  it("gives nothing for an unknown id or no versions", () => {
    expect(historyOf([ver(1, shape())], "nowhere")).toEqual([]);
    expect(historyOf([], "yt")).toEqual([]);
  });
});

describe("historyOf, edges", () => {
  it("reads added, changed and removed", () => {
    const v1 = shape();
    const v2: ShapeBody = {
      ...v1,
      edges: v1.edges.map((e) => (e.id === "engaged_to_booked" ? { ...e, label: "yes" } : e)),
    };
    const v3: ShapeBody = { ...v2, edges: v2.edges.filter((e) => e.id !== "engaged_to_booked") };
    const v0: ShapeBody = { ...v1, edges: v1.edges.filter((e) => e.id !== "engaged_to_booked") };
    expect(
      hows([ver(1, v0), ver(2, v1), ver(3, v2), ver(4, v3)], "engaged_to_booked", "edge"),
    ).toEqual(["4:removed", "3:changed", "2:added"]);
  });

  it("does not read a node id as an edge id", () => {
    const next = grown([], [flow("proposal", "booked", { id: "yt" })]);
    expect(hows([ver(1, shape()), ver(2, next)], "yt", "edge")).toEqual(["2:added"]);
    expect(hows([ver(1, shape()), ver(2, next)], "yt")).toEqual(["1:added"]);
  });

  it("gives nothing for an unknown edge", () => {
    expect(historyOf([ver(1, shape())], "gone", "edge")).toEqual([]);
  });
});
