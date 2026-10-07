import { describe, expect, it } from "vitest";
import { arrangeTiles, MAX_PINS, moved, togglePin } from "./customize.js";

describe("pins", () => {
  it("pins and unpins, keeping order, and drops the oldest past the cap", () => {
    expect(togglePin(["/a/x"], "/b/y")).toEqual(["/a/x", "/b/y"]);
    expect(togglePin(["/a/x", "/b/y"], "/a/x")).toEqual(["/b/y"]);
    const full = Array.from({ length: MAX_PINS }, (_, i) => `/p/${i}`);
    expect(togglePin(full, "/new/one")).toEqual([...full.slice(1), "/new/one"]);
  });

  it("moves one, and ignores a move off the ends", () => {
    expect(moved(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moved(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moved(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });
});

describe("tiles", () => {
  const tiles = [{ label: "Sent" }, { label: "Replies" }, { label: "Booked" }];
  it("keeps the code's order with no pref", () => {
    expect(arrangeTiles(tiles, undefined).shown.map((t) => t.label)).toEqual([
      "Sent",
      "Replies",
      "Booked",
    ]);
  });
  it("puts his order first, hides his hidden ones, and shows a new tile last", () => {
    const { all, shown, hidden } = arrangeTiles([...tiles, { label: "New" }], {
      order: ["Booked", "Sent", "Replies"],
      hidden: ["Sent"],
    });
    expect(shown.map((t) => t.label)).toEqual(["Booked", "Replies", "New"]);
    expect(hidden.map((t) => t.label)).toEqual(["Sent"]);
    // The menu keeps a hidden tile where it was.
    expect(all.map((t) => t.label)).toEqual(["Booked", "Sent", "Replies", "New"]);
  });
});
