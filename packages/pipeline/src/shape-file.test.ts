import { describe, expect, it } from "vitest";
import { asMetro, metroShape, shape, wideShape } from "../test/fixtures.js";
import { exportMetro } from "./metro-file.js";
import { exportShape, parseShape } from "./shape-file.js";
import { CONVERT_FIRST, canonicalJson, Refused } from "./store.js";

const refusal = (text: string): string[] => {
  try {
    parseShape(text);
  } catch (e) {
    if (e instanceof Refused) return e.errors;
    throw e;
  }
  throw new Error("parsed");
};

/** A small metro file: one out line, its station. */
const small = `model: metro
name: Small
lines:
  - id: yt
    label: YouTube
    tier: out
    entry:
      via: organic
stations:
  - id: yt
    kind: att
    label: YouTube
    line: yt
    column: marketing
`;

describe("exportShape and parseShape", () => {
  it.each([
    ["metroShape()", metroShape],
    ["metroOf(wideShape())", () => asMetro(wideShape())],
  ])("round trip to the same metro body: %s", (_name, make) => {
    const body = make();
    expect(canonicalJson(parseShape(exportShape(body)).body)).toBe(canonicalJson(body));
  });

  it("writes a metro body with exportMetro", () => {
    expect(exportShape(metroShape())).toBe(exportMetro(metroShape()));
  });

  it("still writes the id, kind and name of a graph node first, so an old version can be read", () => {
    const text = exportShape(shape());
    expect(text).toContain("nodes:\n  - id: yt\n    kind: source\n    name: YouTube\n");
    expect(text).toContain(
      "edges:\n  - id: yt_to_engaged\n    kind: flow\n    from: yt\n    to: engaged\n",
    );
  });
});

describe("parseShape", () => {
  const file = `${small}note: first cut
moves:
  old: yt
terms:
  - offer: offer-a
    plan: standard
    from: 2026-10-19
    why: first
    body: { currency: USD }
`;

  it("refuses a graph file: convert first", () => {
    expect(refusal(exportShape(shape()))).toEqual([CONVERT_FIRST]);
    expect(refusal("name: S\nnodes: []\nedges: []\n")).toEqual([CONVERT_FIRST]);
  });

  it("reads the note, moves and terms of a metro file", () => {
    const f = parseShape(file);
    expect(f.note).toBe("first cut");
    expect(f.moves).toEqual({ old: "yt" });
    expect(f.terms?.[0]).toMatchObject({ offer: "offer-a", plan: "standard", why: "first" });
  });

  it("leaves the optional parts out when the file has none", () => {
    const f = parseShape(small);
    expect(Object.keys(f)).toEqual(["body"]);
    expect(f.body.model).toBe("metro");
  });

  it("refuses text that is not YAML", () => {
    expect(refusal("a: [b")[0]).toMatch(/not valid YAML/);
  });

  it("refuses a file with no map at the top", () => {
    expect(refusal("- a\n- b\n")).toEqual([
      "The file needs model, name, lines and stations at the top.",
    ]);
  });

  it("refuses a model that is not metro", () => {
    expect(refusal("model: graph\nname: S\n")).toEqual(["model is metro."]);
  });

  it("names every problem at once", () => {
    const errors = refusal(`${small}moves: [x]
terms: [{ offer: o }]
note: 3
`);
    expect(errors).toEqual([
      "moves maps an old node id to a new one.",
      "Terms 1 needs offer, plan, from, body and why.",
      "note is text.",
    ]);
  });
});
