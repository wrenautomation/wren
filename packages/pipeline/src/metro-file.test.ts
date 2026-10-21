import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { metroPair, metroShape, wideShape } from "../test/fixtures.js";
import { metroOf } from "./convert.js";
import type { MetroBody } from "./metro.js";
import { exportMetro, FIRST, ordered, parseMetroBody } from "./metro-file.js";
import { Refused } from "./refused.js";
import { starterShape } from "./starter.js";

const metroOfGraph = (g: Parameters<typeof metroOf>[0]): MetroBody => {
  const r = metroOf(g);
  if (!r.ok) throw new Error(r.errors.join(" "));
  return r.body;
};

const refusal = (doc: unknown): string[] => {
  try {
    parseMetroBody(doc);
  } catch (e) {
    if (e instanceof Refused) return e.errors;
    throw e;
  }
  throw new Error("parsed");
};

/** A small file body to break one field at a time. */
const small = () => ({
  model: "metro",
  name: "Small",
  lines: [{ id: "social", label: "Social", tier: "out", entry: { via: "organic" } }],
  stations: [{ id: "social", label: "Social", kind: "att", line: "social", column: "marketing" }],
});

describe("exportMetro and parseMetroBody", () => {
  const cases: Array<[string, () => MetroBody]> = [
    ["metroShape()", metroShape],
    ["metroOf(wideShape())", () => metroOfGraph(wideShape())],
    ["metroOf(starter)", () => metroOfGraph(starterShape().body)],
    ["the older body of metroPair()", () => metroPair().a],
    ["the newer body of metroPair()", () => metroPair().b],
  ];

  it.each(cases)("round trip to the same body: %s", (_name, make) => {
    const body = make();
    expect(parseMetroBody(parse(exportMetro(body)))).toEqual(body);
  });

  it("writes model first, then name, lines, stations, tracks, groups, frames, flows", () => {
    const text = exportMetro(metroShape());
    const tops = text.split("\n").filter((l) => /^[a-z]/.test(l));
    expect(tops).toEqual([
      "model: metro",
      "name: Metro shape",
      "lines:",
      "stations:",
      "tracks:",
      "groups:",
      "frames:",
      "flows:",
    ]);
  });

  it("writes no flows key for a body that has none, and reads it back without one", () => {
    const body = metroShape();
    delete body.flows;
    body.stations = body.stations.filter((s) => s.kind !== "link");
    const text = exportMetro(body);
    expect(text).not.toContain("flows");
    const back = parseMetroBody(parse(text));
    expect("flows" in back).toBe(false);
    expect(back).toEqual(body);
  });

  it("writes an empty flows list as an empty list, and reads it back as one", () => {
    const body: MetroBody = { ...metroShape(), flows: [] };
    body.stations = body.stations.filter((s) => s.kind !== "link");
    const text = exportMetro(body);
    expect(text).toContain("flows: []");
    expect(parseMetroBody(parse(text)).flows).toEqual([]);
  });

  it("writes the id and label of a flow first, then its stations and tracks", () => {
    const text = exportMetro(metroShape());
    expect(text).toContain(
      "flows:\n  - id: shared_followup\n    label: Follow-up flow\n    stations:\n      - id: nudge\n        kind: att\n        label: Nudge\n",
    );
    expect(text).toContain(
      "    tracks:\n      - id: nudge_to_check_in\n        from: nudge\n        to: check_in\n",
    );
  });

  it("writes each attach as kind, ref, then label", () => {
    const text = exportMetro(metroShape());
    expect(text).toContain(
      "    attach:\n      - kind: sop\n        ref: growth-playbook\n        label: Playbook\n      - kind: link\n        ref: https://example.com/growth\n",
    );
  });

  it("reads attach and flows back exactly: an empty attach, a label, a flow station attach", () => {
    const body = metroShape();
    (body.lines.find((l) => l.id === "nurture") as MetroBody["lines"][number]).attach = [];
    const back = parseMetroBody(parse(exportMetro(body)));
    expect(back).toEqual(body);
    expect(back.lines.find((l) => l.id === "nurture")?.attach).toEqual([]);
    expect(back.lines.find((l) => l.id === "growth")?.attach?.[0]).toEqual({
      kind: "sop",
      ref: "growth-playbook",
      label: "Playbook",
    });
    expect(back.flows?.[0]?.stations[0]?.attach).toEqual([
      { kind: "template", ref: "book-first/nudge" },
    ]);
    expect("attach" in (back.lines.find((l) => l.id === "retain") ?? {})).toBe(false);
  });

  it("keeps a ref that looks like another type as text", () => {
    const body = metroShape();
    (body.lines.find((l) => l.id === "growth") as MetroBody["lines"][number]).attach = [
      { kind: "note", ref: "123", label: "true" },
      { kind: "doc", ref: "null" },
    ];
    expect(parseMetroBody(parse(exportMetro(body)))).toEqual(body);
  });

  it("writes the id, kind and label of a station first, and from and to of a track", () => {
    const text = exportMetro(metroShape());
    expect(text).toContain("stations:\n  - id: social\n    kind: att\n    label: Social\n");
    expect(text).toContain("tracks:\n  - id: social_to_hub\n    from: social\n    to: hub\n");
  });

  it("writes empty lists as empty lists and reads them back", () => {
    const body: MetroBody = { ...metroShape(), groups: [], frames: [] };
    const text = exportMetro(body);
    expect(text).toContain("groups: []");
    expect(text).toContain("frames: []");
    expect(parseMetroBody(parse(text))).toEqual(body);
  });

  it("keeps text that looks like another type as text", () => {
    const body = metroShape();
    const line = body.lines.find((l) => l.id === "team");
    expect(line?.entry?.segment).toBe("7");
    const back = parseMetroBody(parse(exportMetro(body)));
    expect(back.lines.find((l) => l.id === "team")?.entry?.segment).toBe("7");
    const odd: MetroBody = {
      ...body,
      name: "yes",
      lines: body.lines.map((l) => ({ ...l, label: "null" })),
    };
    expect(parseMetroBody(parse(exportMetro(odd)))).toEqual(odd);
  });

  it("does not change its input", () => {
    const body = metroShape();
    const before = JSON.stringify(body);
    exportMetro(body);
    expect(JSON.stringify(body)).toBe(before);
  });
});

describe("ordered", () => {
  it("puts the wanted keys first, in FIRST order, and keeps the rest in order", () => {
    expect(FIRST).toEqual(["id", "kind", "name", "from", "to", "label"]);
    const o = ordered({
      z: 1,
      label: "l",
      a: 2,
      to: "t",
      id: "i",
      from: "f",
      kind: "k",
      name: "n",
    });
    expect(Object.keys(o)).toEqual(["id", "kind", "name", "from", "to", "label", "z", "a"]);
  });
});

describe("parseMetroBody", () => {
  it("reads a small file, and lists left out come back empty", () => {
    expect(parseMetroBody(small())).toEqual({
      ...small(),
      tracks: [],
      groups: [],
      frames: [],
    });
  });

  it("leaves the values for checkMetro: a tier or a kind it does not know still parses", () => {
    const doc = small();
    (doc.lines[0] as { tier: string }).tier = "sideways";
    expect(parseMetroBody(doc).lines[0]?.tier).toBe("sideways");
  });

  it("refuses what is not a map", () => {
    for (const doc of [null, undefined, "text", 3, []]) {
      expect(refusal(doc)).toEqual(["The file needs model, name, lines and stations at the top."]);
    }
  });

  it("refuses a file that is not on the metro model", () => {
    expect(refusal({ ...small(), model: "graph" })).toEqual(["model is metro."]);
    const { model: _model, ...noModel } = small();
    expect(refusal(noModel)).toEqual(["model is metro."]);
  });

  it("refuses a name that is not text", () => {
    expect(refusal({ ...small(), name: 4 })).toEqual(["The shape needs a name."]);
    const { name: _name, ...noName } = small();
    expect(refusal(noName)).toEqual(["The shape needs a name."]);
  });

  it("refuses a list that is not a list, and a list item that is not a map", () => {
    expect(refusal({ ...small(), lines: "x", tracks: {} })).toEqual([
      "lines is a list.",
      "tracks is a list.",
    ]);
    const { lines: _lines, ...noLines } = small();
    expect(refusal(noLines)).toEqual(["lines is a list."]);
    expect(refusal({ ...small(), stations: ["x", 3] })).toEqual([
      "Station 1 is a map of fields.",
      "Station 2 is a map of fields.",
    ]);
  });

  it("refuses a missing needed field, by the item's id", () => {
    const doc = small();
    doc.stations = [{ id: "a", label: "A", line: "social", column: "marketing" } as never];
    expect(refusal(doc)).toEqual(['Station "a" has no kind.']);
    doc.stations = [{ label: "A", kind: "att", column: "marketing" } as never];
    expect(refusal(doc)).toEqual(["Station 1 has no id."]);
  });

  it("refuses a field of the wrong type, with what it should be", () => {
    const doc = {
      ...small(),
      tracks: [
        { id: "t", from: "a", to: "b", by: "system", weight: "60", entries: [1], else: false },
      ],
    };
    expect(refusal(doc)).toEqual([
      'Track "t": entries is a list of text.',
      'Track "t": else is true, or left out.',
      'Track "t": weight is a number.',
    ]);
  });

  it("refuses a field the model does not know", () => {
    const doc = {
      ...small(),
      colour: 1,
      tracks: [{ id: "t", from: "a", to: "b", by: "system", bogus: 1 }],
    };
    expect(refusal(doc)).toEqual([
      "colour is not a field of the file.",
      'Track "t": bogus is not a field.',
    ]);
  });

  it("checks inside an entry and inside a trigger", () => {
    const doc = small();
    doc.lines = [
      {
        id: "social",
        label: "Social",
        tier: "out",
        entry: { channel: "x", parked: "yes" },
      } as never,
    ];
    doc.stations = [
      {
        id: "s",
        label: "S",
        kind: "att",
        column: "marketing",
        advance: [
          { trigger: "trigger.reply" },
          { with: {} },
          { trigger: "t", with: { a: [] }, x: 1 },
        ],
      } as never,
    ];
    expect(refusal(doc)).toEqual([
      'Line "social" entry has no via.',
      'Line "social" entry: parked is true, or left out.',
      'Station "s" advance 2 has no trigger.',
      'Station "s" advance 3: x is not a field.',
      'Station "s" advance 3: with is a map of text or number values.',
    ]);
    const bad = small();
    bad.stations = [
      { id: "s", label: "S", kind: "att", column: "marketing", advance: "x" } as never,
    ];
    expect(refusal(bad)[0]).toMatch(/^Station "s": advance is a list of triggers/);
  });

  it("reads groups and frames, and checks a frame's trigger", () => {
    const doc = {
      ...small(),
      groups: [{ id: "g", label: "G", line: "social", stations: ["social"] }],
      frames: [{ id: "f", stations: ["social"], trigger: { trigger: "trigger.reply" }, exit: "x" }],
    };
    const body = parseMetroBody(doc);
    expect(body.groups).toHaveLength(1);
    expect(body.frames[0]?.trigger).toEqual({ trigger: "trigger.reply" });
    expect(refusal({ ...doc, frames: [{ id: "f", stations: ["social"], exit: "x" }] })).toEqual([
      'Frame "f" has no trigger.',
    ]);
    expect(refusal({ ...doc, groups: [{ id: "g", label: "G", line: "social" }] })).toEqual([
      'Group "g" has no stations.',
    ]);
  });

  it("finds every reason at once", () => {
    const errors = refusal({
      model: "metro",
      name: 1,
      lines: [{ id: "a" }],
      stations: "x",
      tracks: [{ id: "t" }],
      extra: true,
    });
    expect(errors).toEqual([
      "The shape needs a name.",
      "extra is not a field of the file.",
      'Line "a" has no label.',
      'Line "a" has no tier.',
      "stations is a list.",
      'Track "t" has no from.',
      'Track "t" has no to.',
      'Track "t" has no by.',
    ]);
  });

  it("reads attach on a line, a station and a group, and flows with their own stations", () => {
    const body = parseMetroBody({
      ...small(),
      lines: [
        {
          id: "social",
          label: "Social",
          tier: "out",
          entry: { via: "organic" },
          attach: [{ kind: "sop", ref: "playbook", label: "Playbook" }],
        },
      ],
      groups: [
        {
          id: "g",
          label: "G",
          line: "social",
          stations: ["social"],
          attach: [{ kind: "doc", ref: "d" }],
        },
      ],
      flows: [
        {
          id: "f",
          label: "F",
          stations: [
            { id: "s", label: "S", kind: "att", line: "social", column: "marketing", attach: [] },
          ],
          tracks: [],
        },
      ],
    });
    expect(body.lines[0]?.attach).toEqual([{ kind: "sop", ref: "playbook", label: "Playbook" }]);
    expect(body.groups[0]?.attach).toEqual([{ kind: "doc", ref: "d" }]);
    expect(body.flows).toEqual([
      {
        id: "f",
        label: "F",
        stations: [
          { id: "s", label: "S", kind: "att", line: "social", column: "marketing", attach: [] },
        ],
        tracks: [],
      },
    ]);
  });

  it("leaves a body with no flows key without one, and a flow with no tracks key with none", () => {
    expect("flows" in parseMetroBody(small())).toBe(false);
    const body = parseMetroBody({ ...small(), flows: [{ id: "f", label: "F", stations: [] }] });
    expect(body.flows).toEqual([{ id: "f", label: "F", stations: [], tracks: [] }]);
  });

  it("refuses attach that is not a list of maps, and an attach with a wrong field", () => {
    const line = (attach: unknown) => ({
      ...small(),
      lines: [{ id: "social", label: "Social", tier: "out", attach }],
    });
    expect(refusal(line("x"))[0]).toBe(
      'Line "social": attach is a list of attached refs, each with a kind, a ref and an optional label.',
    );
    expect(refusal(line(["x"]))[0]).toMatch(/^Line "social": attach is a list of attached refs/);
    expect(refusal(line([{ kind: "sop" }]))).toEqual(['Line "social" attach 1 has no ref.']);
    expect(refusal(line([{ ref: "x" }]))).toEqual(['Line "social" attach 1 has no kind.']);
    expect(refusal(line([{ kind: "sop", ref: "x", label: 5 }]))).toEqual([
      'Line "social" attach 1: label is text.',
    ]);
    expect(refusal(line([{ kind: "sop", ref: "x", size: 5 }]))).toEqual([
      'Line "social" attach 1: size is not a field.',
    ]);
    expect(refusal(line([{ kind: 4, ref: "x" }]))).toEqual([
      'Line "social" attach 1: kind is text.',
    ]);
  });

  it("leaves an unknown attach kind for checkMetro: it still parses", () => {
    const body = parseMetroBody({
      ...small(),
      lines: [{ id: "social", label: "Social", tier: "out", attach: [{ kind: "wiki", ref: "x" }] }],
    });
    expect(body.lines[0]?.attach).toEqual([{ kind: "wiki", ref: "x" }]);
  });

  it("refuses flows that is not a list, and a flow that is not a map", () => {
    expect(refusal({ ...small(), flows: {} })).toEqual(["flows is a list."]);
    expect(refusal({ ...small(), flows: null })).toEqual(["flows is a list."]);
    expect(refusal({ ...small(), flows: ["x"] })).toEqual(["Flow 1 is a map of fields."]);
  });

  it("refuses a flow with a field missing or unknown, by the flow's id", () => {
    expect(refusal({ ...small(), flows: [{ id: "f", stations: [] }] })).toEqual([
      'Flow "f" has no label.',
    ]);
    expect(refusal({ ...small(), flows: [{ label: "F", stations: [] }] })).toEqual([
      "Flow 1 has no id.",
    ]);
    expect(
      refusal({ ...small(), flows: [{ id: "f", label: "F", stations: [], hub: true }] }),
    ).toEqual(['Flow "f": hub is not a field.']);
  });

  it("names the flow in a reason inside it", () => {
    const flows = [
      {
        id: "f",
        label: "F",
        stations: [{ id: "s", label: "S", column: "marketing" }, "x"],
        tracks: [{ id: "t", from: "s", to: "s", by: "system", weight: "60" }],
      },
      { id: "g", label: "G", stations: "x", tracks: {} },
    ];
    expect(refusal({ ...small(), flows })).toEqual([
      'Flow "f": Station "s" has no kind.',
      'Flow "f": Station 2 is a map of fields.',
      'Flow "f": Track "t": weight is a number.',
      'Flow "g": stations is a list.',
      'Flow "g": tracks is a list.',
    ]);
  });

  it("does not change its input", () => {
    const doc = metroShape();
    const before = JSON.stringify(doc);
    parseMetroBody(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
});
