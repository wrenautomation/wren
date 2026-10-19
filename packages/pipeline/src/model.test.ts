import { describe, expect, it } from "vitest";
import { ctx, flow, grown, loop, shape } from "../test/fixtures.js";
import {
  checkShape,
  depthOf,
  edgeIdOf,
  isEnd,
  passedThrough,
  pathOf,
  type ShapeBody,
  type ShapeNode,
} from "./model.js";

const problems = (b: ShapeBody, c = ctx()) => checkShape(b, c).join("\n");

describe("checkShape", () => {
  it("accepts a good shape", () => {
    expect(checkShape(shape(), ctx())).toEqual([]);
  });

  it("needs a source", () => {
    const b = shape();
    b.nodes = b.nodes.filter((n) => n.kind !== "source");
    b.edges = b.edges.filter((e) => e.from !== "yt" && e.from !== "mail");
    expect(problems(b)).toMatch(/at least one source/);
  });

  it("checks node ids", () => {
    const b = grown(
      [
        { id: "Bad-Id", kind: "step", name: "X", action: "other", advance: [] },
        { id: "dropped", kind: "step", name: "X", action: "other", advance: [] },
        { id: "booked", kind: "step", name: "Twice", action: "other", advance: [] },
        { id: `a${"b".repeat(40)}`, kind: "step", name: "Long", action: "other", advance: [] },
      ],
      [],
    );
    const text = problems(b);
    expect(text).toMatch(/Node id "Bad-Id" must be lowercase/);
    expect(text).toMatch(/Node id "dropped" is reserved for dropped journeys/);
    expect(text).toMatch(/Node id "booked" is used twice/);
    expect(text).toMatch(/is longer than 40 characters/);
  });

  it("checks edges: ends, self, repeat, id, source in", () => {
    const b = shape();
    b.edges.push(
      flow("engaged", "nowhere"),
      flow("engaged", "engaged"),
      { ...flow("engaged", "booked"), id: "again" },
      { ...flow("engaged", "proposal"), id: "engaged_to_booked" },
      flow("proposal", "yt"),
      { ...flow("booked", "signed"), id: "Bad Id" },
    );
    const text = problems(b);
    expect(text).toMatch(/names node "nowhere", which is not in the shape/);
    expect(text).toMatch(/starts and ends at "engaged"/);
    expect(text).toMatch(/Edge "again" repeats edge "engaged_to_booked"/);
    expect(text).toMatch(/Edge id "engaged_to_booked" is used twice/);
    expect(text).toMatch(/ends at source "yt"/);
    expect(text).toMatch(/Edge id "Bad Id" must be lowercase/);
  });

  it("names one cycle of flow edges, and lets a loop edge close one", () => {
    const b = shape();
    b.edges.push(flow("proposal", "engaged"));
    expect(problems(b)).toMatch(
      /Flow edges form a loop: engaged -> booked -> proposal -> engaged\./,
    );
    const ok = shape();
    ok.edges.push(loop("proposal", "engaged"));
    expect(checkShape(ok, ctx())).toEqual([]);
  });

  it("lets the same pair carry a flow edge and a loop edge", () => {
    const b = shape();
    b.edges.push({ ...loop("engaged", "booked"), id: "engaged_back_to_booked" });
    expect(checkShape(b, ctx())).toEqual([]);
  });

  it("needs a flow edge into every node but a source", () => {
    const b = grown(
      [{ id: "lost", kind: "step", name: "Lost", action: "other", advance: [] }],
      [loop("proposal", "lost")],
    );
    expect(problems(b)).toMatch(/Node "lost" has no flow edge into it/);
  });

  it("keeps a plan under one offer node", () => {
    const orphan = grown(
      [{ id: "alt", kind: "plan", name: "Alt", terms: "alt", advance: [] }],
      [flow("booked", "alt")],
    );
    expect(problems(orphan)).toMatch(/Plan "alt" must follow one offer node/);

    const two = grown(
      [
        { id: "extra", kind: "offer", name: "Extra", offer: "offer-b", advance: [] },
        { id: "both", kind: "plan", name: "Both", terms: "both", advance: [] },
      ],
      [flow("booked", "extra"), flow("signed", "both"), flow("extra", "both")],
    );
    expect(problems(two)).toMatch(/Plan "both" must follow one offer node/);
  });

  it("allows an upsell below a plan", () => {
    const b = grown(
      [{ id: "upsell", kind: "offer", name: "Upsell", offer: "offer-b", advance: [] }],
      [flow("standard", "upsell")],
    );
    expect(checkShape(b, ctx())).toEqual([]);
  });

  it("checks triggers, research, idle days, action", () => {
    const b = shape();
    b.nodes[2] = {
      id: "engaged",
      kind: "step",
      name: "Engaged",
      action: "wave" as never,
      advance: [{ trigger: "trigger.nope" }],
      research: "deep" as never,
      idleDays: 0,
    };
    const text = problems(b);
    expect(text).toMatch(/Node "engaged" uses "trigger.nope", which is not a known trigger/);
    expect(text).toMatch(/Node "engaged" has research "deep". Use none, light or full/);
    expect(text).toMatch(/Node "engaged" has idleDays 0. Use a whole number of days from 1 to 365/);
    expect(text).toMatch(/Step "engaged" has action "wave"/);
    const b2 = shape();
    (b2.nodes[3] as { idleDays?: number }).idleDays = 366;
    expect(problems(b2)).toMatch(/idleDays 366/);
  });

  it("checks a sourced source", () => {
    const src = (extra: Record<string, string>): ShapeNode =>
      ({ id: "list", kind: "source", name: "List", via: "sourced", ...extra }) as ShapeNode;
    const withSource = (n: ShapeNode) => grown([n], [flow("list", "engaged")]);
    expect(problems(withSource(src({})))).toMatch(/via sourced but names no source/);
    expect(problems(withSource(src({ source: "list-1" })))).toMatch(
      /not a list's id \(import:12\)/,
    );
    expect(problems(withSource(src({ source: "import:99" })))).toMatch(
      /names source import:99, which does not exist/,
    );
    expect(checkShape(withSource(src({ source: "import:12" })), ctx())).toEqual([]);
  });

  it("checks a group source", () => {
    const src = (extra: Record<string, string>): ShapeNode =>
      ({ id: "seg", kind: "source", name: "Group", via: "group", ...extra }) as ShapeNode;
    const withGroup = (n: ShapeNode) => grown([n], [flow("seg", "engaged")]);
    expect(problems(withGroup(src({})))).toMatch(/via group but names no group/);
    expect(problems(withGroup(src({ group: "q-1" })))).toMatch(/not a group's number/);
    expect(problems(withGroup(src({ group: "99" })))).toMatch(/group 99, which does not exist/);
    expect(problems(withGroup(src({ group: "8" })))).toMatch(/group 8, which is archived/);
    expect(checkShape(withGroup(src({ group: "7" })), ctx())).toEqual([]);
  });

  it("keeps a parked source valid", () => {
    const b = shape();
    (b.nodes[0] as { parked?: true }).parked = true;
    expect(checkShape(b, ctx())).toEqual([]);
  });
});

describe("depthOf", () => {
  it("is 0 at sources and counts the longest flow path", () => {
    expect(depthOf(shape())).toEqual({
      yt: 0,
      mail: 0,
      engaged: 1,
      booked: 2,
      proposal: 3,
      signed: 4,
      standard: 5,
    });
  });

  it("takes the longest path through a diamond", () => {
    const b = grown(
      [
        { id: "a", kind: "step", name: "A", action: "other", advance: [] },
        { id: "b", kind: "step", name: "B", action: "other", advance: [] },
        { id: "c", kind: "step", name: "C", action: "other", advance: [] },
        { id: "d", kind: "step", name: "D", action: "other", advance: [] },
      ],
      [
        flow("yt", "a"),
        flow("a", "b"),
        flow("a", "c"),
        flow("b", "d"),
        flow("c", "d"),
        flow("yt", "d"),
      ],
    );
    const d = depthOf(b);
    expect([d.a, d.b, d.c, d.d]).toEqual([1, 2, 2, 3]);
  });

  it("takes the longest path from any of two sources", () => {
    const b = shape();
    b.edges.push(flow("mail", "proposal"));
    const d = depthOf(b);
    expect(d.proposal).toBe(3);
    const short = grown(
      [{ id: "side", kind: "step", name: "Side", action: "other", advance: [] }],
      [flow("mail", "side"), flow("side", "proposal")],
    );
    expect(depthOf(short).proposal).toBe(3);
  });

  it("ignores loop edges", () => {
    const b = shape();
    b.edges.push(loop("proposal", "engaged"), loop("standard", "booked"));
    expect(depthOf(b)).toEqual(depthOf(shape()));
  });

  it("puts an upsell below a plan", () => {
    const b = grown(
      [{ id: "upsell", kind: "offer", name: "Upsell", offer: "offer-b", advance: [] }],
      [flow("standard", "upsell")],
    );
    expect(depthOf(b).upsell).toBe(6);
  });

  it("does not loop on a cycle", () => {
    const b = shape();
    b.edges.push(flow("proposal", "engaged"));
    expect(Object.keys(depthOf(b))).toHaveLength(7);
  });
});

describe("pathOf", () => {
  it("gives the edge ids of the shortest flow path", () => {
    expect(pathOf(shape(), "engaged", "proposal")).toEqual([
      "engaged_to_booked",
      "booked_to_proposal",
    ]);
    expect(pathOf(shape(), "engaged", "booked")).toEqual(["engaged_to_booked"]);
  });

  it("is null for no path, backward, and the same node", () => {
    expect(pathOf(shape(), "proposal", "engaged")).toBeNull();
    expect(pathOf(shape(), "booked", "booked")).toBeNull();
    expect(pathOf(shape(), "yt", "mail")).toBeNull();
  });

  it("takes the shortest path, ties by edge order", () => {
    const b = grown(
      [
        { id: "a", kind: "step", name: "A", action: "other", advance: [] },
        { id: "b", kind: "step", name: "B", action: "other", advance: [] },
      ],
      [
        flow("engaged", "a"),
        flow("a", "signed"),
        flow("engaged", "b"),
        flow("b", "signed"),
        flow("engaged", "proposal", { id: "shortcut" }),
      ],
    );
    expect(pathOf(b, "engaged", "proposal")).toEqual(["shortcut"]);
    const tie = grown(
      [
        { id: "a", kind: "step", name: "A", action: "other", advance: [] },
        { id: "b", kind: "step", name: "B", action: "other", advance: [] },
        { id: "end", kind: "step", name: "End", action: "other", advance: [] },
      ],
      [flow("engaged", "a"), flow("engaged", "b"), flow("b", "end"), flow("a", "end")],
    );
    expect(pathOf(tie, "engaged", "end")).toEqual(["engaged_to_a", "a_to_end"]);
  });

  it("counts a single loop edge as a path of one", () => {
    const b = shape();
    b.edges.push(loop("proposal", "engaged"));
    expect(pathOf(b, "proposal", "engaged")).toEqual(["proposal_to_engaged"]);
    expect(pathOf(b, "proposal", "engaged", { loops: false })).toBeNull();
    // Two loop edges in a row are not a path.
    b.edges.push(loop("engaged", "yt"));
    expect(pathOf(b, "proposal", "booked")).toBeNull();
  });

  it("lists the nodes a path passes through", () => {
    const b = shape();
    const path = pathOf(b, "engaged", "signed") ?? [];
    expect(passedThrough(b, path)).toEqual(["booked", "proposal"]);
    expect(passedThrough(b, ["engaged_to_booked"])).toEqual([]);
  });
});

describe("small helpers", () => {
  it("names a default edge id", () => {
    expect(edgeIdOf("a", "b")).toBe("a_to_b");
  });

  it("knows a node no flow edge leaves", () => {
    expect(isEnd(shape(), "standard")).toBe(true);
    expect(isEnd(shape(), "signed")).toBe(false);
  });
});
