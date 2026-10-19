import type { SpineEvent } from "@wren/core/spine";
import { describe, expect, it } from "vitest";
import { entryOf } from "./entry.js";
import type { FunnelBody } from "./model.js";
import { causeOf, factsOf } from "./steps.js";

const NOW = new Date("2026-10-19T10:00:00Z");

/** What the segments pass fires when a person enters group 7. */
const entered: SpineEvent = {
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
    const body: FunnelBody = {
      name: "Test",
      offer: "offer-a",
      stages: [{ key: "engaged", label: "Engaged", sale: true, on: [] }],
      entries: [
        { id: "mail", kind: "outbound", channel: "email" },
        { id: "warm", kind: "group", group: "7" },
      ],
    };
    expect(entryOf(body, factsOf(entered.data)).id).toBe("warm");
    expect(entryOf(body, factsOf({ ...entered.data, segment: 8 })).id).toBe("manual");
  });
});
