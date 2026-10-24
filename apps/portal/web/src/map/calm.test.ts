// @vitest-environment happy-dom
import {
  crossingsOf,
  fullDepth,
  layoutView,
  openSet,
  sceneClashes,
  viewZoom,
} from "@wren/ui/metro";
import { describe, expect, it } from "vitest";
import { SHAPE_METRO } from "../mocks/data/journeys.js";
import { FILE_METRO, SHAPE_BIG, SHAPE_PLAN, SHAPE_SPUR } from "../mocks/data/map.js";
import { viewOf } from "./view.js";

/**
 * The shapes the Map page stories draw, through the page's own `viewOf`, then `layoutView`: no
 * name over a mark or another name, no chip over a mark or the hub, equal gaps in a column, no
 * track under the hub. The crossings are pinned at what each shape draws now (the file shape
 * crosses once: its data runs backward). Each fold depth the page can show is calm too.
 */
const SHAPES = {
  default: [SHAPE_METRO, 0],
  plan: [SHAPE_PLAN, 0],
  spur: [SHAPE_SPUR, 0],
  file: [FILE_METRO, 1],
  big: [SHAPE_BIG, 0],
} as const;

type Shape = (typeof SHAPES)[keyof typeof SHAPES][0];
const viewOfShape = (metro: Shape) =>
  viewOf(metro, { stations: new Map() }, [], new Date("2026-10-21T12:00:00Z"));
const sceneOf = (metro: Shape) => layoutView(viewOfShape(metro));

describe("a calm map on the page's shapes", () => {
  for (const [name, [metro, crossings]] of Object.entries(SHAPES)) {
    it(`${name}: nothing on top of anything`, async () => {
      expect(sceneClashes(await sceneOf(metro))).toEqual([]);
    });
    it(`${name}: crosses no more than it did`, async () => {
      expect(crossingsOf(await sceneOf(metro))).toBeLessThanOrEqual(crossings);
    });
    it(`${name}: nothing on top of anything at each depth`, async () => {
      const z = viewZoom(viewOfShape(metro));
      for (let depth = 0; depth <= fullDepth(z.nodes); depth++) {
        const scene = await z.scene(openSet(z.nodes, { depth, open: {} }));
        expect(sceneClashes(scene), `depth ${depth}`).toEqual([]);
      }
    });
  }

  it("draws the big shape wider than a phone, so the page pans it", async () => {
    const scene = await sceneOf(SHAPE_BIG);
    expect(scene.w).toBeGreaterThan(1200);
    // ELK packs the rows: taller than a phone's map frame, not as tall as the old grid.
    expect(scene.h).toBeGreaterThan(600);
  });

  it("is the same scene each time", async () => {
    expect(await sceneOf(SHAPE_BIG)).toEqual(await sceneOf(SHAPE_BIG));
  });
});
