import { describe, expect, it } from "vitest";
import type { InsightRow } from "./ads.js";
import { formatLaunches, formatVerdicts, judge, resultOf } from "./launches.js";
import type { AdLaunch } from "./schema.js";

const launch = (over: Partial<AdLaunch> = {}): AdLaunch => ({
  id: "l1",
  createdAt: new Date("2026-09-20T00:00:00Z"),
  name: "founders",
  adAccountId: "1",
  campaignId: "c1",
  adsetId: "s1",
  creativeId: "cr1",
  adId: "a1",
  spec: {} as AdLaunch["spec"],
  status: "active",
  dailyBudgetUsd: 10,
  startedAt: new Date("2026-09-20T01:00:00Z"),
  stoppedAt: null,
  stopReason: null,
  ...over,
});

describe("resultOf", () => {
  it("sums every action and reads numbers off the wire strings", () => {
    const row: InsightRow = {
      adset_id: "s1",
      campaign_id: "c1",
      spend: "12.50",
      clicks: "3",
      actions: [
        { action_type: "link_click", value: "3" },
        { action_type: "lead", value: "1" },
      ],
    };
    expect(resultOf(row)).toEqual({
      adsetId: "s1",
      campaignId: "c1",
      spendUsd: 12.5,
      clicks: 3,
      results: 4,
    });
    expect(resultOf({ campaign_id: "c1", spend: "1" })).toBeNull();
  });
});

describe("judge", () => {
  const rows: InsightRow[] = [
    { adset_id: "s1", spend: "60.00", clicks: "0" },
    { adset_id: "s2", spend: "80.00", clicks: "1" },
    { adset_id: "s3", spend: "20.00", clicks: "0" },
  ];
  const launches = [
    launch(),
    launch({ id: "l2", campaignId: "c2", adsetId: "s2", name: "agencies" }),
    launch({ id: "l3", campaignId: "c3", adsetId: "s3", name: "young" }),
    launch({ id: "l4", campaignId: "c4", adsetId: "s4", name: "undelivered" }),
  ];

  it("pauses only the one over the guard with nothing to show", () => {
    const vs = judge(launches, rows, { pauseAfterUsd: 50 });
    expect(vs.map((v) => [v.launch.name, v.pause !== null])).toEqual([
      ["founders", true],
      ["agencies", false],
      ["young", false],
    ]);
    expect(vs[0]?.pause).toBe("spent $60.00 with no clicks or results (guard $50)");
  });

  it("a result with no click still keeps it on", () => {
    const vs = judge(
      [launch()],
      [
        {
          adset_id: "s1",
          spend: "99",
          clicks: "0",
          actions: [{ action_type: "lead", value: "1" }],
        },
      ],
      { pauseAfterUsd: 50 },
    );
    expect(vs[0]?.pause).toBeNull();
  });

  it("formats verdicts and launches", () => {
    const vs = judge(launches, rows, { pauseAfterUsd: 50 });
    expect(formatVerdicts(vs)[0]).toBe(
      "founders: $60.00 spent, 0 clicks, 0 results → PAUSED (spent $60.00 with no clicks or results (guard $50))",
    );
    expect(formatVerdicts([])).toEqual(["no active launches delivered"]);
    expect(formatLaunches([launch({ status: "stopped", stopReason: "by hand" })])[0]).toBe(
      "c1  stopped  $10.00/day  started 2026-09-20 01:00  stopped -  founders  (by hand)",
    );
    expect(formatLaunches([])).toEqual(["no launches"]);
  });
});
