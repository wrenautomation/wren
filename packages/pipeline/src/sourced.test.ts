import { triggerHears } from "@wren/core/logic";
import type { SpineEvent } from "@wren/core/spine";
import { describe, expect, it } from "vitest";
import { flow } from "../test/fixtures.js";
import { entryOf } from "./entry.js";
import type { ShapeBody } from "./model.js";
import { causeOf, factsOf } from "./steps.js";

const NOW = new Date("2026-10-19T10:00:00Z");

/** What the sourced feed fires when person 42 is added to list 12. */
const added: SpineEvent = {
  subject: "source:import:12:42",
  kind: "lead",
  data: {
    profile: 9,
    row: "42",
    source: "import:12",
    cause: { kind: "sourced", ref: "import:12", at: NOW.toISOString() },
  },
};

const body: ShapeBody = {
  name: "Test",
  nodes: [
    { id: "mail", kind: "source", name: "Email", via: "outbound", channel: "email" },
    { id: "list", kind: "source", name: "List", via: "sourced", source: "import:12" },
    { id: "engaged", kind: "offer", name: "Engaged", offer: "offer-a", advance: [] },
  ],
  edges: [flow("mail", "engaged"), flow("list", "engaged")],
};

describe("a person added to a sourced list", () => {
  it("is a sourced cause with the list as proof", () => {
    expect(causeOf(added, NOW)).toEqual({
      kind: "sourced",
      ref: "import:12",
      at: NOW.toISOString(),
    });
  });

  it("names the list, so the sourced entry opens the journey", () => {
    expect(factsOf(added.data)).toEqual({ source: "import:12" });
    expect(entryOf(body, factsOf(added.data))?.id).toBe("list");
    expect(entryOf(body, factsOf({ ...added.data, source: "import:13" }))).toBeNull();
  });

  it("is heard by the source trigger of that list only", () => {
    const node = { id: "e_1", uses: "trigger.source", with: { source: "import:12" } };
    expect(triggerHears(node, { trigger: "trigger.source", source: "import:12" })).toBe(true);
    expect(triggerHears(node, { trigger: "trigger.source", source: "import:13" })).toBe(false);
  });
});
