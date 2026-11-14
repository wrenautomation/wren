import { describe, expect, it } from "vitest";
import { DISPLAY, displayDiff, displayVars, dragged, PAGES, readDisplay, SIDE } from "./display.js";

describe("readDisplay", () => {
  it("is the defaults for nothing kept", () => {
    expect(readDisplay(null)).toEqual(DISPLAY);
    expect(readDisplay("wide")).toEqual(DISPLAY);
    expect(readDisplay([1])).toEqual(DISPLAY);
  });

  it("keeps what's valid and drops the rest", () => {
    expect(
      readDisplay({ side: 300, density: "snug", text: "huge", counts: "no", frame: false }),
    ).toEqual({ ...DISPLAY, side: 300, density: "snug", frame: false });
  });

  it("holds widths in range", () => {
    expect(readDisplay({ side: 9000, pages: 3 })).toMatchObject({
      side: SIDE.max,
      pages: PAGES.min,
    });
    expect(readDisplay({ side: Number.NaN }).side).toBe(DISPLAY.side);
  });
});

describe("sidebar", () => {
  it("reads the old fold as icons, and hidden as no width", () => {
    expect(readDisplay({ sideShut: true }).sidebar).toBe("icons");
    expect(readDisplay({ sideShut: true, sidebar: "hidden" }).sidebar).toBe("hidden");
    expect(readDisplay({ sidebar: "gone" }).sidebar).toBe("full");
    expect(displayVars({ ...DISPLAY, sidebar: "hidden" })["--layout-side"]).toBe("0px");
  });
});

describe("displayDiff", () => {
  it("keeps only changes, and nothing for the defaults", () => {
    expect(displayDiff(DISPLAY)).toBeNull();
    expect(displayDiff({ ...DISPLAY, sidebar: "icons" })).toEqual({ sidebar: "icons" });
  });
});

describe("displayVars", () => {
  it("draws a folded sidebar at its icons' width and drops the frame when off", () => {
    expect(displayVars({ ...DISPLAY, sidebar: "icons", frame: false, text: "large" })).toEqual({
      "--layout-side": `${SIDE.shut}px`,
      "--layout-pages": `${DISPLAY.pages}px`,
      "--layout-zoom": "1.08",
      "--ui-frame": "0px",
    });
  });
});

describe("dragged", () => {
  it("folds past the fold line and clamps the rest", () => {
    expect(dragged(100, SIDE)).toEqual({ width: SIDE.min, shut: true });
    expect(dragged(170, SIDE)).toEqual({ width: SIDE.min, shut: false });
    expect(dragged(500, SIDE)).toEqual({ width: SIDE.max, shut: false });
    expect(dragged(250.4, SIDE)).toEqual({ width: 250, shut: false });
  });
});
