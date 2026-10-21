import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ path: string; args: Record<string, unknown> }> = [];

vi.mock("../api.js", () => ({
  call: async (path: string, args: Record<string, unknown>) => {
    calls.push({ path, args });
    if (path === "pipeline/recordsGet")
      return { detail: { body: { name: "Sample", nodes: [], edges: [] }, metro: null } };
    const where = args.where as { kind?: string } | undefined;
    const row = (node: string, more: Record<string, unknown>) => ({
      id: `x:${node}`,
      node,
      ...more,
    });
    const rows =
      where?.kind === "station"
        ? [row("hub", { now: 42 }), row("engaged", { now: 5, medianDays: 4 })]
        : where?.kind === "track"
          ? [row("engaged_to_booked", { crossings: 9 })]
          : where?.kind === "line"
            ? [
                row("starter", { deals: 1, collected: { amount: 100, currency: "CAD" } }),
                row("starter", { deals: 2, collected: { amount: 50, currency: "USD" } }),
              ]
            : [];
    return { rows, next: null, total: rows.length };
  },
}));

import { lineSays, type MapData, stationSays, windowOf, windowSays } from "./model.js";
import { readMap } from "./read.js";

describe("windowOf", () => {
  it("takes the address's window, 30 days when it names none or an unknown one", () => {
    expect(windowOf("7")).toBe("7");
    expect(windowOf("all")).toBe("all");
    expect(windowOf(null)).toBe("30");
    expect(windowOf("365")).toBe("30");
    expect(windowSays("30")).toBe("in the last 30 days");
    expect(windowSays("all")).toBe("in all time");
  });
});

describe("readMap", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("asks numbers of kind station, track and line, never node or edge", async () => {
    const { map } = await readMap("c1", "30");
    const kinds = calls
      .filter((c) => (c.args.record as string) === "pipeline.number")
      .map((c) => (c.args.where as { kind: string }).kind)
      .sort();
    expect(kinds).toEqual(["line", "station", "track"]);
    expect(map?.stations.get("hub")?.now).toBe(42);
    expect(map?.stations.get("engaged")?.medianDays).toBe(4);
    expect(map?.tracks.get("engaged_to_booked")).toBe(9);
  });

  it("keeps one line row for each currency", async () => {
    const { map } = await readMap("c1", "30");
    expect(map?.lines.get("starter")?.map((r) => r.collected?.currency)).toEqual(["CAD", "USD"]);
  });

  it("sends no shape body", async () => {
    await readMap("c1", "30");
    expect(calls.every((c) => !("body" in c.args))).toBe(true);
  });
});

const none = { opened: null, deals: null, collected: null, scheduled: null };
const station = (
  id: string,
  over: Partial<MapData["stations"] extends Map<string, infer V> ? V : never>,
) => ({
  id,
  now: null,
  arrived: null,
  left: null,
  medianDays: null,
  ...none,
  ...over,
});

describe("stationSays", () => {
  it("says a station's four numbers", () => {
    expect(
      stationSays("att", station("engaged", { now: 5, arrived: 14, left: 9, medianDays: 4.25 })),
    ).toEqual(["Now: 5", "Arrived: 14", "Left: 9", "Median days there: 4.3"]);
  });

  it("says a cash station's money", () => {
    expect(
      stationSays(
        "cash",
        station("pay", {
          now: 3,
          collected: { amount: 1_800, currency: "CAD" },
          scheduled: { amount: 3_000, currency: "CAD" },
        }),
      ),
    ).toEqual(["Now: 3", "Deals: 0", "Scheduled: CA$3,000", "Collected: CA$1,800"]);
  });

  it("says the hub's leads", () => {
    expect(stationSays("hub", station("hub", { now: 42 }))).toEqual(["Leads: 42"]);
  });

  it("says nothing is known for a station with no row", () => {
    expect(stationSays("att", undefined)).toEqual(["No numbers yet."]);
  });
});

describe("lineSays", () => {
  it("says opened for an out line and money for each currency of an offer line", () => {
    expect(lineSays([station("mail", { opened: 11, deals: 2 })])).toEqual([
      "Opened: 11",
      "Deals: 2",
    ]);
    expect(
      lineSays([
        station("starter", { deals: 1, collected: { amount: 100, currency: "CAD" } }),
        station("starter", { deals: 2, collected: { amount: 50, currency: "USD" } }),
      ]),
    ).toEqual([
      "Deals: 1",
      "Collected: CA$100",
      "Scheduled: none",
      "Deals: 2",
      "Collected: $50",
      "Scheduled: none",
    ]);
    expect(lineSays(undefined)).toEqual(["No numbers yet."]);
  });
});
