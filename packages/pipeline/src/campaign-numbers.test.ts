import { describe, expect, it } from "vitest";
import { metroShape } from "../test/fixtures.js";
import { type Arrival, campaignNumbers } from "./campaign-numbers.js";
import type { MetroBody } from "./metro.js";

/** `metroShape()` with campaign `spring` (book, prep, docs; CTA book) and `late` inside it (held). */
const body = (): MetroBody => {
  const b = metroShape();
  b.groups.push(
    {
      id: "spring",
      label: "Spring",
      line: "growth",
      stations: ["book", "docs", "prep"],
      campaign: { ctas: [{ label: "Book", station: "book" }] },
    },
    {
      id: "late",
      label: "Late",
      line: "growth",
      parent: "spring",
      stations: ["held"],
      campaign: {},
    },
  );
  return b;
};
const at = (journey: string, node: string, day = "2026-11-02", version = 2): Arrival => ({
  journey,
  version,
  node,
  day,
});
const rowsOf = (over: Partial<Parameters<typeof campaignNumbers>[0]> = {}) =>
  Object.fromEntries(
    campaignNumbers({
      newest: body(),
      bodies: new Map([[2, body()]]),
      arrivals: [],
      open: [],
      deals: [],
      ...over,
    }).map((r) => [r.campaign, r]),
  );

describe("campaignNumbers", () => {
  it("counts people once, a child's in its parent, and the rest in the default", () => {
    const r = rowsOf({
      arrivals: [at("a", "prep"), at("a", "book"), at("b", "held"), at("c", "reply")],
    });
    expect(Object.keys(r)).toEqual(["default", "spring", "late"]);
    expect(r.spring).toMatchObject({ people: 2, converted: 1, gone: false });
    expect(r.late).toMatchObject({ people: 1, converted: 0 });
    expect(r.default).toMatchObject({ people: 1, status: "live" });
  });

  it("cuts people by the window; deals follow any arrival", () => {
    const r = rowsOf({
      arrivals: [at("a", "prep", "2026-10-01"), at("b", "book", "2026-11-01")],
      deals: [{ journey: "a" }],
      from: "2026-10-20",
    });
    expect(r.spring).toMatchObject({ people: 1, converted: 1, deals: 1 });
  });

  it("counts a journey a new version carried for its deals, not as a person in", () => {
    const r = rowsOf({
      arrivals: [{ ...at("a", "book"), carried: true }],
      deals: [{ journey: "a" }],
    });
    expect(r.spring).toMatchObject({ people: 0, converted: 0, deals: 1 });
  });

  it("counts open journeys at its stations", () => {
    const r = rowsOf({
      open: [
        { version: 2, node: "held" },
        { version: 2, node: "reply" },
      ],
    });
    expect(r.spring?.now).toBe(1);
    expect(r.late?.now).toBe(1);
    expect(r.default?.now).toBe(1);
  });

  it("reads each arrival on its own version; a campaign gone since stays as a row", () => {
    const old = body();
    const late = old.groups.find((g) => g.id === "late");
    if (late) late.id = "autumn";
    const newest = body();
    newest.groups = newest.groups.filter((g) => g.id !== "late");
    const r = rowsOf({
      newest,
      bodies: new Map([[1, old]]),
      arrivals: [at("a", "held", "2026-11-01", 1)],
    });
    expect(r.autumn).toMatchObject({ people: 1, gone: true, status: "ended" });
    expect(r.spring?.people).toBe(1);
  });

  it("counts acts by stamp, a child's in its parent; no stamp is the default", () => {
    const r = rowsOf({
      acts: [
        { campaign: "late", act: "email.opener", n: 2 },
        { campaign: "spring", act: "email.opener", n: 1 },
        { campaign: "spring", act: "linkedin.invite", n: 4 },
        { campaign: null, act: "email.opener", n: 7 },
        { campaign: "autumn", act: "x.comment", n: 3 },
      ],
    });
    expect(r.late?.acts).toEqual({ "email.opener": 2 });
    expect(r.spring?.acts).toEqual({ "email.opener": 3, "linkedin.invite": 4 });
    expect(r.default?.acts).toEqual({ "email.opener": 7 });
    expect(r.autumn).toMatchObject({ gone: true, people: 0, acts: { "x.comment": 3 } });
  });

  it("puts every arrival on a graph version in the default", () => {
    const r = rowsOf({ newest: null, bodies: new Map(), arrivals: [at("a", "book")] });
    expect(Object.keys(r)).toEqual(["default"]);
    expect(r.default?.people).toBe(1);
  });
});
