import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANALYTICS_CATALOG,
  CATALOG_TABLES,
  catalogCounts,
  entriesFor,
  formatOf,
  NEEDS,
  stateLine,
} from "./catalog.js";
import { stateOf } from "./records.js";

const DOC = new URL("../../../../designs/2026-10-07-content-analytics.md", import.meta.url);

/** The doc's Counts table, row by row: label, then Live, Waiting, Needs scope, Needs William, Not built, No API. */
function docCounts(): Map<string, number[]> {
  const text = readFileSync(DOC, "utf8");
  const at = text.indexOf("| Platform | Live |");
  const rows = text.slice(at).split("\n").slice(2);
  const out = new Map<string, number[]>();
  for (const line of rows) {
    if (!line.startsWith("|")) break;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    out.set(cells[0] ?? "", cells.slice(1).map(Number));
  }
  return out;
}

describe("analytics catalog", () => {
  it("the design doc's counts are the catalog's", () => {
    const doc = docCounts();
    for (const c of catalogCounts()) {
      if (c.label === "Every platform") continue;
      expect([c.label, doc.get(c.label)]).toEqual([
        c.label,
        [c.live, c.waiting, c.needs_scope, c.needs_william, c.not_built, c.no_api],
      ]);
    }
    expect(doc.size).toBe(CATALOG_TABLES.length - 1);
  });

  it("every gap that needs a step names it", () => {
    for (const e of ANALYTICS_CATALOG)
      if (e.state === "needs_scope" || e.state === "needs_william")
        expect(e.needs?.step, e.label).toBeTruthy();
  });

  it("a Short reads as long-form plus its own rows; a long video leaves those out", () => {
    const short = entriesFor("youtube", "short").map((e) => e.label);
    expect(short).toContain("Engaged views");
    expect(short).toContain("Traffic sources");
    expect(short).toContain("Comment reply rate and time to reply");
    expect(entriesFor("youtube", "long").map((e) => e.label)).not.toContain("Engaged views");
  });

  it("formats and the words a state says", () => {
    expect(formatOf("youtube", "short")).toBe("short");
    expect(formatOf("youtube", "video")).toBe("long");
    expect(formatOf("instagram", "video")).toBe("reel");
    expect(formatOf("linkedin", "document")).toBe("carousel");
    expect(formatOf("x", "thread")).toBe("thread");
    expect(stateLine("needs_scope", { name: "YouTube Analytics", step: "x" })).toBe(
      "Needs scope: YouTube Analytics",
    );
    expect(stateLine("not_built")).toBe("In development");
    expect(stateLine("waiting", NEEDS.youtubeReach, "first report in 2 days")).toBe(
      "Waiting: first report in 2 days",
    );
  });

  it("a row's state: live when any number came back, waiting over its catalog word", () => {
    const at = "2026-10-07T00:00:00Z";
    const entry = (label: string) => {
      const e = ANALYTICS_CATALOG.find((x) => x.platform === "youtube" && x.label === label);
      if (!e) throw new Error(label);
      return e;
    };
    const src = (metric: string, state: string, why: string | null = null) =>
      [`youtube|${metric}`, { platform: "youtube", metric, state, why, checked_at: at }] as const;
    const reach = entry("Impressions and CTR");
    expect(stateOf(reach, new Map()).state).toBe("needs_scope");
    expect(stateOf(reach, new Map([src("impressions", "waiting", "soon")]))).toMatchObject({
      state: "waiting",
      why: "soon",
    });
    // A refusal of a row that was never live keeps its step.
    expect(stateOf(reach, new Map([src("impressions", "not_built", "404")])).state).toBe(
      "needs_scope",
    );
    expect(stateOf(reach, new Map([src("ctr", "live")])).state).toBe("live");
    // The channel's days read the account's sources, not a post's.
    const days = entry("Channel views and subscribers per day");
    expect(stateOf(days, new Map([src("views", "live")])).state).toBe("needs_scope");
    expect(stateOf(days, new Map([src("account.views", "live")])).state).toBe("live");
  });

  it("a built row waits for its first number, shows a refusal, and goes live on a number", () => {
    const watch = ANALYTICS_CATALOG.find(
      (e) => e.platform === "x" && e.label === "Video views and playback quartiles",
    );
    if (!watch) throw new Error("x watch row");
    expect(watch.state).toBe("waiting");
    const src = (metric: string, state: string, why: string | null = null) =>
      [`x|${metric}`, { platform: "x", metric, state, why, checked_at: "2026-10-09" }] as const;
    expect(stateOf(watch, new Map())).toMatchObject({
      state: "waiting",
      why: "built, no number yet",
    });
    expect(stateOf(watch, new Map([src("video_views", "no_api", "browser leg")]))).toMatchObject({
      state: "no_api",
      why: "browser leg",
    });
    expect(stateOf(watch, new Map([src("playback", "live")])).state).toBe("live");
    const followers = ANALYTICS_CATALOG.find((e) => e.platform === "x" && e.group === "account");
    if (!followers) throw new Error("x followers row");
    expect(stateOf(followers, new Map([src("account.followers", "live")])).state).toBe("live");
  });
});
