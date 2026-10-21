/**
 * Blame for the metro model: one line's, station's, track's, group's, frame's or flow's own
 * history. The twin of `blame.ts`: pure, the versions in, the lines out. A station keeps its
 * history across the convert from the graph model, because `metroOf` keeps ids (a station id is
 * the node id). A flow's history includes the stations and tracks inside it: they are `changed`.
 */
import { isoOf } from "./blame.js";
import type { BlameLine } from "./history.js";
import type { MetroBody } from "./metro.js";
import { howOf, itemsOf, type MetroOn } from "./metro-diff.js";

/** What `historyOfMetro` reads of each version. */
export interface MetroBlameVersion {
  number: number;
  body: MetroBody;
  note: string;
  createdBy: string;
  createdAt: Date | string;
}

/** The body before the first version: nothing in it. */
const NOTHING: MetroBody = {
  model: "metro",
  name: "",
  lines: [],
  stations: [],
  tracks: [],
  groups: [],
  frames: [],
};

/**
 * Every version that added, removed, renamed or changed item `id` of kind `on`, with who, when
 * and why, newest first. Each version is compared with the one before it in number order; the
 * first version that holds the id added it.
 */
export function historyOfMetro(
  versions: readonly MetroBlameVersion[],
  id: string,
  on: MetroOn,
): BlameLine[] {
  const sorted = [...versions].sort((x, y) => x.number - y.number);
  const perVersion: BlameLine[][] = [];
  let before: MetroBody = NOTHING;
  for (const v of sorted) {
    const was = itemsOf(before, on).find((x) => x.id === id);
    const now = itemsOf(v.body, on).find((x) => x.id === id);
    perVersion.push(
      howOf(on, was, now).map((h) => ({
        version: v.number,
        how: h.how,
        ...(h.how === "renamed" ? { from: h.from ?? "", to: h.to ?? "" } : {}),
        note: v.note,
        by: v.createdBy,
        at: isoOf(v.createdAt),
      })),
    );
    before = v.body;
  }
  return perVersion.reverse().flat();
}
