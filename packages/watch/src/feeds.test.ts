import { describe, expect, it } from "vitest";
import { decode } from "./feeds.js";

describe("decode", () => {
  it("knows the full named table and keeps nbsp a plain space", () => {
    expect(decode("caf&eacute; &hearts; &rarr;&nbsp;x &#99999999;")).toBe("café ♥ → x �");
  });
});
