import { describe, expect, it } from "vitest";
import { savedIdOf } from "./workflow-templates.js";

describe("savedIdOf", () => {
  it("makes a stable id from a name", () => {
    expect(savedIdOf("Win back, fast")).toBe("saved_win_back_fast");
    expect(savedIdOf("  Café leads!  ")).toBe("saved_cafe_leads");
    expect(savedIdOf("x".repeat(100))).toHaveLength(64);
    expect(savedIdOf("!!!")).toBe("saved");
  });
});
