import { describe, expect, it } from "vitest";
import { capLeft } from "./campaigns.js";

describe("capLeft", () => {
  it("is the smaller of the global left and the campaign cap left", () => {
    expect(capLeft(30, undefined, 0)).toBe(30);
    expect(capLeft(30, 10, 4)).toBe(6);
    expect(capLeft(3, 10, 4)).toBe(3);
    expect(capLeft(30, 10, 12)).toBe(0);
    expect(capLeft(-2, 10, 0)).toBe(0);
  });
});
