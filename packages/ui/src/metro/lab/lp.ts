/**
 * The LP placer (designs/2026-10-23-metro-layout-lab.md): ELK fixes the order, a linear program
 * places y. Within each x slot, stations keep ELK's top-to-bottom order with a hard gap. The
 * objective is the sum of |Δy| along the tracks (L1), so tracks run as straight as the gaps allow.
 * HiGHS solves it. A bad case shows on the board; the placer is one slot in `engines.ts`.
 */
import highsLoader, { type Highs } from "highs";
import wasmUrl from "highs/runtime?url";
import type { Point } from "../types.js";
import type { MetroView } from "../view.js";

/** Clear space between two stations stacked in one slot, beyond their own halves. */
const GAP = 24;
/** A small pull up, so the map stays tight where the tracks leave y free. */
const TIGHT = 0.001;

let solver: Promise<Highs> | undefined;
/** In Node, HiGHS finds its Wasm beside its script; a browser bundle needs the URL. */
const highs = () =>
  (solver ??= highsLoader(typeof window === "undefined" ? {} : { locateFile: () => wasmUrl }));

/**
 * Each station's y from the LP; x stays as `order` gave it. `slot` is a station's even x slot,
 * 0 first; `height` is the room a station takes. A track over more than one slot gets a point of
 * no height in each slot it passes, so it keeps a place between the stations there. That y is the
 * straight line between its ends in `order`, not ELK's own bend: a few crossings ELK avoided stay.
 */
export async function lpY(
  view: MetroView,
  order: ReadonlyMap<string, Point>,
  slot: ReadonlyMap<string, number>,
  height: (id: string) => number,
): Promise<Map<string, Point>> {
  const ids = [...order.keys()].filter((id) => slot.has(id));
  const name = new Map(ids.map((id, i) => [id, `y${i}`]));
  const y0 = (id: string) => (order.get(id) as Point)[1];
  // Each slot's points, with the y that orders them and the room they take.
  const slots = new Map<number, { v: string; y: number; h: number }[]>();
  const put = (s: number, v: string, y: number, h: number) =>
    slots.set(s, [...(slots.get(s) ?? []), { v, y, h }]);
  for (const id of ids) put(slot.get(id) as number, name.get(id) as string, y0(id), height(id));
  const links: [string, string][] = [];
  for (const [i, t] of view.tracks.entries()) {
    const [a, b] = [t.from, t.to].sort((p, q) => (slot.get(p) ?? 0) - (slot.get(q) ?? 0));
    const [va, vb] = [name.get(a as string), name.get(b as string)];
    if (!va || !vb || va === vb) continue;
    const [sa, sb] = [slot.get(a as string) as number, slot.get(b as string) as number];
    let prev = va;
    for (let s = sa + 1; s < sb; s++) {
      const v = `p${i}_${s}`;
      put(s, v, y0(a as string) + ((y0(b as string) - y0(a as string)) * (s - sa)) / (sb - sa), 0);
      links.push([prev, v]);
      prev = v;
    }
    links.push([prev, vb]);
  }
  const lines = [
    "Minimize",
    ` obj: ${[...links.map((_, i) => `t${i}`), ...ids.map((id) => `${TIGHT} ${name.get(id)}`)].join(" + ")}`,
    "Subject To",
  ];
  for (const [s, points] of slots.entries()) {
    const sorted = points.sort((p, q) => p.y - q.y);
    for (let i = 1; i < sorted.length; i++) {
      const [p, q] = [sorted[i - 1], sorted[i]] as [(typeof sorted)[0], (typeof sorted)[0]];
      lines.push(` g${s}_${i}: ${q.v} - ${p.v} >= ${(p.h + q.h) / 2 + GAP}`);
    }
  }
  for (const [i, [f, to]] of links.entries())
    lines.push(` u${i}: t${i} - ${f} + ${to} >= 0`, ` d${i}: t${i} + ${f} - ${to} >= 0`);
  lines.push("End");
  const out = (await highs()).solve(lines.join("\n"));
  if (out.Status !== "Optimal") throw new Error(`LP placer: ${out.Status}`);
  return new Map(
    ids.map((id) => [
      id,
      [(order.get(id) as Point)[0], out.Columns[name.get(id) as string]?.Primal ?? 0] as Point,
    ]),
  );
}
