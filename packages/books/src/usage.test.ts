import { describe, expect, it } from "vitest";
import { shiftMonth } from "./usage.js";

describe("shiftMonth", () => {
  it("keeps the day, clamped to the month's end", () => {
    expect(shiftMonth("2026-09-15", -1)).toBe("2026-08-15");
    expect(shiftMonth("2026-03-31", -1)).toBe("2026-02-28");
    expect(shiftMonth("2026-01-10", -1)).toBe("2025-12-10");
    expect(shiftMonth("2026-12-31", 1)).toBe("2027-01-31");
  });
});
