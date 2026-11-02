import { checkWorkflows } from "@wren/core/workflows";
import { describe, expect, it } from "vitest";
import { ctx, metroShape } from "../test/fixtures.js";
import { gateWhy, graphOf, wireWait } from "./convert.js";
import type { MetroBody, MetroStation, MetroTrack } from "./metro.js";
import { checkShape } from "./model.js";
import { shapeWorkflow } from "./workflow.js";

const at = (id: string, more: Partial<MetroStation> = {}): MetroStation => ({
  id,
  label: id,
  kind: "att",
  line: "growth",
  column: "sales",
  action: "email",
  advance: [{ trigger: "trigger.reply" }],
  ...more,
});
const track = (from: string, to: string, more: Partial<MetroTrack> = {}): MetroTrack => ({
  id: `${from}_to_${to}`,
  from,
  to,
  line: "growth",
  by: "system",
  ...more,
});

/** Cold line into `sent`; a race: a reply wins, else `follow` after 3d; `won` splits to join all. */
const logic = (): MetroBody => ({
  model: "metro",
  name: "Logic",
  lines: [
    { id: "cold", label: "Cold", tier: "out", entry: { via: "outbound", channel: "email" } },
    { id: "growth", label: "Growth", tier: "core", offer: "offer-a", colour: 0 },
  ],
  stations: [
    { id: "cold", label: "Cold", kind: "att", line: "cold", column: "marketing" },
    { id: "hub", label: "First touch", kind: "hub", column: "marketing" },
    at("sent", { advance: [] }),
    at("race", { kind: "race" }),
    at("replied"),
    at("follow", { advance: [] }),
    at("won", { advance: [{ trigger: "trigger.booking", with: { on: "booked" } }] }),
    at("fork", { kind: "split" }),
    at("signed"),
    at("paid", { advance: [{ trigger: "trigger.booking", with: { on: "booked" } }] }),
    at("both", { kind: "join", rule: "all" }),
    at("kickoff"),
  ],
  tracks: [
    track("hub", "sent", { entries: ["cold"] }),
    track("sent", "race"),
    track("race", "replied", { cond: "a reply" }),
    track("race", "follow", { wait: "3d" }),
    track("replied", "won"),
    track("won", "fork"),
    track("fork", "signed"),
    track("fork", "paid"),
    track("signed", "both"),
    track("paid", "both"),
    track("both", "kickoff"),
  ],
  groups: [],
  frames: [],
});

describe("gates in the graph", () => {
  it("leaves a body with no split, join or race as it was", () => {
    const b = metroShape();
    const logic = new Set(["wait", "fork", "merge"]);
    b.stations = b.stations.filter((s) => !logic.has(s.id));
    b.tracks = b.tracks.filter((t) => !logic.has(t.from) && !logic.has(t.to));
    const g = graphOf(b);
    expect(g.gates).toBeUndefined();
    expect(g.campaigns).toBeUndefined();
    expect(g.edges.some((e) => e.cond !== undefined || e.wait !== undefined)).toBe(false);
  });

  it("lowers split, join and race to gates, their tracks to edges", () => {
    const g = graphOf(logic());
    expect(g.gates).toEqual([
      { id: "race", kind: "race" },
      { id: "fork", kind: "split" },
      { id: "both", kind: "join", rule: "all" },
    ]);
    expect(g.nodes.map((n) => n.id)).not.toContain("race");
    expect(g.edges.find((e) => e.id === "race_to_follow")).toMatchObject({ wait: "3 days" });
    expect(g.edges.find((e) => e.id === "race_to_replied")).toMatchObject({ cond: "a reply" });
    expect(checkShape(g, ctx())).toEqual([]);
  });

  it("names the campaign of each station not in the default", () => {
    const b = logic();
    b.groups.push({
      id: "spring",
      label: "Spring",
      line: "growth",
      stations: ["sent", "race", "replied"],
      campaign: {},
    });
    expect(graphOf(b).campaigns).toEqual({ sent: "spring", race: "spring", replied: "spring" });
  });

  it("wires the race clock from the station before it, held by the wait", () => {
    const w = shapeWorkflow(1, graphOf(logic()), "wren");
    expect(w.wires).toContainEqual({
      from: "m_sent.armed",
      to: "m_follow.journey",
      via: "events",
      wait: "3 days",
    });
    expect(w.nodes.find((n) => n.id === "m_sent")?.own?.out.map((p) => p.id)).toEqual([
      "moved",
      "armed",
    ]);
    expect(w.nodes.find((n) => n.id === "m_replied")?.own?.out.map((p) => p.id)).toEqual(["moved"]);
    expect(checkWorkflows([w], [])).toEqual([]);
  });

  it("reads 1d, 4h and 30m as wire waits", () => {
    expect([wireWait("1d"), wireWait("4h"), wireWait("30m")]).toEqual([
      "1 day",
      "4 hours",
      "30 minutes",
    ]);
  });
});

describe("gateWhy", () => {
  const why = (b: MetroBody, id: string) => {
    const s = b.stations.find((x) => x.id === id);
    return s ? gateWhy(b, s) : [];
  };

  it("passes the logic body", () => {
    const b = logic();
    expect(["race", "fork", "both"].flatMap((id) => why(b, id))).toEqual([]);
  });

  it("refuses a second track out of the station before a gate, logic to logic, an arm with no trigger", () => {
    const b = logic();
    b.tracks.push(track("sent", "won"), track("fork", "both"));
    const replied = b.stations.find((s) => s.id === "replied");
    if (replied) replied.advance = [];
    expect(why(b, "race")).toEqual([
      'Station "sent" leads into "race", so it may have no other track out.',
      'Arm "race_to_replied" of race "race" leads to "replied", which has no trigger to win it.',
    ]);
    expect(why(b, "fork")).toContain('Track "fork_to_both" runs logic station to logic station.');
  });

  it("refuses a hub track into a gate and a join with two tracks out", () => {
    const b = logic();
    b.tracks.push(track("hub", "fork"), track("both", "follow"));
    expect(why(b, "fork")).toEqual([
      'Track "hub_to_fork" joins the hub to a logic station.',
      'Split "fork" needs one track in, not 2.',
      'Station "hub" leads into "fork", so it may have no other track out.',
    ]);
    expect(why(b, "both")).toEqual(['Join "both" needs one track out, not 2.']);
  });
});
