import { TRIGGER_IDS } from "@wren/core/logic";
import { describe, expect, it } from "vitest";
import { ctx } from "../test/fixtures.js";
import { checkShape, depthOf, holds, isSource } from "./model.js";
import { STARTER_NOTE, starterShape } from "./starter.js";

describe("starterShape", () => {
  it("parses and passes checkShape with the real trigger list", () => {
    const { body } = starterShape();
    expect(checkShape(body, ctx({ triggers: TRIGGER_IDS }))).toEqual([]);
  });

  it("holds kinds only: no account, channel, list, group, campaign, amount or terms", () => {
    const file = starterShape();
    expect(file.terms).toBeUndefined();
    expect(file.moves).toBeUndefined();
    for (const n of file.body.nodes) {
      if (isSource(n))
        expect([n.channel, n.campaign, n.source, n.group, n.parked]).toEqual([
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
        ]);
    }
    expect(JSON.stringify(file)).not.toMatch(/\d/);
  });

  it("has a source, steps, an offer and a plan, with the plan under the offer", () => {
    const { body } = starterShape();
    expect(body.nodes.map((n) => n.name)).toEqual(
      expect.arrayContaining(["Source", "Comment", "Booked call", "Offer", "Plan"]),
    );
    expect(new Set(body.nodes.map((n) => n.kind))).toEqual(
      new Set(["source", "step", "offer", "plan"]),
    );
    const depth = depthOf(body);
    expect(depth.source).toBe(0);
    expect(depth.plan).toBe(Math.max(...Object.values(depth)));
    expect(body.nodes.filter(holds).length).toBe(body.nodes.length - 2);
  });

  it("gives a fresh copy each call", () => {
    const a = starterShape();
    a.body.name = "Changed";
    expect(starterShape().body.name).not.toBe("Changed");
    expect(STARTER_NOTE).toBe("Starter");
  });
});
