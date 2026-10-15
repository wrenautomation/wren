import { describe, expect, it } from "vitest";

Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { undoOf } = await import("./menus.js");

describe("undoOf: a mark's undo", () => {
  it("is the opposite, on only the items the mark changed", () => {
    // Star on 1 and 2; 2 was starred already, so only 1 changed.
    expect(undoOf("star", ["1"])).toMatchObject({ back: "unstar", ids: [1] });
  });

  it("is nothing when the mark changed nothing", () => {
    expect(undoOf("star", [])).toBeNull();
  });

  it("runs once", () => {
    const u = undoOf("archive", ["4"]);
    expect(u?.take()).toBe(true);
    expect(u?.take()).toBe(false);
  });
});
