import { describe, expect, it } from "vitest";
import { boxPort } from "./box-slot.js";

describe("boxPort", () => {
  it("is the first slot when unset", () => {
    expect(boxPort({})).toBe(9080);
    expect(boxPort({ WREN_BOX_PORT: "" })).toBe(9080);
  });

  it("takes either slot and refuses any other port", () => {
    expect(boxPort({ WREN_BOX_PORT: "9081" })).toBe(9081);
    expect(() => boxPort({ WREN_BOX_PORT: "9082" })).toThrow(/9080, 9081/);
    expect(() => boxPort({ WREN_BOX_PORT: "x" })).toThrow();
  });
});
