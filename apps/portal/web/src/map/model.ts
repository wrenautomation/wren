/**
 * The Map's data, pure (no reads, so a test imports it alone): the windows, what a read gives, and
 * the lines a panel says. `view.ts` turns it into the drawing.
 */
import type { VersionLine } from "@wren/pipeline/history";
import type { MetroBody } from "@wren/pipeline/metro";
import type { ShapeBody } from "@wren/pipeline/model";
import { money, num } from "@wren/ui";

export const WINDOWS = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "all", label: "All time" },
] as const;
export type Window = (typeof WINDOWS)[number]["id"];
export const DEFAULT_WINDOW: Window = "30";

/** The window an address names; the default when it names none or one we don't have. */
export const windowOf = (s: string | null): Window =>
  WINDOWS.find((w) => w.id === s)?.id ?? DEFAULT_WINDOW;

/** What a window says in a sentence: "in the last 30 days". */
export const windowSays = (w: Window): string =>
  w === "all" ? "in all time" : `in the last ${w} days`;

/** A version as the shape's detail lists it: tags, the draft it came from, the git mirror. */
export type Version = VersionLine;

export interface Sum {
  amount: number;
  currency: string;
}

/** A node's numbers over the window. Each is null where the node has none (a source's "now"). */
export interface NodeNumbers {
  id: string;
  now: number | null;
  arrived: number | null;
  left: number | null;
  medianDays: number | null;
  opened: number | null;
  deals: number | null;
  collected: Sum | null;
  scheduled: Sum | null;
}

export interface Person {
  /** The journey's id. */
  id: string;
  name: string;
  node: string;
  nodeName: string;
  movedAt: string | null;
  daysAtNode: number;
}

/** A node the newest shape lacks that open journeys still sit on. */
export interface Ghost {
  id: string;
  name: string;
  people: Person[];
}

export interface MapData {
  body: ShapeBody;
  /** The shape as the map draws it; null when it cannot be drawn. */
  metro: MetroBody | null;
  /** Why it cannot be drawn; empty when it can. */
  drawErrors: string[];
  depths: Record<string, number>;
  versions: Version[];
  /** The numbers of each station over the window, by station id. The hub's `now` is the leads. */
  stations: Map<string, NodeNumbers>;
  /** People who crossed each track in the window, by track id. */
  tracks: Map<string, number>;
  /** The numbers of each line, by line id. An offer line has one row for each currency. */
  lines: Map<string, NodeNumbers[]>;
  /** Open journeys, newest move first. */
  people: Person[];
  ghosts: Ghost[];
}

const cash = (s: Sum | null) => (s ? money(s.amount, s.currency, true) : "none");

/** What a station says in a panel: its numbers over the window. The hub says its leads. */
export function stationSays(kind: string, x: NodeNumbers | undefined): string[] {
  if (!x) return ["No numbers yet."];
  if (kind === "hub") return [`Leads: ${num(x.now ?? 0)}`];
  if (kind === "cash")
    return [
      `Now: ${num(x.now ?? 0)}`,
      `Deals: ${num(x.deals ?? 0)}`,
      `Scheduled: ${cash(x.scheduled)}`,
      `Collected: ${cash(x.collected)}`,
    ];
  return [
    `Now: ${num(x.now ?? 0)}`,
    `Arrived: ${num(x.arrived ?? 0)}`,
    `Left: ${num(x.left ?? 0)}`,
    `Median days there: ${x.medianDays == null ? "none" : num(Math.round(x.medianDays * 10) / 10)}`,
  ];
}

/** What a line says in a panel: its numbers over the window, one set for each currency. */
export function lineSays(rows: readonly NodeNumbers[] | undefined): string[] {
  if (!rows?.length) return ["No numbers yet."];
  return rows.flatMap((x) => [
    ...(x.opened != null ? [`Opened: ${num(x.opened)}`] : []),
    `Deals: ${num(x.deals ?? 0)}`,
    ...(x.collected || x.scheduled
      ? [`Collected: ${cash(x.collected)}`, `Scheduled: ${cash(x.scheduled)}`]
      : []),
  ]);
}
