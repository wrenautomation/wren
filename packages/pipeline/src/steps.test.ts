import type { ExecutorEvent } from "@wren/core/executor";
import { describe, expect, it } from "vitest";
import { flow } from "../test/fixtures.js";
import { entryOf } from "./entry.js";
import type { ShapeBody } from "./model.js";
import { causeOf, factsOf } from "./steps.js";

const NOW = new Date("2026-10-19T10:00:00Z");

/** What the segments pass fires when a person enters group 7. */
const entered: ExecutorEvent = {
  subject: "profile:12",
  kind: "lead",
  data: { profile: 12, segment: 7, segment_name: "Warm", change: "entered" },
};

describe("a person entering a group", () => {
  it("is a group cause with the group as proof", () => {
    expect(causeOf(entered, NOW)).toEqual({ kind: "group", ref: "7", at: NOW.toISOString() });
    // Leaving a group is not the cause of anything.
    const left = { ...entered, data: { ...entered.data, change: "left" } };
    expect(causeOf(left, NOW).kind).toBe("touch");
  });

  it("names the group, so the group entry opens the journey", () => {
    expect(factsOf(entered.data)).toEqual({ group: "7" });
    const body: ShapeBody = {
      name: "Test",
      nodes: [
        { id: "mail", kind: "source", name: "Email", via: "outbound", channel: "email" },
        { id: "warm", kind: "source", name: "Warm", via: "group", group: "7" },
        { id: "engaged", kind: "offer", name: "Engaged", offer: "offer-a", advance: [] },
      ],
      edges: [flow("mail", "engaged"), flow("warm", "engaged")],
    };
    expect(entryOf(body, factsOf(entered.data))?.id).toBe("warm");
    // No source claims group 8, and the shape has no manual source: the caller records `manual`.
    expect(entryOf(body, factsOf({ ...entered.data, segment: 8 }))).toBeNull();
  });
});
