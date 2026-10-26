import { checkWorkflows } from "@wren/core/workflows";
import { describe, expect, it } from "vitest";
import { asMetro, ctx, shape, TRIGGERS, withFilms } from "../test/fixtures.js";
import { graphOf, lowerable, metroOf } from "./convert.js";
import { checkMetro } from "./metro.js";
import { checkShape } from "./model.js";
import { shapeWorkflow } from "./workflow.js";

const check = ctx({ triggers: new Set([...TRIGGERS, "trigger.found", "trigger.station"]) });

describe("a content line", () => {
  it("checks and lowers clean", () => {
    const b = withFilms();
    expect(checkMetro(b, check)).toEqual([]);
    expect(lowerable(b)).toEqual([]);
    expect(checkShape(graphOf(b), check)).toEqual([]);
  });

  it("lowers find to a found source and each station to a job the one before it ends", () => {
    const g = graphOf(withFilms());
    const by = new Map(g.nodes.map((n) => [n.id, n] as const));
    expect(by.get("find")).toEqual({
      id: "find",
      kind: "source",
      name: "Find",
      via: "found",
      sop: "launch-films",
    });
    expect(by.get("read")).toEqual({
      id: "read",
      kind: "job",
      name: "read",
      job: "read",
      advance: [],
    });
    expect(by.get("extract")).toMatchObject({
      kind: "job",
      job: "extract",
      advance: [{ trigger: "trigger.station", with: { station: "read" } }],
    });
    expect(by.get("call")).toMatchObject({
      kind: "job",
      job: "call",
      advance: [{ trigger: "trigger.station", with: { station: "extract" } }],
    });
    expect(g.edges.filter((e) => ["find", "read", "extract"].includes(e.from))).toEqual([
      { id: "find_to_read", from: "find", to: "read", kind: "flow" },
      { id: "read_to_extract", from: "read", to: "extract", kind: "flow" },
      { id: "extract_to_call", from: "extract", to: "call", kind: "flow" },
    ]);
  });

  it("keeps the people nodes in their old order, the content nodes after", () => {
    const old = graphOf(asMetro(shape())).nodes;
    const before = old.map((n) => n.id);
    const after = graphOf(withFilms()).nodes.map((n) => n.id);
    const sources = old.filter((n) => n.kind === "source").map((n) => n.id);
    expect(after.slice(0, sources.length)).toEqual(sources);
    expect(after.filter((id) => before.includes(id))).toEqual(before);
    expect(after.slice(sources.length, sources.length + 1)).toEqual(["find"]);
  });

  it("runs as move and stage nodes on doc events", () => {
    const w = shapeWorkflow(3, graphOf(withFilms()), "wren");
    expect(checkWorkflows([w], [])).toEqual([]);
    const by = new Map(w.nodes.map((n) => [n.id, n] as const));
    expect(by.get("e_find")).toEqual({
      id: "e_find",
      uses: "trigger.found",
      with: { sop: "launch-films" },
    });
    for (const k of ["read", "extract", "call"]) {
      expect(by.get(`m_${k}`)?.own?.run).toBe("journey.move");
      expect(by.get(`m_${k}`)?.own?.out).toEqual([{ id: "moved", label: "moves", kind: "doc" }]);
      expect(by.get(`m_${k}`)?.own?.in).toEqual([
        { id: "journey", label: "documents", kind: "doc" },
      ]);
      expect(by.get(`s_${k}`)?.with).toEqual({ node: k, job: k });
    }
    const wires = w.wires.map((x) => `${x.from} -> ${x.to}`);
    expect(wires).toContain("e_find.out -> m_read.journey");
    expect(wires).toContain("t_extract_0.out -> m_extract.journey");
    expect(wires).toContain("t_call_0.out -> m_call.journey");
    expect(by.get("t_extract_0")).toEqual({
      id: "t_extract_0",
      uses: "trigger.station",
      with: { station: "read" },
    });
  });

  it("holds only content stations, one find with an SOP, and no track to people", () => {
    const b = withFilms();
    b.stations.push(
      { id: "find2", label: "Find 2", kind: "find", line: "films", column: "marketing" },
      { id: "stray", label: "Stray", kind: "read", line: "signed", column: "sales" },
      {
        id: "note",
        label: "Note",
        kind: "att",
        line: "films",
        column: "sales",
        action: "email",
        advance: [],
      },
    );
    b.tracks.push(
      { id: "call_to_book", from: "call", to: "booked", line: "signed", by: "person" },
      { id: "read_to_find2", from: "read", to: "find2", line: "films", by: "system" },
    );
    const errors = checkMetro(b, check);
    expect(errors).toEqual(
      expect.arrayContaining([
        'Station "stray" is a read station, so it must be on a content line.',
        'Station "note" is on content line "films", which holds only find, read, extract, call, measure stations.',
        'Find station "find2" names no SOP or study.',
        'Content line "films" needs one find station, not 2.',
        'Track "read_to_find2" enters find station "find2". A find station only opens.',
        'Track "call_to_book" joins a content station to another kind. An edge never changes what an instance is about.',
      ]),
    );
  });

  it("refuses a back track on a content line, and the graph draw of one", () => {
    const b = withFilms();
    b.tracks.push({ id: "call_back", from: "call", to: "extract", kind: "back", by: "person" });
    expect(lowerable(b)).toContain(
      'Track "call_back" is a back track on a content line. The runtime does not run it yet.',
    );
    const drawn = metroOf(graphOf(withFilms()));
    expect(drawn.ok).toBe(false);
    if (!drawn.ok) {
      expect(drawn.errors).toContain(
        'Node "find" is on a content line. Draw content lines on the map.',
      );
    }
  });
});
