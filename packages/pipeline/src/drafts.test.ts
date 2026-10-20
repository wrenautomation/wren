import { describe, expect, it } from "vitest";
import { draftIdOf } from "./drafts.js";
import { Refused } from "./store.js";

describe("draftIdOf", () => {
  it("makes a short slug from the name", () => {
    expect(draftIdOf("Add a Referral Source")).toBe("add-a-referral-source");
    expect(draftIdOf("  Tidy: the   booking step!  ")).toBe("tidy-the-booking-step");
    expect(draftIdOf("Ada's plan")).toBe("adas-plan");
    expect(draftIdOf("Café menu")).toBe("cafe-menu");
  });

  it("starts with a letter, so two numbered names stay two ids", () => {
    expect(draftIdOf("2027 plan")).toBe("d-2027-plan");
    expect(draftIdOf("2028 plan")).toBe("d-2028-plan");
    expect(draftIdOf("7")).toBe("d-7");
  });

  it("holds at most 40 characters and never ends on a dash", () => {
    const id = draftIdOf("a very long name that goes on and on and on and on forever");
    expect(id.length).toBeLessThanOrEqual(40);
    expect(id.endsWith("-")).toBe(false);
    expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(draftIdOf(`${"x".repeat(39)} tail`)).toBe("x".repeat(39));
  });

  it("refuses a name with nothing to keep", () => {
    for (const name of ["", "   ", "!!!", "—"]) {
      expect(() => draftIdOf(name)).toThrow(Refused);
    }
    expect(() => draftIdOf("")).toThrow("The draft needs a name.");
  });
});
