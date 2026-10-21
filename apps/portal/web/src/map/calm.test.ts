// @vitest-environment happy-dom
import { crossingsOf, layoutMetro, sceneClashes } from "@wren/ui/metro";
import { describe, expect, it } from "vitest";
import { SHAPE_METRO } from "../mocks/data/journeys.js";
import { FILE_METRO, SHAPE_BIG, SHAPE_PLAN, SHAPE_SPUR } from "../mocks/data/map.js";
import { viewOf } from "./view.js";

/**
 * The shapes the Map page stories draw, through the page's own `viewOf`, then `layoutMetro`: no
 * name over a mark or another name, no chip over a mark or the hub, equal gaps in a column, no
 * track under the hub. The crossings are pinned at what each shape draws now (the file shape
 * crosses once: its data runs backward).
 */
const SHAPES = {
  default: [SHAPE_METRO, 0],
  plan: [SHAPE_PLAN, 0],
  spur: [SHAPE_SPUR, 0],
  file: [FILE_METRO, 1],
  big: [SHAPE_BIG, 0],
} as const;

const sceneOf = (metro: (typeof SHAPES)[keyof typeof SHAPES][0]) =>
  layoutMetro(viewOf(metro, { stations: new Map() }, [], new Date("2026-10-21T12:00:00Z")));

describe("a calm map on the page's shapes", () => {
  for (const [name, [metro, crossings]] of Object.entries(SHAPES)) {
    it(`${name}: nothing on top of anything`, () => {
      expect(sceneClashes(sceneOf(metro))).toEqual([]);
    });
    it(`${name}: crosses no more than it did`, () => {
      expect(crossingsOf(sceneOf(metro))).toBeLessThanOrEqual(crossings);
    });
  }

  it("draws the big shape wider than a phone, so the page pans it", () => {
    const scene = sceneOf(SHAPE_BIG);
    expect(scene.w).toBeGreaterThan(1200);
    expect(scene.h).toBeGreaterThan(900);
  });

  it("is the same scene each time", () => {
    expect(sceneOf(SHAPE_BIG)).toEqual(sceneOf(SHAPE_BIG));
  });
});
