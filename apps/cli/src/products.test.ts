import { describe, expect, it } from "vitest";
import { changeProducts, parseAssignment, pathOf } from "./products.js";

describe("product settings from the CLI", () => {
  it("parses values as JSON, else text", () => {
    expect(parseAssignment("reactivation.on=true")).toEqual({
      path: ["reactivation", "on"],
      value: true,
    });
    expect(parseAssignment("reactivation.sending.rampStart=2026-10-01").value).toBe("2026-10-01");
    expect(parseAssignment("reactivation.compose.perDay=30").value).toBe(30);
  });

  it("refuses unknown products and empty path parts", () => {
    expect(() => pathOf("nope.on")).toThrow(/unknown product/);
    expect(() => pathOf("reactivation..on")).toThrow(/bad path/);
    expect(() => parseAssignment("reactivation.on")).toThrow(/expects/);
  });

  it("merges into the stored block and returns only what it touched", () => {
    const out = changeProducts(
      { reactivation: { on: true, compose: { perDay: 5 } }, other: { x: 1 } },
      [parseAssignment("reactivation.stages.send=true")],
      [],
    );
    expect(out).toEqual({
      reactivation: { on: true, compose: { perDay: 5 }, stages: { send: true } },
    });
  });

  it("an unset that empties the block removes it", () => {
    expect(changeProducts({ reactivation: { on: true } }, [], [["reactivation", "on"]])).toEqual({
      reactivation: null,
    });
  });

  it("checks the block with the product's parser before anything is written", () => {
    expect(() =>
      changeProducts({}, [parseAssignment("reactivation.compose.perDay=lots")], []),
    ).toThrow(/compose.perDay/);
  });

  it("does not change the stored object it was given", () => {
    const current = { reactivation: { on: true } };
    changeProducts(current, [parseAssignment("reactivation.on=false")], []);
    expect(current.reactivation.on).toBe(true);
  });
});
