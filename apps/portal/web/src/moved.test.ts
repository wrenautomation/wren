import { describe, expect, it } from "vitest";
import { MOVED, movedTo } from "./moved.js";

describe("movedTo", () => {
  it("sends Marketing's outbound pages to Outreach, keeping path, search and hash", () => {
    expect(movedTo("/marketing/engage")).toBe("/outreach/engage");
    expect(movedTo("/marketing/dms?view=waiting")).toBe("/outreach/dms?view=waiting");
    expect(movedTo("/marketing/dms/12")).toBe("/outreach/dms/12");
    expect(movedTo("/marketing/engage/onpost%3A3?view=all#x")).toBe(
      "/outreach/engage/onpost%3A3?view=all#x",
    );
    expect(movedTo("/marketing/dm-copy")).toBe("/outreach/dm-copy");
  });

  it("leaves every other address alone", () => {
    expect(movedTo("/marketing/plan")).toBeNull();
    expect(movedTo("/marketing/dmsx")).toBeNull();
    expect(movedTo("/marketing")).toBeNull();
    expect(movedTo("/outreach/dms")).toBeNull();
    expect(movedTo("/")).toBeNull();
  });

  it("never moves an address onto one that moves again", () => {
    for (const to of Object.values(MOVED)) expect(movedTo(to)).toBeNull();
  });
});
