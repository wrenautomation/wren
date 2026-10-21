import { describe, expect, it } from "vitest";
import { ctx, metroShape, shape, wideShape } from "../test/fixtures.js";
import {
  type ConvertReport,
  dealRulesOf,
  planConvert,
  refusalsOf,
  reportLines,
} from "./convert-shape.js";
import type { MetroBody } from "./metro.js";
import type { ShapeBody } from "./model.js";
import { Refused } from "./refused.js";

const none = new Map<string, number>();

const planOf = (g: ShapeBody, over: Parameters<typeof ctx>[0] = {}, open = none) => {
  const p = planConvert(g, 3, ctx(over), open);
  if (p.already) throw new Error("expected a graph");
  return p;
};

describe("planConvert", () => {
  it("proves a graph that draws and lowers back", () => {
    for (const g of [shape(), wideShape()]) {
      const { body, report } = planOf(g);
      expect(body.model).toBe("metro");
      expect(report).toMatchObject({
        notes: [],
        checks: [],
        graphEqual: true,
        workflowEqual: true,
      });
      expect(refusalsOf(report)).toEqual([]);
    }
  });

  it("keeps a metro body as it is", () => {
    const m = metroShape();
    const p = planConvert(m, 1, ctx(), none);
    expect(p).toEqual({ already: true, body: m });
    expect(p.body).toBe(m);
  });

  it("refuses a graph that cannot be drawn, with every reason", () => {
    const g = shape();
    const bad: ShapeBody = {
      ...g,
      nodes: g.nodes.map((n) => (n.id === "engaged" ? { ...n, id: "hub" } : n)),
      edges: g.edges.map((e) => ({
        ...e,
        id: e.id.replace("engaged", "hub"),
        from: e.from === "engaged" ? "hub" : e.from,
        to: e.to === "engaged" ? "hub" : e.to,
      })),
    };
    expect(() => planConvert(bad, 1, ctx(), none)).toThrow(Refused);
    expect(() => planConvert(bad, 1, ctx(), none)).toThrow(/keeps the id "hub" for its hub/);
  });

  it("names a check the metro body fails", () => {
    const { report } = planOf(shape(), { triggers: new Set() });
    expect(report.checks.join(" ")).toMatch(/trigger\.reply/);
    expect(refusalsOf(report)[0]).toMatch(/^The metro body fails a check: /);
  });

  it("says graph equal no and names what the convert drops", () => {
    const g = shape();
    const odd: ShapeBody = {
      ...g,
      edges: g.edges.map((e) => (e.id === "yt_to_engaged" ? { ...e, id: "yt_in" } : e)),
    };
    const { report } = planOf(odd);
    expect(report.graphEqual).toBe(false);
    expect(report.notes).toHaveLength(1);
    expect(reportLines(report).slice(0, 4)).toEqual([
      `note: ${report.notes[0]}`,
      "checks: ok",
      "graph equal: no",
      "workflow equal: yes",
    ]);
    const why = refusalsOf(report);
    expect(why).toContain("The metro body does not give the same graph back.");
    expect(why).toContain(`The convert drops: ${report.notes[0]}`);
    expect(why.join(" ")).not.toMatch(/another order/);
  });

  it("hints at order when the parts are the same and the order differs", () => {
    const g = shape();
    const { report } = planOf({ ...g, edges: [...g.edges].reverse() });
    expect(report).toMatchObject({ notes: [], graphEqual: false });
    expect(refusalsOf(report).join(" ")).toMatch(/another order/);
  });

  it("counts the open journeys before the deal station", () => {
    const { report } = planOf(
      shape(),
      {},
      new Map([
        ["engaged", 2],
        ["booked", 1],
        ["signed", 9],
      ]),
    );
    expect(report.deals).toHaveLength(1);
    expect(report.deals[0]).toMatchObject({ line: "signed", first: "engaged", deal: "signed" });
    // The deal station itself is not before the deal station.
    expect(report.deals[0]?.between.map((s) => s.station)).not.toContain("signed");
    expect(reportLines(report).at(-1)).toBe(
      "deal rule signed: first station engaged, deal station signed, " +
        "open before the deal station: 3 (engaged 2, booked 1)",
    );
  });
});

describe("dealRulesOf", () => {
  it("gives the first station by place and the stations before the deal station", () => {
    const rules = dealRulesOf(
      metroShape(),
      new Map([
        ["reply", 3],
        ["book", 2],
        ["signed", 1],
      ]),
    );
    expect(rules).toHaveLength(1);
    const [growth] = rules;
    expect(growth).toMatchObject({ line: "growth", first: "reply", deal: "signed" });
    const stations = growth?.between.map((s) => s.station) ?? [];
    expect(stations[0]).toBe("reply");
    expect(stations).toContain("proposal");
    expect(stations).not.toContain("signed");
    expect(stations).not.toContain("onboard");
    expect(growth?.between.find((s) => s.station === "book")?.open).toBe(2);
    expect(growth?.between.reduce((n, s) => n + s.open, 0)).toBe(5);
  });

  it("is empty between when the deal station is the first", () => {
    const m: MetroBody = {
      ...metroShape(),
      stations: metroShape().stations.map((s) =>
        s.line === "growth" ? (({ deal: _d, ...rest }) => rest)(s) : s,
      ),
    };
    const first = dealRulesOf(metroShape(), none)[0]?.first;
    const withDeal: MetroBody = {
      ...m,
      stations: m.stations.map((s) => (s.id === first ? { ...s, deal: true as const } : s)),
    };
    const [rule] = dealRulesOf(withDeal, new Map([["signed", 4]]));
    expect(rule).toMatchObject({ first, deal: first, between: [] });
  });

  it("skips a line with no deal station", () => {
    const m: MetroBody = {
      ...metroShape(),
      stations: metroShape().stations.map(({ deal: _d, ...rest }) => rest),
    };
    expect(dealRulesOf(m, none)).toEqual([]);
  });
});

describe("reportLines", () => {
  const base: ConvertReport = {
    notes: [],
    checks: [],
    graphEqual: true,
    workflowEqual: true,
    deals: [],
  };

  it("says notes none and checks ok for a clean report", () => {
    expect(reportLines(base)).toEqual([
      "notes: none",
      "checks: ok",
      "graph equal: yes",
      "workflow equal: yes",
    ]);
  });

  it("lists each note and each check, and graph and workflow no", () => {
    expect(
      reportLines({
        ...base,
        notes: ["a", "b"],
        checks: ["c"],
        graphEqual: false,
        workflowEqual: false,
      }),
    ).toEqual(["note: a", "note: b", "check: c", "graph equal: no", "workflow equal: no"]);
  });

  it("prints a deal rule: same station, and moved with open journeys", () => {
    const lines = reportLines({
      ...base,
      deals: [
        { line: "a", first: "x", deal: "x", between: [] },
        {
          line: "b",
          first: "p",
          deal: "q",
          between: [
            { station: "p", open: 0 },
            { station: "r", open: 0 },
          ],
        },
        { line: "c", first: "p", deal: "q", between: [{ station: "p", open: 2 }] },
      ],
    });
    expect(lines.slice(4)).toEqual([
      "deal rule a: first station x is the deal station",
      "deal rule b: first station p, deal station q, open before the deal station: 0",
      "deal rule c: first station p, deal station q, open before the deal station: 2 (p 2)",
    ]);
  });
});

describe("refusalsOf", () => {
  it("is empty for a proven report and lists the workflow miss", () => {
    const ok: ConvertReport = {
      notes: [],
      checks: [],
      graphEqual: true,
      workflowEqual: true,
      deals: [],
    };
    expect(refusalsOf(ok)).toEqual([]);
    expect(refusalsOf({ ...ok, workflowEqual: false })).toEqual([
      "The metro body does not run as the same workflow.",
    ]);
  });
});
