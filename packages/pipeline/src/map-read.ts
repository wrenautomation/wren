/**
 * The Map page's read in one call (designs/2026-10-23-map-redo.md, "Load"): the newest shape, its
 * numbers for one window, the open journeys and the ghosts. Six record reads in parallel woke up to
 * five Lambdas, and each cold one took about 3.7 s to start. One call wakes one.
 */
import type { Queryable } from "@wren/db";
import type { VersionLine } from "./history.js";
import type { MetroBody } from "./metro.js";
import type { ShapeBody } from "./model.js";
import { type NumberRow, numberRows } from "./numbers.js";
import { journeyRows, shapeDetail } from "./records.js";

export const MAP_WINDOWS = ["all", "7", "30", "90"] as const;
export type MapWindow = (typeof MAP_WINDOWS)[number];

/** An open journey: who, where, since when. */
export interface MapPerson {
  id: string;
  name: string;
  node: string;
  nodeName: string;
  movedAt: string | null;
  daysAtNode: number;
}

export interface MapAnswer {
  /** Null when the workspace has no shape yet. */
  shape: {
    body: ShapeBody;
    depths: Record<string, number>;
    metro: MetroBody | null;
    drawErrors: string[];
    versions: VersionLine[];
  } | null;
  /** Station, track and line rows for the window. */
  numbers: NumberRow[];
  /** Open journeys, newest move first. */
  people: MapPerson[];
  /** Open journeys on a node the newest shape dropped, oldest move first. */
  ghosts: MapPerson[];
}

const MAP_KINDS = new Set(["station", "track", "line"]);

export async function mapAnswerOf(db: Queryable, window: MapWindow): Promise<MapAnswer> {
  const shape = await shapeDetail(db);
  if (!shape) return { shape: null, numbers: [], people: [], ghosts: [] };
  const [numbers, journeys] = await Promise.all([
    numberRows(db, window === "all" ? {} : { window: Number(window) as 7 | 30 | 90 }),
    journeyRows(db),
  ]);
  const open = journeys.filter((j) => j.status === "open");
  const person = (j: (typeof open)[number]): MapPerson => ({
    id: j.id,
    name: j.name,
    node: j.node,
    nodeName: j.node_name ?? j.node,
    movedAt: j.moved_at ? j.moved_at.toISOString() : null,
    daysAtNode: j.days_at_node,
  });
  return {
    shape: {
      body: shape.body,
      depths: shape.depths,
      metro: shape.metro,
      drawErrors: shape.drawErrors,
      versions: shape.versions,
    },
    numbers: numbers.filter((n) => MAP_KINDS.has(n.kind)),
    people: open.map(person),
    ghosts: open
      .filter((j) => j.ghost)
      .map(person)
      .reverse(),
  };
}
