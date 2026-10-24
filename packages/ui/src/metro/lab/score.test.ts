/**
 * The layout lab's board: every case through every engine, scored. It prints the board and checks
 * only that each case converts and lays out; picking the engine is William's, by score and by eye.
 */
import { describe, expect, it } from "vitest";
import { isMark } from "../types.js";
import { LAB_CASES } from "./cases.js";
import { ENGINES } from "./engines.js";
import { scoreScene } from "./score.js";

describe("layout lab", () => {
  // One wrong view spoils every engine's score on its case: each hand station is in the view, and
  // each joins a track.
  it.each(LAB_CASES.filter((c) => c.hand))("$id converts whole", ({ view, hand }) => {
    const marks = (hand?.st ?? []).filter(isMark).map((s) => s.id);
    expect(view.stations.map((s) => s.id).sort()).toEqual([...marks].sort());
    const joined = new Set(view.tracks.flatMap((t) => [t.from, t.to]));
    expect(view.stations.filter((s) => !joined.has(s.id)).map((s) => s.id)).toEqual([]);
  });

  it("scores every case through every engine", async () => {
    const rows: string[] = [];
    const sum = new Map<string, { like: number; clash: number; cross: number; n: number }>();
    for (const c of LAB_CASES) {
      expect(c.view.stations.length).toBeGreaterThan(1);
      for (const e of ENGINES) {
        const s = scoreScene(await e.run(c.view), c.hand);
        const t = sum.get(e.id) ?? { like: 0, clash: 0, cross: 0, n: 0 };
        sum.set(e.id, {
          like: t.like + (s.likeness ?? 0),
          clash: t.clash + s.clashes,
          cross: t.cross + s.crossings,
          n: t.n + (s.likeness === undefined ? 0 : 1),
        });
        rows.push(
          `${c.id.padEnd(44)} ${e.id.padEnd(34)} like ${String(s.likeness ?? "-").padEnd(5)} clash ${String(s.clashes).padStart(3)} uneven ${String(s.uneven).padStart(2)} cross ${String(s.crossings).padStart(3)} bends ${String(s.bends).padStart(3)} width ${s.width}`,
        );
      }
    }
    rows.push("", "TOTAL, best likeness first");
    for (const [id, t] of [...sum].sort((a, b) => b[1].like / b[1].n - a[1].like / a[1].n))
      rows.push(
        `${id.padEnd(34)} like ${(t.like / Math.max(1, t.n)).toFixed(3)} clash ${t.clash} cross ${t.cross}`,
      );
    console.log(rows.join("\n"));
  }, 120_000);
});
