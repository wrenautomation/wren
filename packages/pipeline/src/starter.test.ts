import { TRIGGER_IDS } from "@wren/core/logic";
import { describe, expect, it } from "vitest";
import { ctx } from "../test/fixtures.js";
import { graphOf } from "./convert.js";
import { depthOf, holds } from "./model.js";
import { STARTER_NOTE, starterShape } from "./starter.js";
import { checkStored, runOf } from "./stored.js";

describe("starterShape", () => {
  it("is a metro body that passes checkStored with the real trigger list", () => {
    const { body } = starterShape();
    expect(body.model).toBe("metro");
    expect(checkStored(body, ctx({ triggers: TRIGGER_IDS }))).toEqual([]);
  });

  it("holds kinds only: no account, channel, list, group, campaign, amount or terms", () => {
    const file = starterShape();
    expect(file.terms).toBeUndefined();
    expect(file.moves).toBeUndefined();
    for (const l of file.body.lines) {
      expect([
        l.entry?.channel,
        l.entry?.campaign,
        l.entry?.source,
        l.entry?.segment,
        l.entry?.parked,
      ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    }
    // The only number is a line colour.
    expect(JSON.stringify(file).replace(/"colour":\d+/g, "")).not.toMatch(/\d/);
  });

  it("keeps the ids of the first starter graph: sources, steps, offer and plan", () => {
    const run = runOf(starterShape().body);
    expect(run.nodes.map((n) => n.id)).toEqual([
      "source",
      "outbound",
      "comment",
      "reply",
      "booked_call",
      "offer",
      "plan",
    ]);
    expect(run.edges.map((e) => e.id)).toEqual([
      "source_to_comment",
      "outbound_to_reply",
      "comment_to_reply",
      "reply_to_booked_call",
      "booked_call_to_offer",
      "offer_to_plan",
    ]);
  });

  it("has a source, steps, an offer and a plan, with the plan under the offer", () => {
    const run = runOf(starterShape().body);
    expect(new Set(run.nodes.map((n) => n.kind))).toEqual(
      new Set(["source", "step", "offer", "plan"]),
    );
    const depth = depthOf(run);
    expect(depth.source).toBe(0);
    expect(depth.plan).toBe(Math.max(...Object.values(depth)));
    expect(run.nodes.filter(holds).length).toBe(run.nodes.length - 2);
    expect(graphOf(starterShape().body)).toEqual(run);
  });

  it("gives a fresh copy each call", () => {
    const a = starterShape();
    a.body.name = "Changed";
    expect(starterShape().body.name).not.toBe("Changed");
    expect(STARTER_NOTE).toBe("Starter");
  });
});
