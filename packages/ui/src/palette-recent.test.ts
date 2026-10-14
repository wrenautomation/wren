/** ⌘K's found records: the ones opened lately lead, by group and inside it. */
import { describe, expect, it } from "vitest";
import { byRecent, type PaletteItem } from "./palette.js";

const item = (group: string, href: string): PaletteItem => ({ group, href, label: href });

describe("byRecent", () => {
  const found = [item("Clients", "/c/1"), item("Clients", "/c/2"), item("Sites", "/s/1")];
  it("keeps find's order with nothing recent", () => {
    expect(byRecent(found, []).map((i) => i.href)).toEqual(["/c/1", "/c/2", "/s/1"]);
  });
  it("puts a recent record's group first, and it first inside", () => {
    expect(byRecent(found, ["/s/1"]).map((i) => i.href)).toEqual(["/s/1", "/c/1", "/c/2"]);
    expect(byRecent(found, ["/c/2"]).map((i) => i.href)).toEqual(["/c/2", "/c/1", "/s/1"]);
  });
});
