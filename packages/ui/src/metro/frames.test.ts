import { allOpen } from "@wrenautomation/orrery";
import { describe, expect, it } from "vitest";
import { viewScene, viewZoom } from "./fold.js";
import { CHIP_H, foldWidth, labelBoxes, markBoxes } from "./geometry.js";
import { GROWTH_RETAINER } from "./money-models.js";
import { SAMPLE_VIEWS, ZOOM_VIEW } from "./samples.js";
import { isMark } from "./types.js";
import type { MetroView } from "./view.js";

const VIEWS: MetroView[] = [...SAMPLE_VIEWS, GROWTH_RETAINER, ZOOM_VIEW];

/** A box edge that cuts through a stop or its name: part inside, part outside. */
const meets = (a: [number, number, number, number], b: [number, number, number, number]) =>
  a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

const cuts = (
  b: [number, number, number, number],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) => {
  const inside = x0 >= b[0] && x1 <= b[2] && y0 >= b[1] && y1 <= b[3];
  const apart = x1 <= b[0] || x0 >= b[2] || y1 <= b[1] || y0 >= b[3];
  return !inside && !apart;
};

describe("open frames", () => {
  it("never cut through a stop or its name, and the tab covers none, one fold open or all", async () => {
    const bad: string[] = [];
    for (const v of VIEWS) {
      const z = viewZoom(v);
      const sets = [allOpen(z.nodes), ...z.nodes.map((n) => new Set([n.id]))];
      for (const open of sets) {
        const scene = await viewScene(v, open);
        for (const o of scene.opened ?? []) {
          if (!o.box) continue;
          for (const s of scene.st) {
            if (!isMark(s)) continue;
            const tab: [number, number, number, number] = [
              o.at[0] - foldWidth(o.t) / 2,
              o.at[1] - CHIP_H / 2,
              o.at[0] + foldWidth(o.t) / 2,
              o.at[1] + CHIP_H / 2,
            ];
            for (const q of [...markBoxes(s), ...labelBoxes(s)]) {
              const at = `${v.stations[0]?.line ?? "?"} [${[...open].join(",")}] ${o.grp}`;
              if (cuts(o.box, q.x0, q.y0, q.x1, q.y1)) bad.push(`${at} cuts ${s.id}`);
              if (meets(tab, [q.x0, q.y0, q.x1, q.y1])) bad.push(`${at} tab covers ${s.id}`);
            }
          }
        }
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});
