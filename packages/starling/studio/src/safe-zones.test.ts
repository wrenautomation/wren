import { describe, expect, it } from "vitest";
import {
  addMask,
  covered,
  fitRect,
  placeWord,
  verticalRect,
  wordBox,
  ZONE,
  type Zone,
  zoneAcc,
  zoneOf,
} from "./safe-zones.js";

/** A g x g zone with him in the cells `him(col, row)` says. */
function zone(g: number, him: (c: number, r: number) => boolean): Zone {
  let occ = "";
  for (let r = 0; r < g; r++) for (let c = 0; c < g; c++) occ += him(c, r) ? "1" : "0";
  return { grid: g, occ };
}
const FRAME: [number, number] = [1920, 1080];
const RECT = fitRect(FRAME, FRAME, "contain");

describe("safe zones", () => {
  it("unions each cell's alpha over the window's frames", () => {
    const size = 8;
    const acc = zoneAcc(2);
    const left = new Uint8Array(size * size);
    const bottom = new Uint8Array(size * size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (x < 4 && y < 4) left[y * size + x] = 255;
        if (y >= 4 && x >= 4) bottom[y * size + x] = 20; // under 30/255 on average
      }
    addMask(acc, left, size);
    addMask(acc, bottom, size);
    expect(zoneOf(acc)).toEqual({ grid: 2, occ: "1000" });
    expect(ZONE.thresh).toBeCloseTo(30 / 255);
  });

  it("maps contain and cover pictures and the 9:16 window", () => {
    expect(fitRect([1080, 1920], [1920, 1080], "contain")).toEqual([
      (1920 - 607.5) / 2,
      0,
      607.5,
      1080,
    ]);
    expect(fitRect([1280, 720], [1920, 1080], "cover")).toEqual([0, 0, 1920, 1080]);
    expect(verticalRect({ size: [1920, 1080], window: [656, 0, 608, 1080] })).toEqual([
      expect.closeTo(-1166.67, 1),
      0,
      expect.closeTo(3413.33, 1),
      1920,
    ]);
  });

  it("scores the share of the word he covers", () => {
    const rightHalf = zone(4, (c) => c >= 2);
    expect(covered(rightHalf, RECT, [0, 0, 1920, 1080])).toBeCloseTo(0.5);
    expect(covered(rightHalf, RECT, [0, 0, 900, 500])).toBe(0);
    // Off the picture counts as clear.
    expect(covered(rightHalf, [0, 0, 960, 1080], [960, 0, 960, 1080])).toBe(0);
  });

  it("keeps the usual spot when the word reads there", () => {
    const nobody = zone(8, () => false);
    expect(placeWord(nobody, RECT, { frame: FRAME, text: "lock-in", size: 260, y: 430 })).toEqual({
      x: 960,
      y: 430,
      size: 260,
      where: "middle",
      clear: 1,
    });
  });

  it("moves above his head when his head covers the usual spot", () => {
    // A head in the middle third from 30% down, shoulders below.
    const g = 48;
    const head = zone(
      g,
      (c, r) => (r >= 14 && c >= 18 && c < 30) || (r >= 26 && c >= 10 && c < 38),
    );
    const spot = placeWord(head, RECT, { frame: FRAME, text: "lockin", size: 260, y: 430 });
    expect(spot?.where).toBe("above");
    expect(spot?.size).toBe(260);
    const box = wordBox("lockin", 260, spot?.x ?? 0, spot?.y ?? 0);
    expect(1 - covered(head, RECT, box)).toBeGreaterThanOrEqual(ZONE.clear);
    expect(box[1]).toBeGreaterThanOrEqual(ZONE.margin * 1080);
  });

  it("goes beside him on the wider side when his head is at the top", () => {
    // He stands right of centre, head to the top of the frame.
    const g = 48;
    const tall = zone(g, (c) => c >= 26 && c < 40);
    const spot = placeWord(tall, RECT, { frame: FRAME, text: "lock", size: 260, y: 430 });
    expect(spot?.where).toBe("left");
    expect(spot && spot.x < 26 * (1920 / g)).toBe(true);
  });

  it("shrinks before it gives up, and gives up when nothing reads", () => {
    const g = 48;
    // Clear only in narrow strips beside him: the big size doesn't fit, a smaller one does.
    const wide = zone(g, (c) => c >= 12 && c < 36);
    const spot = placeWord(wide, RECT, { frame: FRAME, text: "lock", size: 260, y: 430 });
    expect(spot).not.toBeNull();
    expect(spot?.size).toBeLessThan(260);
    expect(spot?.size).toBeGreaterThanOrEqual(260 * ZONE.minScale - 1);
    const all = zone(g, () => true);
    expect(placeWord(all, RECT, { frame: FRAME, text: "lock", size: 260, y: 430 })).toBeNull();
  });
});
