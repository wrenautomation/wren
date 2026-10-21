import { describe, expect, it } from "vitest";
import { flow, grown, shape } from "../test/fixtures.js";
import { exportShape, parseShape } from "./shape-file.js";
import { canonicalJson, Refused } from "./store.js";
import { runOf } from "./stored.js";

const refusal = (text: string): string[] => {
  try {
    parseShape(text);
  } catch (e) {
    if (e instanceof Refused) return e.errors;
    throw e;
  }
  throw new Error("parsed");
};

describe("exportShape and parseShape", () => {
  it("round trip to the same body", () => {
    const body = grown(
      [{ id: "again", kind: "step", name: "Again", action: "other", advance: [] }],
      [flow("standard", "again", { kind: "loop", label: "renew" })],
    );
    expect(canonicalJson(parseShape(exportShape(body)).body)).toBe(canonicalJson(body));
  });

  it("writes the id, kind and name of a node first", () => {
    const text = exportShape(shape());
    expect(text).toContain("nodes:\n  - id: yt\n    kind: source\n    name: YouTube\n");
    expect(text).toContain(
      "edges:\n  - id: yt_to_engaged\n    kind: flow\n    from: yt\n    to: engaged\n",
    );
  });
});

describe("parseShape", () => {
  const file = `
name: Small
note: first cut
nodes:
  - { id: yt, kind: source, name: YouTube, via: organic }
  - { id: engaged, kind: step, name: Engaged, action: reply, advance: [] }
edges:
  - { from: yt, to: engaged }
  - { id: back, from: engaged, to: engaged, kind: loop }
moves:
  old: engaged
terms:
  - offer: offer-a
    plan: standard
    from: 2026-10-19
    why: first
    body: { currency: USD }
`;

  it("gives an edge its default id and kind", () => {
    const f = parseShape(file);
    const edges = runOf(f.body).edges;
    expect(edges[0]).toEqual({
      id: "yt_to_engaged",
      from: "yt",
      to: "engaged",
      kind: "flow",
    });
    expect(edges[1]?.id).toBe("back");
    expect(edges[1]?.kind).toBe("loop");
  });

  it("reads the note, moves and terms", () => {
    const f = parseShape(file);
    expect(f.note).toBe("first cut");
    expect(f.moves).toEqual({ old: "engaged" });
    expect(f.terms?.[0]).toMatchObject({ offer: "offer-a", plan: "standard", why: "first" });
  });

  it("leaves the optional parts out when the file has none", () => {
    const f = parseShape("name: S\nnodes: []\nedges: []\n");
    expect(f).toEqual({ body: { name: "S", nodes: [], edges: [] } });
  });

  it("refuses text that is not YAML", () => {
    expect(refusal("a: [b")[0]).toMatch(/not valid YAML/);
  });

  it("refuses a file with no map at the top", () => {
    expect(refusal("- a\n- b\n")).toEqual(["The file needs name, nodes and edges at the top."]);
  });

  it("names every problem at once", () => {
    const errors = refusal(`
name: ""
nodes:
  - { kind: source }
edges:
  - { from: a }
moves: [x]
terms: [{ offer: o }]
note: 3
`);
    expect(errors).toEqual([
      "The shape needs a name.",
      "Node 1 needs an id.",
      "Edge 1 needs from and to.",
      "moves maps an old node id to a new one.",
      "Terms 1 needs offer, plan, from, body and why.",
      "note is text.",
    ]);
  });

  it("needs a list of nodes", () => {
    expect(refusal("name: S\nnodes: 3\n")).toContain("nodes is a list.");
  });
});
