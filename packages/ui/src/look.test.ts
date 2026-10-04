/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lookOf, WREN_COLORS } from "./look.js";

describe("look editor", () => {
  it("starts typed colors from Wren's as tailwind.css ships them", () => {
    const css = readFileSync(new URL("./tailwind.css", import.meta.url), "utf8");
    for (const [token, color] of Object.entries(WREN_COLORS)) {
      const at = new RegExp(`--ui-${token}:\\s*(#[0-9a-f]+)`, "i").exec(css)?.[1] ?? "";
      const full = at.length === 4 ? `#${[...at.slice(1)].map((c) => c + c).join("")}` : at;
      expect(full.toLowerCase(), token).toBe(color);
    }
  });

  it("holds a stored look as a name, an object, or Wren's", () => {
    expect(lookOf("night")).toBe("night");
    expect(lookOf({ brand: { color: "#123456" } })).toEqual({ brand: { color: "#123456" } });
    for (const bad of [null, undefined, 3, ["night"]]) expect(lookOf(bad)).toBeNull();
  });
});
