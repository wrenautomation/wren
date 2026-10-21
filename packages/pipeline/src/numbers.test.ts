import { describe, expect, it } from "vitest";
import { shape } from "../test/fixtures.js";
import { metroOf } from "./convert.js";
import type { MetroBody } from "./metro.js";
import { metroRowsOf, type NumberRow, type OfferNumber } from "./numbers.js";

const metro = (): MetroBody => {
  const r = metroOf(shape());
  if (!r.ok) throw new Error(r.errors.join(" "));
  return r.body;
};

const empty = {
  nodeKind: null,
  arrived: null,
  skipped: null,
  left: null,
  now: null,
  medianDays: null,
  crossings: null,
  from: null,
  to: null,
  opened: null,
  deals: null,
  collected: null,
  scheduled: null,
  cost: null,
  currency: null,
  last: null,
} as const;

/** The rows of the graph the fixture shape is: a source, a step and an edge each have numbers. */
const graphRows = (): NumberRow[] => [
  {
    ...empty,
    id: "node:yt",
    kind: "node",
    label: "yt",
    name: "YouTube",
    position: 0,
    nodeKind: "source",
    opened: 9,
    deals: 2,
    collected: 40,
    last: "2027-01-05",
  },
  {
    ...empty,
    id: "node:mail",
    kind: "node",
    label: "mail",
    name: "Email",
    position: 0,
    nodeKind: "source",
    opened: 4,
    deals: 1,
    collected: 10,
    last: "2027-01-07",
  },
  {
    ...empty,
    id: "node:engaged",
    kind: "node",
    label: "engaged",
    name: "Engaged",
    position: 1,
    nodeKind: "step",
    arrived: 12,
    skipped: 0,
    left: 7,
    now: 5,
    medianDays: 2,
  },
  {
    ...empty,
    id: "edge:yt_to_engaged",
    kind: "edge",
    label: "yt_to_engaged",
    name: "YouTube to Engaged",
    position: 0,
    crossings: 8,
    from: "yt",
    to: "engaged",
    last: "2027-01-05",
  },
  {
    ...empty,
    id: "edge:mail_to_engaged",
    kind: "edge",
    label: "mail_to_engaged",
    name: "Email to Engaged",
    position: 0,
    crossings: 3,
    from: "mail",
    to: "engaged",
    last: "2027-01-07",
  },
  {
    ...empty,
    id: "edge:engaged_to_booked",
    kind: "edge",
    label: "engaged_to_booked",
    name: "Engaged to Booked",
    position: 0,
    crossings: 6,
    from: "engaged",
    to: "booked",
    last: "2027-01-06",
  },
];

const offers: OfferNumber[] = [
  {
    offer: "offer-a",
    currency: "USD",
    deals: 3,
    signed: 2,
    collectedCents: 5000,
    scheduledCents: 12_000,
  },
];

const by = (rows: NumberRow[], id: string) => rows.find((r) => r.id === id);

describe("metroRowsOf", () => {
  it("answers per line, station and track, lines first", () => {
    const rows = metroRowsOf(metro(), graphRows(), offers);
    const kinds = rows.map((r) => r.kind);
    expect(kinds.indexOf("line")).toBe(0);
    expect(kinds.lastIndexOf("line")).toBeLessThan(kinds.indexOf("station"));
    expect(kinds.lastIndexOf("station")).toBeLessThan(kinds.indexOf("track"));
    expect(kinds).not.toContain("node");
    expect(kinds).not.toContain("edge");
  });

  it("gives an out line its source's numbers", () => {
    const line = by(metroRowsOf(metro(), graphRows(), offers), "line:yt");
    expect(line).toMatchObject({
      kind: "line",
      label: "yt",
      name: "YouTube",
      opened: 9,
      deals: 2,
      collected: 40,
    });
  });

  it("gives an offer line its offer's numbers, one row for each currency", () => {
    const line = by(metroRowsOf(metro(), graphRows(), offers), "line:signed:USD");
    expect(line).toMatchObject({
      kind: "line",
      label: "signed",
      deals: 3,
      collected: 50,
      scheduled: 120,
      currency: "USD",
    });
  });

  it("never adds two currencies: a row each, as the graph's offer rows", () => {
    const eur: OfferNumber = {
      offer: "offer-a",
      currency: "EUR",
      deals: 1,
      signed: 1,
      collectedCents: 700,
      scheduledCents: 900,
    };
    const rows = metroRowsOf(metro(), graphRows(), [...offers, eur]);
    const mine = rows.filter((r) => r.kind === "line" && r.label === "signed");
    expect(mine.map((r) => r.id)).toEqual(["line:signed:USD", "line:signed:EUR"]);
    expect(by(rows, "line:signed:USD")).toMatchObject({ deals: 3, collected: 50, currency: "USD" });
    expect(by(rows, "line:signed:EUR")).toMatchObject({ deals: 1, collected: 7, currency: "EUR" });
    expect(by(rows, "line:signed")).toBeUndefined();
  });

  it("gives an offer line with no deals one row of zeros and no currency", () => {
    const line = by(metroRowsOf(metro(), graphRows(), []), "line:signed");
    expect(line).toMatchObject({
      kind: "line",
      deals: 0,
      collected: 0,
      scheduled: 0,
      currency: null,
    });
  });

  it("gives a station its node's numbers, under the station's label", () => {
    const station = by(metroRowsOf(metro(), graphRows(), offers), "station:engaged");
    expect(station).toMatchObject({
      kind: "station",
      label: "engaged",
      name: "Engaged",
      arrived: 12,
      left: 7,
      now: 5,
    });
  });

  it("gives a plain track its edge's crossings", () => {
    const track = by(metroRowsOf(metro(), graphRows(), offers), "track:engaged_to_booked");
    expect(track).toMatchObject({ kind: "track", crossings: 6, from: "engaged", to: "booked" });
  });

  it("sums the source edges for a hub track, and reads a track into the hub as its source's edges", () => {
    const rows = metroRowsOf(metro(), graphRows(), offers);
    expect(by(rows, "track:hub_to_engaged")).toMatchObject({ crossings: 11, last: "2027-01-07" });
    expect(by(rows, "track:yt_to_hub")).toMatchObject({ crossings: 8 });
    expect(by(rows, "track:mail_to_hub")).toMatchObject({ crossings: 3 });
  });

  it("sums only the out lines a hub track names", () => {
    const m = metro();
    const only: MetroBody = {
      ...m,
      tracks: m.tracks.map((t) => (t.id === "hub_to_engaged" ? { ...t, entries: ["mail"] } : t)),
    };
    expect(by(metroRowsOf(only, graphRows(), offers), "track:hub_to_engaged")?.crossings).toBe(3);
  });

  it("keeps only one out line, its station and the offer lines for a source filter", () => {
    const rows = metroRowsOf(
      metro(),
      graphRows().filter((r) => r.id === "node:yt"),
      offers,
      { source: "yt" },
    );
    expect(rows.filter((r) => r.kind === "track")).toEqual([]);
    expect(rows.filter((r) => r.kind === "line" && r.label !== "signed")).toHaveLength(1);
    expect(by(rows, "line:yt")).toBeDefined();
    expect(by(rows, "line:mail")).toBeUndefined();
    expect(by(rows, "station:yt")).toBeDefined();
  });

  it("adds the hub row with the lead count, and leaves it out for a source filter", () => {
    const rows = metroRowsOf(metro(), graphRows(), offers, {}, 7);
    expect(by(rows, "station:hub")).toMatchObject({
      kind: "station",
      label: "hub",
      nodeKind: "hub",
      now: 7,
      arrived: null,
      crossings: null,
    });
    expect(by(rows, "station:hub")?.name).toBe(metro().stations.find((s) => s.id === "hub")?.label);
    expect(by(metroRowsOf(metro(), graphRows(), offers, {}), "station:hub")?.now).toBeNull();
    expect(by(metroRowsOf(metro(), graphRows(), offers, { source: "yt" }, 7), "station:hub")).toBe(
      undefined,
    );
  });
});
